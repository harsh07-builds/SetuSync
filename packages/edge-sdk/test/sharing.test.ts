import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canonicalizeJson,
  computeCapsuleId,
  computeContentHash,
  computeRequestKey,
  type Capsule,
} from "@setusync/protocol";

import {
  CHAOS_PROFILES,
  FrameAssembler,
  Keyring,
  MemoryStorage,
  PackError,
  QrTransferTooLargeError,
  SavingsTracker,
  VolatilityTracker,
  areEquivalentQueries,
  buildPack,
  createChaosFetch,
  decodePack,
  encodePack,
  gzip,
  inspectPack,
  keyFingerprint,
  makeQrFrames,
  normalizeQuery,
  resultsSignature,
  spkiToRawKey,
  type PublicKeyInfo,
} from "../src/index.js";

// ---------- fixtures: genuinely signed capsules ----------

interface Signer {
  kid: string;
  privateKey: KeyObject;
  info: PublicKeyInfo;
}

function makeSigner(kid: string): Signer {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  return {
    kid,
    privateKey,
    info: {
      kid,
      alg: "Ed25519",
      publicKeySpkiB64: publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
    },
  };
}

function makeCapsule(
  signer: Signer,
  query: string,
  titles: string[] = ["Alpha", "Beta"],
): Capsule {
  const results = titles.map((title, i) => ({
    position: i + 1,
    title,
    link: `https://example.com/${title.toLowerCase()}`,
    snippet: `About ${title} for ${query}`,
  }));

  const params = { q: query };
  const bodyWithoutId = {
    key: computeRequestKey({ engine: "google", query, params }),
    chash: computeContentHash({
      organic_results: results,
      related_questions: [],
    }),
    engine: "google",
    params,
    fetched_at: "2026-10-10T00:00:00Z",
    ttl_s: 3600,
    source: { provider: "serpapi" },
    organic_results: results,
    related_questions: [],
  };

  const body = { id: computeCapsuleId(bodyWithoutId), ...bodyWithoutId };
  const sig = sign(
    null,
    Buffer.from(canonicalizeJson(body)),
    signer.privateKey,
  ).toString("base64url");

  return { v: 1, kid: signer.kid, alg: "Ed25519", sig, body } as Capsule;
}

async function trustedKeyring(...signers: Signer[]): Promise<Keyring> {
  const ring = new Keyring(new MemoryStorage());

  for (const s of signers) {
    await ring.trust(s.info, "relay");
  }

  return ring;
}

// ---------- query normalisation ----------

describe("normalizeQuery", () => {
  it("makes different phrasings of the same search equivalent", () => {
    expect(areEquivalentQueries("Best cafe in Tokyo", "best  cafes tokyo?")).toBe(true);
    expect(areEquivalentQueries("tokyo best cafe", "Best cafe in Tokyo")).toBe(true);
  });

  it("keeps genuinely different searches apart", () => {
    expect(areEquivalentQueries("cafe in Tokyo", "cafe in Osaka")).toBe(false);
    expect(areEquivalentQueries("best cafe", "worst cafe")).toBe(false);
  });

  it("sends only a light normalisation (never reorders words)", () => {
    expect(normalizeQuery('  "Best   Cafe in Tokyo!" ').display).toBe("best cafe in tokyo");
  });

  it("handles Devanagari without splitting words apart", () => {
    const n = normalizeQuery("दिल्ली में अस्पताल");
    expect(n.canonical).toContain("अस्पताल");
    expect(n.canonical).toContain("दिल्ली");
  });

  it("keeps c++ and c# distinct", () => {
    expect(areEquivalentQueries("c++ tutorial", "c# tutorial")).toBe(false);
  });

  it("never returns an empty canonical form for stopword-only input", () => {
    expect(normalizeQuery("in the").canonical).toBe("in the");
  });
});

// ---------- keyring ----------

describe("Keyring", () => {
  it("converts SPKI to the raw 32-byte key the verifier needs", () => {
    const s = makeSigner("k1");
    expect(spkiToRawKey(s.info.publicKeySpkiB64)?.length).toBe(32);
    expect(spkiToRawKey("AAAA")).toBeUndefined();
  });

  it("trusts a key, refuses to rebind a kid, and persists", async () => {
    const storage = new MemoryStorage();
    const a = makeSigner("same-kid");
    const b = makeSigner("same-kid");
    const ring = new Keyring(storage);

    const first = await ring.trust(a.info, "relay");
    expect(first.ok).toBe(true);

    const again = await ring.trust(a.info, "relay");
    expect(again.ok && again.alreadyTrusted).toBe(true);

    const swap = await ring.trust(b.info, "user");
    expect(swap).toMatchObject({ ok: false, reason: "KEY_CONFLICT" });

    expect(new Keyring(storage).has("same-kid")).toBe(true);
  });

  it("rejects malformed keys", async () => {
    const ring = new Keyring(new MemoryStorage());
    const bad = await ring.trust(
      { kid: "x", alg: "Ed25519", publicKeySpkiB64: "bm90LWEta2V5" },
      "user",
    );
    expect(bad).toMatchObject({ ok: false, reason: "INVALID_KEY" });
  });

  it("produces a stable human-comparable fingerprint", async () => {
    const s = makeSigner("k");
    const f1 = await keyFingerprint(s.info.publicKeySpkiB64);
    expect(f1).toBe(await keyFingerprint(s.info.publicKeySpkiB64));
    expect(/^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/.test(f1)).toBe(true);
  });
});

// ---------- packs ----------

describe("capsule packs", () => {
  it("round-trips through gzip and verifies", async () => {
    const s = makeSigner("relay-1");
    const capsules = [makeCapsule(s, "best cafe tokyo"), makeCapsule(s, "ramen osaka")];
    const bytes = await encodePack(buildPack({ capsules, keys: [s.info] }));

    const decoded = await decodePack(bytes);
    const report = await inspectPack(decoded, await trustedKeyring(s));

    expect(report.valid.length).toBe(2);
    expect(report.invalid.length).toBe(0);
  });

  it("detects a tampered capsule", async () => {
    const s = makeSigner("relay-1");
    const good = makeCapsule(s, "best cafe tokyo");
    const evil = structuredClone(good);
    evil.body.organic_results[0]!.link = "https://evil.example/phish";

    const pack = buildPack({ capsules: [evil], keys: [s.info] });
    const report = await inspectPack(pack, await trustedKeyring(s));

    expect(report.valid.length).toBe(0);
    expect(report.invalid[0]?.verification.reason).toBe("Capsule content hash mismatch");
  });

  it("detects a re-signed capsule from an attacker's own key", async () => {
    const real = makeSigner("relay-1");
    const attacker = makeSigner("relay-1"); // claims the same kid
    const forged = makeCapsule(attacker, "best cafe tokyo", ["Scam"]);

    const pack = buildPack({ capsules: [forged], keys: [attacker.info] });
    const report = await inspectPack(pack, await trustedKeyring(real));

    expect(report.valid.length).toBe(0);
    expect(report.invalid[0]?.verification.reason).toBe("Invalid capsule signature");
  });

  it("never accepts an unknown key silently, but offers it for approval", async () => {
    const stranger = makeSigner("friend-key");
    const capsule = makeCapsule(stranger, "tea");
    const pack = buildPack({ capsules: [capsule], keys: [stranger.info] });

    const ring = new Keyring(new MemoryStorage());
    const before = await inspectPack(pack, ring);

    expect(before.valid.length).toBe(0);
    expect(before.needsTrust.map((k) => k.kid)).toEqual(["friend-key"]);

    await ring.trust(before.needsTrust[0]!, "user");
    const after = await inspectPack(pack, ring);
    expect(after.valid.length).toBe(1);
  });

  it("does not offer keys the pack did not include", async () => {
    const stranger = makeSigner("friend-key");
    const pack = buildPack({
      capsules: [makeCapsule(stranger, "tea")],
      keys: [],
    });

    const report = await inspectPack(pack, new Keyring(new MemoryStorage()));
    expect(report.needsTrust.length).toBe(0);
  });

  it("rejects files that are not packs", async () => {
    await expect(decodePack(new TextEncoder().encode("hello"))).rejects.toMatchObject({
      code: "NOT_A_PACK",
    });
    await expect(
      decodePack(new TextEncoder().encode('{"format":"other"}')),
    ).rejects.toMatchObject({ code: "NOT_A_PACK" });
    await expect(
      decodePack(new Uint8Array([0x1f, 0x8b, 1, 2, 3, 4, 5])),
    ).rejects.toMatchObject({ code: "NOT_A_PACK" });
  });

  it("rejects a newer pack version", async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ format: "setusync-pack", version: 99, capsules: [], keys: [] }),
    );
    await expect(decodePack(bytes)).rejects.toMatchObject({ code: "UNSUPPORTED_VERSION" });
  });

  it("stops a decompression bomb", async () => {
    const huge = new Uint8Array(30 * 1024 * 1024).fill(97); // 30 MB of 'a'
    const bomb = await gzip(huge);
    expect(bomb.length < 1_000_000).toBe(true);

    const error = await decodePack(bomb).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PackError);
    expect((error as PackError).code).toBe("TOO_LARGE");
  });

  it("rejects packs with too many capsules", async () => {
    const s = makeSigner("k");
    const c = makeCapsule(s, "x");
    const bytes = new TextEncoder().encode(
      JSON.stringify(
        buildPack({ capsules: Array.from({ length: 201 }, () => c), keys: [s.info] }),
      ),
    );
    await expect(decodePack(bytes)).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("only ships keys that signed the included capsules", () => {
    const a = makeSigner("a");
    const b = makeSigner("b");
    const pack = buildPack({ capsules: [makeCapsule(a, "q")], keys: [a.info, b.info] });
    expect(pack.keys.map((k) => k.kid)).toEqual(["a"]);
  });
});

// ---------- QR frames ----------

describe("QR frames", () => {
  function payload(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) out[i] = (i * 37 + 11) & 255;
    return out;
  }

  it("reassembles from shuffled, duplicated frames", async () => {
    const data = payload(1500);
    const frames = await makeQrFrames(data);
    expect(frames.length).toBeGreaterThan(3);

    const assembler = new FrameAssembler();
    const order = [...frames.keys()].reverse().concat([0, 0, 2]);

    for (const i of order) {
      assembler.add(frames[i]!);
    }

    expect(assembler.isComplete).toBe(true);
    expect(await assembler.finish()).toEqual(data);
  });

  it("reports progress and ignores frames from another transfer", async () => {
    const a = await makeQrFrames(payload(900));
    const b = await makeQrFrames(payload(901));
    const assembler = new FrameAssembler();

    expect(assembler.add(a[0]!)).toMatchObject({ accepted: true, received: 1 });
    expect(assembler.add(b[1]!)).toMatchObject({ accepted: false, ignored: "OTHER_TRANSFER" });
    expect(assembler.add("https://example.com")).toMatchObject({ ignored: "NOT_SETUSYNC" });
    expect(assembler.add("SP1.zz.0.1.AAAA")).toMatchObject({ ignored: "MALFORMED" });
    expect(assembler.received).toBe(1);
  });

  it("detects corrupted data at the end", async () => {
    const frames = await makeQrFrames(payload(800));
    const parts = frames[1]!.split(".");
    parts[4] = parts[4]!.replace(/.$/u, parts[4]!.endsWith("A") ? "B" : "A");
    const corrupted = [frames[0]!, parts.join("."), ...frames.slice(2)];

    const assembler = new FrameAssembler();
    corrupted.forEach((f) => assembler.add(f));

    await expect(assembler.finish()).rejects.toMatchObject({
      message: "The received data is damaged. Please scan again.",
    });
  });

  it("refuses transfers that would need too many codes", async () => {
    const error = await makeQrFrames(payload(100_000)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QrTransferTooLargeError);
  });

  it("carries a real signed pack end to end", async () => {
    const s = makeSigner("relay-1");
    const bytes = await encodePack(
      buildPack({ capsules: [makeCapsule(s, "best cafe tokyo")], keys: [s.info] }),
    );
    const assembler = new FrameAssembler();
    (await makeQrFrames(bytes)).forEach((f) => assembler.add(f));

    const report = await inspectPack(
      await decodePack(await assembler.finish()),
      await trustedKeyring(s),
    );
    expect(report.valid.length).toBe(1);
  });
});

// ---------- volatility ----------

describe("VolatilityTracker", () => {
  const t0 = new Date("2026-10-01T00:00:00Z");
  const at = (hours: number): Date => new Date(t0.getTime() + hours * 3600_000);

  it("admits it does not know with too little history", () => {
    const v = new VolatilityTracker(new MemoryStorage());
    expect(v.assess("q", 100).verdict).toBe("UNKNOWN");
    v.record("q", "a", t0);
    expect(v.assess("q", 100).verdict).toBe("UNKNOWN");
  });

  it("trusts a result that never changed", () => {
    const v = new VolatilityTracker(new MemoryStorage());
    v.record("cafe", "a", t0);
    v.record("cafe", "a", at(72));
    expect(v.assess("cafe", 24 * 3600).verdict).toBe("LIKELY_VALID");
    expect(v.assess("cafe", 20 * 24 * 3600).verdict).toBe("MAY_HAVE_CHANGED");
  });

  it("distrusts a result that changes every fetch", () => {
    const v = new VolatilityTracker(new MemoryStorage());
    v.record("news", "a", t0);
    v.record("news", "b", at(1));
    v.record("news", "c", at(2));
    expect(v.assess("news", 3 * 3600).verdict).toBe("MAY_HAVE_CHANGED");
  });

  it("persists history", () => {
    const storage = new MemoryStorage();
    new VolatilityTracker(storage).record("q", "a", t0);
    expect(new VolatilityTracker(storage).get("q")?.fetches).toBe(1);
  });

  it("builds a signature from the top results", () => {
    const s = makeSigner("k");
    const a = makeCapsule(s, "q", ["One", "Two"]);
    const b = makeCapsule(s, "q", ["One", "Three"]);
    expect(resultsSignature(a)).not.toBe(resultsSignature(b));
  });
});

// ---------- savings ----------

describe("SavingsTracker", () => {
  it("counts credits avoided and reuse rate", () => {
    const s = new SavingsTracker(new MemoryStorage());
    s.add("liveFetches", 2);
    s.add("freshCacheHits", 3);
    s.add("equivalentHits", 1);
    s.add("peerCapsules", 4);

    const snap = s.snapshot();
    expect(snap.creditsAvoided).toBe(8);
    expect(snap.reuseRate).toBe(0.8);
  });

  it("starts at zero and survives reload and corrupt storage", () => {
    const storage = new MemoryStorage();
    expect(new SavingsTracker(storage).snapshot().reuseRate).toBe(0);

    new SavingsTracker(storage).add("liveFetches", 5);
    expect(new SavingsTracker(storage).snapshot().liveFetches).toBe(5);

    storage.setItem("setusync.savings.v1", "{not json");
    expect(new SavingsTracker(storage).snapshot().liveFetches).toBe(0);
  });
});

// ---------- network chaos ----------

describe("createChaosFetch", () => {
  const ok = async (): Promise<Response> => new Response("{}", { status: 200 });

  function seeded(values: number[]): () => number {
    let i = 0;
    return () => values[i++ % values.length]!;
  }

  it("passes straight through on a perfect network", async () => {
    let calls = 0;
    const f = createChaosFetch(
      (async () => {
        calls += 1;
        return new Response("{}");
      }) as typeof fetch,
      () => CHAOS_PROFILES.PERFECT,
    );
    expect((await f("http://x")).status).toBe(200);
    expect(calls).toBe(1);
  });

  it("drops a request before the server sees it", async () => {
    let calls = 0;
    const f = createChaosFetch(
      (async () => {
        calls += 1;
        return ok();
      }) as typeof fetch,
      () => CHAOS_PROFILES.LOSSY,
      { rng: seeded([0.0, 0.1, 0.1]), sleep: async () => undefined },
    );
    await expect(f("http://x")).rejects.toBeInstanceOf(TypeError);
    expect(calls).toBe(0);
  });

  it("loses the reply AFTER the server did the work", async () => {
    let calls = 0;
    const f = createChaosFetch(
      (async () => {
        calls += 1;
        return ok();
      }) as typeof fetch,
      () => CHAOS_PROFILES.LOSSY,
      { rng: seeded([0.0, 0.1, 0.9]), sleep: async () => undefined },
    );
    await expect(f("http://x")).rejects.toBeInstanceOf(TypeError);
    expect(calls).toBe(1);
  });

  it("is unreachable during the down window of a tunnel", async () => {
    let clock = 0;
    const f = createChaosFetch(ok as typeof fetch, () => CHAOS_PROFILES.TUNNEL, {
      rng: () => 0.99,
      sleep: async () => undefined,
      now: () => clock,
    });

    expect((await f("http://x")).status).toBe(200);
    clock = 7_000;
    await expect(f("http://x")).rejects.toBeInstanceOf(TypeError);
    clock = 13_000;
    expect((await f("http://x")).status).toBe(200);
  });

  it("can be aborted while waiting on a slow link", async () => {
    const controller = new AbortController();
    const f = createChaosFetch(ok as typeof fetch, () => CHAOS_PROFILES["2G"], {
      rng: () => 0.99,
    });
    const pending = f("http://x", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
