import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { canonicalizeJson, computeCapsuleId, computeContentHash, computeRequestKey, type Capsule } from "@setusync/protocol";
import type { PublicKeyInfo } from "../src/index.js";

export interface Signer { kid: string; privateKey: KeyObject; info: PublicKeyInfo }

export function makeSigner(kid = "relay-test"): Signer {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { kid, privateKey, info: { kid, alg: "Ed25519", publicKeySpkiB64: publicKey.export({ type: "spki", format: "der" }).toString("base64") } };
}

/** A genuinely Ed25519-signed capsule. fetchedAt lets tests build "newer" versions of the same search. */
export function makeCapsule(signer: Signer, query: string, titles = ["Alpha", "Beta", "Gamma"], fetchedAt = "2026-10-10T00:00:00Z"): Capsule {
  const results = titles.map((title, i) => ({ position: i + 1, title, link: `https://example.com/${title.toLowerCase()}`, snippet: `About ${title} for ${query}` }));
  const params = { q: query };
  const bodyWithoutId = {
    key: computeRequestKey({ engine: "google", query, params }),
    chash: computeContentHash({ organic_results: results, related_questions: [] }),
    engine: "google", params, fetched_at: fetchedAt, ttl_s: 3600, source: { provider: "serpapi" },
    organic_results: results, related_questions: [],
  };
  const body = { id: computeCapsuleId(bodyWithoutId), ...bodyWithoutId };
  const sig = sign(null, Buffer.from(canonicalizeJson(body)), signer.privateKey).toString("base64url");
  return { v: 1, kid: signer.kid, alg: "Ed25519", sig, body } as Capsule;
}
