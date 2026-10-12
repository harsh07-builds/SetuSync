import { describe, expect, it } from "vitest";
import type { Embedder } from "@setusync/edge-sdk";

import { makeDevice, makeRelay, settled, waitFor } from "./helpers.js";

const CONCEPTS = [["cheap", "budget", "affordable"], ["eat", "restaurants", "restaurant", "cafe", "dining"], ["hospital", "clinic"]];
const fakeEmbedder: Embedder = {
  id: "fake",
  embed: async (texts) =>
    texts.map((t) => {
      const v = new Float32Array(CONCEPTS.length);
      for (const w of t.toLowerCase().split(/\W+/)) CONCEPTS.forEach((c, i) => { if (c.includes(w)) v[i]! += 1; });
      const n = Math.hypot(...v) || 1;
      return v.map((x) => x / n);
    }),
};

describe("delta capsules between two devices", () => {
  it("sends only the changes and the receiver ends up with the exact signed capsule", async () => {
    const relay = makeRelay();
    relay.titles = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta"];
    const a = makeDevice(relay);
    const b = makeDevice(relay, { browserOnline: false });
    await a.init();
    await b.init();

    await a.requestLive("best cafe in tokyo");
    await settled(a, 1);
    const first = await a.exportPack();
    expect((await b.importPack(first.bytes, "pack", { approvedKids: [relay.signer.kid] })).status).toBe("IMPORTED");

    // The search changes on the relay; A refreshes.
    relay.cache.clear();
    relay.titles = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Brand new place"];
    await a.requestLive("best cafe in tokyo", { force: true });
    await waitFor(() => a.getState().capsules[0]?.resultCount !== undefined && a.getState().capsules.length === 1 && !a.getState().syncing);

    const update = await a.exportDeltaPack();
    const full = await a.exportPack();
    expect(update.bytes.length).toBeLessThan(full.bytes.length);

    const outcome = await b.importPack(update.bytes, "pack");
    expect(outcome.status).toBe("IMPORTED");
    expect(b.searchLocal("brand new place").hits.length).toBeGreaterThan(0);
    expect(b.getState().savings.deltaCapsules).toBe(1);
    a.dispose();
    b.dispose();
  });

  it("refuses an update when the earlier version is missing", async () => {
    const relay = makeRelay();
    const a = makeDevice(relay);
    const stranger = makeDevice(relay, { browserOnline: false });
    await a.init();
    await stranger.init();
    await a.requestLive("pharmacy delhi");
    await settled(a, 1);
    relay.cache.clear();
    relay.titles = ["Changed A", "Changed B"];
    await a.requestLive("pharmacy delhi", { force: true });
    await waitFor(() => !a.getState().syncing);
    const update = await a.exportDeltaPack();
    const outcome = await stranger.importPack(update.bytes, "pack");
    expect(outcome.status).toBe("REJECTED");
    a.dispose();
    stranger.dispose();
  });
});

describe("peer exchange between two controllers", () => {
  it("offers only verified searches and the other phone imports them through verification", async () => {
    const relay = makeRelay();
    const a = makeDevice(relay);
    const b = makeDevice(relay, { browserOnline: false });
    await a.init();
    await b.init();
    await a.requestLive("government hospital");
    await settled(a, 1);

    const offered = await a.p2pBuild(await b.p2pManifest());
    expect(offered).toHaveLength(1);
    // B has never been online, so it asks the user to approve the relay's signing key first.
    expect((await b.p2pReceive(offered[0]!.bytes)).imported).toBe(0);
    expect(b.getState().pendingTrust).toBeDefined();
    expect((await b.confirmPendingImport(true)).status).toBe("IMPORTED");
    expect(b.getState().savings.p2pCapsules).toBe(1);
    expect(b.getState().capsules[0]?.provenance?.origin).toBe("p2p");

    // Nothing left to send once both have it.
    expect(await a.p2pBuild(await b.p2pManifest())).toHaveLength(0);
    a.dispose();
    b.dispose();
  });
});

describe("smart (semantic) search", () => {
  it("finds a saved result by meaning and counts it", async () => {
    const relay = makeRelay();
    relay.titles = ["Budget restaurants in town", "Government hospital list"];
    const device = makeDevice(relay, { embedderFactory: async () => fakeEmbedder });
    await device.init();
    await device.requestLive("places in town");
    await settled(device, 1);

    await device.enableSemantic();
    expect(device.getState().semantic.status).toBe("ready");

    const hits = await device.searchSemantic("cheap places to eat");
    expect(hits[0]?.title).toBe("Budget restaurants in town");
    expect(device.getState().savings.semanticAnswers).toBe(1);
    device.dispose();
  });

  it("reports a clear error when the model cannot be downloaded", async () => {
    const device = makeDevice(makeRelay(), { embedderFactory: async () => { throw new Error("no network"); } });
    await device.init();
    await device.enableSemantic();
    expect(device.getState().semantic.status).toBe("error");
    expect(device.getState().semantic.message).toMatch(/Smart search/);
    device.dispose();
  });
});
