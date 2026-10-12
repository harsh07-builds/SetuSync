import { describe, expect, it } from "vitest";
import { InboxFirstTransport, MemoryInbox, registerBackgroundSync, runBackgroundSync, requestInboxKey, type OutboxRecord, type OutboxStore, type CapsuleTransport } from "../src/index.js";
import { makeCapsule, makeSigner } from "./helpers-signed.js";

const signer = makeSigner();
const request = { engine: "google", query: "pharmacy delhi", params: { q: "pharmacy delhi" } };

function outboxWith(records: OutboxRecord[]): OutboxStore {
  return {
    put: async () => undefined, get: async () => undefined, delete: async () => undefined,
    listAll: async () => records,
    listByStatus: async (s: string) => records.filter((r) => r.status === s),
  } as unknown as OutboxStore;
}
const rec = (id: string, query: string): OutboxRecord => ({ id, request: { ...request, query, params: { q: query } }, status: "PENDING", attempts: 0, createdAt: "x", updatedAt: "x", requestState: "QUEUED" } as unknown as OutboxRecord);

describe("Background Sync", () => {
  it("downloads queued searches into the inbox and leaves the outbox for the page to verify", async () => {
    const inbox = new MemoryInbox();
    await inbox.setConfig({ baseUrl: "", installId: "i" });
    const fake: CapsuleTransport = { fetchCapsule: async (r) => makeCapsule(signer, r.query) };
    const out = await runBackgroundSync({ outbox: outboxWith([rec("1", "a b"), rec("2", "c d")]), inbox, makeTransport: () => fake });
    expect(out).toMatchObject({ delivered: 2, failed: 0 });
    expect(await inbox.count()).toBe(2);
  });

  it("stops and reports when the network is still down (so the browser retries)", async () => {
    const inbox = new MemoryInbox();
    await inbox.setConfig({ baseUrl: "", installId: "i" });
    const down: CapsuleTransport = { fetchCapsule: async () => { throw new Error("offline"); } };
    const out = await runBackgroundSync({ outbox: outboxWith([rec("1", "a"), rec("2", "b")]), inbox, makeTransport: () => down });
    expect(out.reason).toBe("OFFLINE_OR_ERROR");
    expect(out.delivered).toBe(0);
    expect(await inbox.count()).toBe(0);
  });

  it("does nothing without the page's relay config", async () => {
    const out = await runBackgroundSync({ outbox: outboxWith([rec("1", "a")]), inbox: new MemoryInbox() });
    expect(out.reason).toBe("NO_CONFIG");
  });

  it("the page uses the parked capsule once, then falls back to the Relay", async () => {
    const inbox = new MemoryInbox();
    const parked = makeCapsule(signer, request.query);
    await inbox.put(requestInboxKey(request), parked);
    let relayCalls = 0; let hits = 0;
    const relay: CapsuleTransport = { fetchCapsule: async (r) => { relayCalls += 1; return makeCapsule(signer, r.query, ["Z"]); } };
    const t = new InboxFirstTransport(inbox, relay, () => { hits += 1; });
    expect(await t.fetchCapsule(request)).toEqual(parked);
    expect(hits).toBe(1);
    expect(relayCalls).toBe(0);
    await t.fetchCapsule(request);
    expect(relayCalls).toBe(1);
  });

  it("registers the sync tag only where the browser supports it", async () => {
    const tags: string[] = [];
    expect(await registerBackgroundSync({ sync: { register: async (t) => { tags.push(t); } } })).toBe(true);
    expect(tags).toEqual(["setusync-outbox"]);
    expect(await registerBackgroundSync({})).toBe(false);
    expect(await registerBackgroundSync(undefined)).toBe(false);
  });
});
