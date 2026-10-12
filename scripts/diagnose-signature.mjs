import { readFileSync } from "node:fs";
import { createPublicKey, verify as edVerify, randomUUID } from "node:crypto";
import {
  computeContentHash,
  computeCapsuleId,
  canonicalizeJson
} from "../packages/protocol/dist/index.js";

const base = (process.argv[2] ?? "http://localhost:8088").replace(/\/$/, "");
const query = process.argv[3] ?? "pharmacy in delhi";

const headers = {
  "X-SetuSync-Install-Id": randomUUID(),
  "Content-Type": "application/json",
  "Idempotency-Key": randomUUID()
};

const ok = (message) => console.log(`  OK    ${message}`);
const bad = (message) => console.log(`  FAIL  ${message}`);

let response;

for (let i = 0; i < 25; i++) {
  response = await fetch(`${base}/v1/search`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      engine: "google",
      params: { q: query },
      max_age_s: 86400,
      wait_ms: 0,
      accept: { lite: true, full: true }
    })
  });

  if (response.status === 200) break;

  if (response.status !== 202) {
    console.error(`Relay answered HTTP ${response.status}: ${await response.text()}`);
    process.exit(1);
  }

  console.log("Waiting for the relay to finish the search...");
  await new Promise(resolve => setTimeout(resolve, 3000));
}

if (response.status !== 200) {
  console.error("Search did not finish in time.");
  process.exit(1);
}

const raw = await response.text();
const parsed = JSON.parse(raw);
const capsule = parsed.capsule ?? parsed;
const body = capsule.body;

console.log(`\nCapsule kid=${capsule.kid} alg=${capsule.alg} id=${body?.id}`);

console.log("\nChecks:");

const hash = String(computeContentHash(body) ?? "").trim().toLowerCase();
const expectedHash = String(body.chash ?? "").trim().toLowerCase();

if (hash === expectedHash) {
  ok("content hash matches");
} else {
  bad(`content hash differs
          relay:   ${JSON.stringify(body.chash)}
          browser: ${JSON.stringify(hash)}`);
}

const { id, ...rest } = body;
const computedId = String(computeCapsuleId(rest) ?? "").trim().toLowerCase();
const expectedId = String(id ?? "").trim().toLowerCase();

if (computedId === expectedId) {
  ok("capsule ID matches");
} else {
  bad(`capsule ID differs
          relay:   ${JSON.stringify(id)}
          browser: ${JSON.stringify(computedId)}`);
}

const keysResponse = await fetch(`${base}/v1/keys`, { headers });
const keys = keysResponse.ok
  ? (await keysResponse.json()).keys ?? []
  : [];

console.log(`\nPublished keys: ${keys.length}`);

const key = keys.find(item => item.kid === capsule.kid);

if (!key) {
  bad(`no published key for kid "${capsule.kid}"`);
} else {
  const publicKey = createPublicKey({
    key: Buffer.from(key.publicKeySpkiB64, "base64"),
    format: "der",
    type: "spki"
  });

  const signature = Buffer.from(
    capsule.sig.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  );

  const valid = edVerify(
    null,
    Buffer.from(canonicalizeJson(body), "utf8"),
    publicKey,
    signature
  );

  valid
    ? ok("Ed25519 signature is valid")
    : bad("Ed25519 signature is invalid");
}

console.log("\nDiagnostic finished.");
