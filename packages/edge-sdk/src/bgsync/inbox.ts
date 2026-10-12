import type { Capsule, CapsuleRequest } from "@setusync/protocol";
import { computeRequestKey } from "@setusync/protocol";
import type { CapsuleTransport } from "../transport.js";

/**
 * Background Sync hand-over. The service worker (which has no access to the page's
 * keyring) downloads results for queued searches and parks the RAW signed capsules
 * here. The page picks them up the next time it runs, and the normal SyncEngine then
 * verifies the signature and stores them. The service worker is never trusted.
 */
export interface BgConfig { baseUrl: string; installId: string }

export interface InboxLike {
  put(requestKey: string, capsule: Capsule): Promise<void>;
  take(requestKey: string): Promise<Capsule | undefined>;
  count(): Promise<number>;
  setConfig(config: BgConfig): Promise<void>;
  getConfig(): Promise<BgConfig | undefined>;
}

export class MemoryInbox implements InboxLike {
  private readonly items = new Map<string, Capsule>();
  private config?: BgConfig;
  public async put(k: string, c: Capsule): Promise<void> { this.items.set(k, c); }
  public async take(k: string): Promise<Capsule | undefined> { const c = this.items.get(k); this.items.delete(k); return c; }
  public async count(): Promise<number> { return this.items.size; }
  public async setConfig(c: BgConfig): Promise<void> { this.config = c; }
  public async getConfig(): Promise<BgConfig | undefined> { return this.config; }
}

const DB = "SetuSyncBgInbox";

export class BgInbox implements InboxLike {
  private dbPromise?: Promise<IDBDatabase>;

  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("inbox", { keyPath: "requestKey" });
        req.result.createObjectStore("config", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Could not open the background inbox"));
    });
    return this.dbPromise;
  }

  private async tx<T>(store: "inbox" | "config", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Inbox operation failed"));
    });
  }

  public async put(requestKey: string, capsule: Capsule): Promise<void> {
    await this.tx("inbox", "readwrite", (s) => s.put({ requestKey, capsule, at: new Date().toISOString() }));
  }
  public async take(requestKey: string): Promise<Capsule | undefined> {
    const row = (await this.tx("inbox", "readonly", (s) => s.get(requestKey))) as { capsule: Capsule } | undefined;
    if (!row) return undefined;
    await this.tx("inbox", "readwrite", (s) => s.delete(requestKey));
    return row.capsule;
  }
  public async count(): Promise<number> { return this.tx("inbox", "readonly", (s) => s.count()); }
  public async setConfig(config: BgConfig): Promise<void> { await this.tx("config", "readwrite", (s) => s.put({ id: "relay", ...config })); }
  public async getConfig(): Promise<BgConfig | undefined> {
    const row = (await this.tx("config", "readonly", (s) => s.get("relay"))) as (BgConfig & { id: string }) | undefined;
    return row ? { baseUrl: row.baseUrl, installId: row.installId } : undefined;
  }
}

export function requestInboxKey(request: CapsuleRequest): string {
  return computeRequestKey(request);
}

/** Page-side transport: use a capsule the service worker already downloaded, else ask the Relay. */
export class InboxFirstTransport implements CapsuleTransport {
  public constructor(
    private readonly inbox: InboxLike,
    private readonly next: CapsuleTransport,
    private readonly onInboxHit?: () => void,
  ) {}

  public async fetchCapsule(request: CapsuleRequest): Promise<Capsule> {
    try {
      const hit = await this.inbox.take(requestInboxKey(request));
      if (hit) { this.onInboxHit?.(); return hit; }
    } catch { /* inbox unavailable: fall through to the Relay */ }
    return this.next.fetchCapsule(request);
  }
}
