import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { BgInbox, IndexedDbOutboxStore, requestInboxKey } from "@setusync/edge-sdk";
import { makeCapsule, makeSigner } from "../../../packages/edge-sdk/test/helpers-signed.js";

/**
 * Runs the REAL service-worker code (src/sw-bg.ts) against a fake worker scope:
 * an outbox record is queued "while the tab was open", then the browser fires the
 * `sync` event with no page around, and the capsule must appear in the inbox.
 */
describe("Background Sync worker (end to end, no page)", () => {
  it("finishes a queued search on its own and leaves it for the page to verify", async () => {
    const signer = makeSigner();
    const request = { engine: "google", query: "pharmacy in delhi", params: { q: "pharmacy in delhi" } };
    const capsule = makeCapsule(signer, request.query);
    const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
    const listeners: Record<string, (e: unknown) => void> = {};
    const posted: unknown[] = [];

    const scope = globalThis as unknown as Record<string, unknown>;
    scope.self = Object.assign(scope, {
      addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; },
      clients: { matchAll: async () => [{ postMessage: (m: unknown) => posted.push(m) }] },
      fetch: async (url: string, init: { method: string; headers: Record<string, string> }) => {
        calls.push({ url: String(url), method: init.method, headers: init.headers });
        return new Response(JSON.stringify({ state: "READY", key: "k", capsule }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    // 1. The page (tab open): queues the search and tells the worker where the relay is.
    await new IndexedDbOutboxStore().put({
      id: "r1", request, status: "PENDING", attempts: 0, createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z", requestState: "QUEUED",
    } as never);
    const inbox = new BgInbox();
    await inbox.setConfig({ baseUrl: "", installId: "3f0b9c0e-4e5a-4a8e-9a53-0d6b7c1d2e3f" });

    // 2. The tab is closed. The browser wakes the worker with a sync event.
    await import("../src/sw-bg.js");
    expect(typeof listeners.sync).toBe("function");
    let work: Promise<unknown> | undefined;
    listeners.sync!({ tag: "setusync-outbox", waitUntil: (p: Promise<unknown>) => { work = p; } });
    await work;

    // 3. The worker asked the relay with the right headers and parked the capsule.
    expect(calls[0]?.url).toBe("/v1/search");
    expect(calls[0]?.headers["X-SetuSync-Install-Id"]).toBe("3f0b9c0e-4e5a-4a8e-9a53-0d6b7c1d2e3f");
    expect(calls[0]?.headers["Idempotency-Key"]).toBeTruthy();
    expect(await inbox.take(requestInboxKey(request))).toEqual(capsule);
    expect(posted).toEqual([{ type: "BG_SYNC_DONE", delivered: 1 }]);
  });
});
