/// <reference lib="webworker" />
// Background Sync worker code. Built to dist/bg-sync.js and loaded by public/sw.js
// with importScripts(). It finishes queued searches even after the tab is closed.
import { BG_SYNC_TAG, BgInbox, IndexedDbOutboxStore, runBackgroundSync } from "@setusync/edge-sdk";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

declare const self: ServiceWorkerGlobalScope;

self.addEventListener("sync", (event) => {
  const e = event as Event & { tag: string; waitUntil(p: Promise<unknown>): void };
  if (e.tag !== BG_SYNC_TAG) return;

  e.waitUntil(
    (async () => {
      const outbox = new IndexedDbOutboxStore();
      const pending = async (): Promise<number> =>
        (await outbox.listByStatus("PENDING")).length +
        (await outbox.listByStatus("FAILED")).length +
        (await outbox.listByStatus("SENDING")).length;
      const pageOpen = async (): Promise<boolean> =>
        (await self.clients.matchAll({ includeUncontrolled: true, type: "window" })).some(
          (c) => (c as WindowClient).visibilityState === "visible",
        );

      // A visible page is already sending these itself. Give it a moment so the
      // search is not run twice; if the tab closes, step in and finish the job.
      for (let waited = 0; waited < 20_000 && (await pageOpen()) && (await pending()) > 0; waited += 1000) {
        await sleep(1000);
      }
      if ((await pending()) === 0) return;

      const result = await runBackgroundSync({
        outbox,
        inbox: new BgInbox(),
        fetchImpl: self.fetch.bind(self),
      });

      if (result.delivered > 0) {
        const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
        for (const client of clients) client.postMessage({ type: "BG_SYNC_DONE", delivered: result.delivered });
      }

      // Rejecting makes the browser retry the sync later with backoff.
      if (result.reason === "OFFLINE_OR_ERROR") throw new Error("Still offline; will retry.");
    })(),
  );
});
