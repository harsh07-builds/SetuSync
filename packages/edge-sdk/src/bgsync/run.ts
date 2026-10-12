import type { CapsuleTransport } from "../transport.js";
import type { OutboxStore } from "../storage/types.js";
import { RelayCapsuleTransport } from "../relay-transport.js";
import { requestInboxKey, type InboxLike } from "./inbox.js";

export const BG_SYNC_TAG = "setusync-outbox";

export interface BgRunResult { delivered: number; failed: number; skipped: number; reason?: "NO_CONFIG" | "OFFLINE_OR_ERROR" }

/**
 * Runs inside the service worker's `sync` event. For every queued search it asks the
 * Relay and parks the signed capsule in the inbox. The outbox record is left in place:
 * the page verifies and stores the capsule, then removes the record.
 */
export async function runBackgroundSync(deps: {
  outbox: OutboxStore;
  inbox: InboxLike;
  fetchImpl?: typeof fetch;
  makeTransport?: (cfg: { baseUrl: string; installId: string }) => CapsuleTransport;
}): Promise<BgRunResult> {
  const config = await deps.inbox.getConfig();
  if (!config) return { delivered: 0, failed: 0, skipped: 0, reason: "NO_CONFIG" };

  const transport = (deps.makeTransport ?? ((c) => new RelayCapsuleTransport({
    baseUrl: c.baseUrl,
    installId: c.installId,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    maxWaitMs: 25_000,
  })))(config);

  const records = [
    ...(await deps.outbox.listByStatus("PENDING")),
    ...(await deps.outbox.listByStatus("FAILED")),
    ...(await deps.outbox.listByStatus("SENDING")),
  ];

  let delivered = 0;
  let failed = 0;

  for (const record of records) {
    try {
      const capsule = await transport.fetchCapsule(record.request);
      await deps.inbox.put(requestInboxKey(record.request), capsule);
      delivered += 1;
    } catch {
      failed += 1;
      // Most likely still offline: stop early so the browser retries the sync later.
      return { delivered, failed, skipped: records.length - delivered - failed, reason: "OFFLINE_OR_ERROR" };
    }
  }

  return { delivered, failed, skipped: 0 };
}

export async function registerBackgroundSync(reg: { sync?: { register(tag: string): Promise<void> } } | undefined): Promise<boolean> {
  if (!reg?.sync) return false;
  try { await reg.sync.register(BG_SYNC_TAG); return true; } catch { return false; }
}
