import { describe, expect, it } from "vitest";
import {
  ArchivingCapsuleStore, CapsuleVerifier, DeltaError, Keyring, MemoryDeltaBaseStore, MemoryStorage, PACK_FORMAT,
  applyDelta, buildPack, createDelta, decodeDeltaPack, encodeDeltaPack, encodePack, inspectPack, rebuildFullPack,
  DELTA_PACK_FORMAT, type CapsuleRecord, type CapsuleStore,
} from "../src/index.js";
import { makeCapsule, makeSigner } from "./helpers-signed.js";

const signer = makeSigner();
const titles1 = Array.from({ length: 10 }, (_, i) => `Result${i}`);
const titles2 = [...titles1.slice(0, 9), "BrandNew"];
const base = makeCapsule(signer, "pharmacy delhi", titles1, "2026-10-10T00:00:00Z");
const next = makeCapsule(signer, "pharmacy delhi", titles2, "2026-10-11T00:00:00Z");

async function ring() { const r = new Keyring(new MemoryStorage()); await r.trust(signer.info, "relay"); return r; }

describe("delta capsules", () => {
  it("rebuilds the exact signed capsule and is much smaller than the full one", () => {
    const delta = createDelta(base, next)!;
    expect(applyDelta(base, delta)).toEqual(next);
    expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(next).length * 0.6);
  });

  it("the rebuilt capsule passes the normal signature verification", async () => {
    const rebuilt = applyDelta(base, createDelta(base, next)!);
    const verifier = new CapsuleVerifier((await ring()).resolver);
    expect((await verifier.verify(rebuilt)).valid).toBe(true);
  });

  it("refuses a different base and does not pretend about different searches", () => {
    const other = makeCapsule(signer, "other query", titles1);
    expect(createDelta(other, next)).toBeUndefined();
    expect(() => applyDelta(other, createDelta(base, next)!)).toThrow(DeltaError);
  });

  it("a tampered delta is rejected by verification, never imported", async () => {
    const delta = createDelta(base, next)!;
    const evil = JSON.parse(JSON.stringify(delta));
    JSON.stringify(evil.patch);
    const patch = evil.patch as { t: string; s?: Record<string, unknown> };
    // change a title inside the patch while keeping the same ids
    const text = JSON.stringify(delta).replace("BrandNew", "Scam site");
    const tampered = JSON.parse(text);
    let outcome: "threw" | "invalid" | "valid";
    try {
      const rebuilt = applyDelta(base, tampered);
      const v = await new CapsuleVerifier((await ring()).resolver).verify(rebuilt);
      outcome = v.valid ? "valid" : "invalid";
    } catch { outcome = "threw"; }
    expect(outcome).not.toBe("valid");
    expect(patch).toBeDefined();
  });

  it("delta pack -> full pack -> inspectPack verifies; missing base is reported", async () => {
    const dp = { format: DELTA_PACK_FORMAT, version: 1 as const, createdAt: "2026-10-11T00:00:00Z", deltas: [createDelta(base, next)!], keys: [signer.info], custody: {} };
    const bytes = await encodeDeltaPack(dp);
    const decoded = (await decodeDeltaPack(bytes))!;
    const ok = await rebuildFullPack(decoded, async (id) => (id === base.body.id ? base : undefined));
    expect(ok.rebuilt).toBe(1);
    expect(ok.pack.format).toBe(PACK_FORMAT);
    const report = await inspectPack(ok.pack, await ring());
    expect(report.valid).toHaveLength(1);
    const none = await rebuildFullPack(decoded, async () => undefined);
    expect(none.missingBase).toBe(1);
    expect(await decodeDeltaPack(await encodePack(buildPack({ capsules: [next], keys: [signer.info] })))).toBeUndefined();
  });

  it("archiving store keeps the replaced version as a delta base", async () => {
    const rows = new Map<string, CapsuleRecord>([[base.body.id, { capsule: base, storedAt: "x" }]]);
    const inner: CapsuleStore = {
      put: async (r) => { rows.set(r.capsule.body.id, r); },
      get: async (id) => rows.get(id),
      listAll: async () => [...rows.values()],
      findByKey: async (k) => [...rows.values()].filter((r) => r.capsule.body.key === k),
      delete: async (id) => { rows.delete(id); },
    };
    const bases = new MemoryDeltaBaseStore();
    await new ArchivingCapsuleStore(inner, bases).delete(base.body.id);
    expect(await bases.getById(base.body.id)).toEqual(base);
    expect(await bases.getByKey(base.body.key)).toEqual(base);
  });
});
