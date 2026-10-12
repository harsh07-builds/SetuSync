import { describe, expect, it } from "vitest";
import { MemorySemanticStore, SemanticIndex, type Embedder } from "../src/index.js";
import { makeCapsule, makeSigner } from "./helpers-signed.js";

/** Tiny deterministic "model": concepts are axes, so synonyms point the same way. */
const CONCEPTS: string[][] = [["cheap", "budget", "affordable", "inexpensive"], ["eat", "food", "restaurant", "restaurants", "dining", "cafe"], ["hospital", "clinic", "doctor"], ["university", "college"]];
const fake: Embedder = {
  id: "fake",
  embed: async (texts) => texts.map((t) => {
    const v = new Float32Array(CONCEPTS.length);
    for (const w of t.toLowerCase().split(/\W+/)) CONCEPTS.forEach((c, i) => { if (c.includes(w)) v[i]! += 1; });
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  }),
};
const signer = makeSigner();

describe("semantic search", () => {
  it("finds results by meaning, not by shared words", async () => {
    const idx = new SemanticIndex(fake, new MemorySemanticStore());
    const capsule = makeCapsule(signer, "food", ["Budget restaurants in town", "Government hospital list", "Top college ranking"]);
    await idx.sync([capsule]);
    const hits = await idx.search("cheap places to eat");
    expect(hits[0]?.resultIndex).toBe(0);
    expect(hits.some((h) => h.resultIndex === 1)).toBe(false);
  });

  it("indexes only new capsules and removes deleted ones", async () => {
    const idx = new SemanticIndex(fake, new MemorySemanticStore());
    const a = makeCapsule(signer, "a", ["Hospital A", "Clinic B"]);
    const b = makeCapsule(signer, "b", ["University C"]);
    expect((await idx.sync([a])).added).toBe(2);
    expect((await idx.sync([a, b])).added).toBe(1);
    expect(idx.size).toBe(3);
    const out = await idx.sync([b]);
    expect(out.removed).toBe(1);
    expect(idx.size).toBe(1);
  });

  it("returns nothing for empty queries or an empty index", async () => {
    const idx = new SemanticIndex(fake, new MemorySemanticStore());
    expect(await idx.search("anything")).toEqual([]);
    expect(await idx.search("  ")).toEqual([]);
  });

  it("reloads vectors from the store after a restart", async () => {
    const store = new MemorySemanticStore();
    const first = new SemanticIndex(fake, store);
    await first.sync([makeCapsule(signer, "q", ["Affordable dining"])]);
    const second = new SemanticIndex(fake, store);
    await second.load();
    expect((await second.search("budget food"))[0]?.score).toBeGreaterThan(0.9);
  });
});
