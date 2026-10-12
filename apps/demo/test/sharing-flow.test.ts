import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canonicalizeJson,
  computeCapsuleId,
  computeContentHash,
  computeRequestKey,
} from "@setusync/protocol";
import { decodePack, encodePack } from "@setusync/edge-sdk";

import {
  makeDevice,
  makeRelay,
  settled,
  waitFor,
  type FakeRelay,
} from "./helpers.js";
import type { SetuSyncController } from "../src/controller.js";

async function deviceWithResult(
  relay: FakeRelay,
  query = "Best cafe in Tokyo",
): Promise<SetuSyncController> {
  const device = makeDevice(relay);
  await device.init();
  await device.requestLive(query);
  await settled(device, 1);
  return device;
}

function offlineDevice(relay: FakeRelay): Promise<SetuSyncController> {
  const device = makeDevice(relay, { browserOnline: false });
  return device.init().then(() => device);
}

describe("verification and provenance", () => {
  it("verifies relay results using keys fetched from /v1/keys", async () => {
    const relay = makeRelay();
    const device = await deviceWithResult(relay);
    const capsule = device.getState().capsules[0];

    expect(capsule?.provenance?.origin).toBe("relay");
    expect(capsule?.provenance?.verified).toBe(true);
    expect(device.getState().keys[0]?.source).toBe("relay");
    // The relay receives the light-normalised text, so everyone shares a key.
    expect(capsule?.query).toBe("best cafe in tokyo");
    expect(device.getState().savings.liveFetches).toBe(1);
    device.dispose();
  });

  it("recognises an equivalent phrasing and spends no credit", async () => {
    const relay = makeRelay();
    const device = await deviceWithResult(relay);
    const searches = relay.log.filter((x) => x === "POST /v1/search").length;

    expect(await device.requestLive("tokyo  best CAFES?")).toBe(
      "FRESH_IN_CACHE",
    );
    expect(device.getState().savings.equivalentHits).toBe(1);
    expect(device.getState().savings.creditsAvoided).toBe(1);
    expect(relay.log.filter((x) => x === "POST /v1/search").length).toBe(
      searches,
    );
    device.dispose();
  });

  it("learns volatility from repeated fetches", async () => {
    const relay = makeRelay();
    const device = await deviceWithResult(relay);

    relay.cache.clear();
    relay.titles = ["Alpha", "Gamma"];
    await device.requestLive("best cafe in tokyo", { force: true });
    await waitFor(() => !device.getState().syncing);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const verdicts = device
      .getState()
      .capsules.map((c) => c.volatility?.verdict);
    expect(verdicts.includes("UNKNOWN")).toBe(false);
    device.dispose();
  });
});

describe("capsule packs between devices", () => {
  it("A -> pack -> B, with key approval and a custody chain", async () => {
    const relay = makeRelay();
    const a = await deviceWithResult(relay);
    const pack = await a.exportPack();

    expect(pack.filename.endsWith(".setupack")).toBe(true);
    expect(pack.bytes[0]).toBe(0x1f); // gzip

    const b = await offlineDevice(relay);
    const first = await b.importPack(pack.bytes, "pack");

    expect(first.status).toBe("NEEDS_TRUST");
    if (first.status === "NEEDS_TRUST") {
      expect(first.keys[0]?.fingerprint).toBe(
        a.getState().keys[0]?.fingerprint,
      );
    }
    expect(b.getState().capsules.length).toBe(0);

    const done = await b.confirmPendingImport(true);
    expect(done.status).toBe("IMPORTED");

    const capsule = b.getState().capsules[0];
    expect(capsule?.provenance?.origin).toBe("pack");
    expect(capsule?.provenance?.verified).toBe(true);
    expect(capsule?.provenance?.hops.map((h) => h.role)).toEqual([
      "origin",
      "exporter",
      "importer",
    ]);
    expect(b.getState().savings.peerCapsules).toBe(1);
    expect(b.searchLocal("cafe tokyo").hits.length).toBeGreaterThan(0);

    // Importing the same pack again changes nothing.
    const again = await b.importPack(pack.bytes, "pack");
    expect(again.status === "IMPORTED" && again.imported).toBe(0);

    // The chain keeps growing as results are re-shared.
    const c = await offlineDevice(relay);
    await c.importPack((await b.exportPack()).bytes, "pack");
    await c.confirmPendingImport(true);
    expect(c.getState().capsules[0]?.provenance?.hops.length).toBe(5);

    [a, b, c].forEach((d) => d.dispose());
  });

  it("rejects tampered, forged and garbage packs", async () => {
    const relay = makeRelay();
    const a = await deviceWithResult(relay);
    const pack = await a.exportPack();
    const decoded = await decodePack(pack.bytes);

    const d = await offlineDevice(relay);
    await d.importPack(pack.bytes, "pack");
    await d.confirmPendingImport(true);
    const before = d.getState().capsules.length;

    // 1. A result edited in transit.
    const tampered = structuredClone(decoded);
    const first = tampered.capsules[0];
    if (first?.body.organic_results[0]) {
      first.body.organic_results[0].link = "https://evil.example/phish";
    }
    const t = await d.importPack(await encodePack(tampered), "pack");
    expect(t.status === "IMPORTED" && t.imported).toBe(0);
    expect(t.status === "IMPORTED" && t.rejected).toBe(1);
    expect(d.getState().capsules.length).toBe(before);

    // 2. An attacker re-signing under the relay's key id with their own key.
    const attacker = generateKeyPairSync("ed25519");
    const results = [
      { position: 1, title: "Scam", link: "https://evil.example", snippet: "x" },
    ];
    const params = { q: "best cafe in tokyo" };
    const noId = {
      key: computeRequestKey({ engine: "google", query: params.q, params }),
      chash: computeContentHash({
        organic_results: results,
        related_questions: [],
      }),
      engine: "google",
      params,
      fetched_at: new Date().toISOString(),
      ttl_s: 3600,
      source: { provider: "serpapi" },
      organic_results: results,
      related_questions: [],
    };
    const body = { id: computeCapsuleId(noId), ...noId };
    const forged = structuredClone(decoded);
    forged.capsules = [
      {
        v: 1,
        kid: "relay-1",
        alg: "Ed25519",
        sig: sign(
          null,
          Buffer.from(canonicalizeJson(body)),
          attacker.privateKey,
        ).toString("base64url"),
        body,
      } as (typeof forged.capsules)[number],
    ];
    forged.keys = [
      {
        kid: "relay-1",
        alg: "Ed25519",
        publicKeySpkiB64: attacker.publicKey
          .export({ type: "spki", format: "der" })
          .toString("base64"),
      },
    ];
    const f = await d.importPack(await encodePack(forged), "pack");
    expect(f.status === "IMPORTED" && f.imported).toBe(0);

    // 3. Not a pack at all.
    const g = await d.importPack(new TextEncoder().encode("hello"), "pack");
    expect(g.status).toBe("REJECTED");

    // 4. Declining the sender's key imports nothing.
    const e = await offlineDevice(relay);
    await e.importPack(pack.bytes, "pack");
    const declined = await e.confirmPendingImport(false);
    expect(declined.status === "IMPORTED" && declined.imported).toBe(0);
    expect(e.getState().capsules.length).toBe(0);

    [a, d, e].forEach((x) => x.dispose());
  });

  it("transfers over animated QR codes", async () => {
    const relay = makeRelay();
    const a = await deviceWithResult(relay);
    const f = await offlineDevice(relay);

    const qr = await a.prepareQr([a.getState().capsules[0]?.id ?? ""]);
    expect(qr.frames.length).toBeGreaterThan(0);
    expect(qr.frames.every((x) => x.length < 700)).toBe(true);

    let needsTrust = false;
    for (const frame of [...qr.frames].reverse()) {
      const result = await f.qrScan(frame);
      if (result.outcome?.status === "NEEDS_TRUST") needsTrust = true;
    }
    expect(needsTrust).toBe(true);

    const done = await f.confirmPendingImport(true);
    expect(done.status === "IMPORTED" && done.imported).toBe(1);
    expect(f.getState().capsules[0]?.provenance?.origin).toBe("qr");
    [a, f].forEach((x) => x.dispose());
  });

  it("never shares results it could not verify", async () => {
    const device = makeDevice(makeRelay());
    await device.init();
    const error = await device.exportPack().catch((e: unknown) => e);

    expect(error instanceof Error && /no verified/i.test(error.message)).toBe(
      true,
    );
    device.dispose();
  });
});

describe("network lab and opportunistic sync", () => {
  it("SetuSync beats a one-shot client on a lossy link", async () => {
    let seed = 7; // deterministic PRNG (mulberry32)
    const rng = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const device = makeDevice(makeRelay(), {
      chaos: { rng, sleep: async () => undefined },
    });
    await device.init();
    device.setNetworkProfile("LOSSY");

    for (let i = 0; i < 8; i += 1) {
      await device.compare(`query number ${i}`);
    }

    const { lab, chaos } = device.getState();
    expect(chaos.requests).toBeGreaterThan(20);
    expect(chaos.dropped + chaos.repliesLost).toBeGreaterThan(0);
    expect(lab.setusync.ok).toBeGreaterThan(lab.naive.ok);
    expect(lab.running).toBe(false);
    device.dispose();
  });

  it("counts queued-then-delivered searches and tracks link quality", async () => {
    const device = makeDevice(makeRelay());
    await device.init();
    device.setLinkQuality("slow-2g");
    device.setSimulatedOffline(true);
    await device.requestLive("late night food");
    device.setSimulatedOffline(false);

    expect(await settled(device, 1)).toBe(true);
    expect(device.getState().savings.queuedWhileOffline).toBe(1);
    expect(device.getState().savings.deliveredFromOutbox).toBe(1);

    device.setLinkQuality("4g");
    expect(device.getState().linkQuality).toBe("4g");
    device.dispose();
  });
});
