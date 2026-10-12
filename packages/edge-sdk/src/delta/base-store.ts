import type { Capsule } from "@setusync/protocol";
import type { CapsuleStore, CapsuleRecord } from "../storage/types.js";

/** Remembers the previous version of each search so a later update can be sent as a delta. */
export interface DeltaBaseStore {
  save(capsule: Capsule): Promise<void>;
  /** The saved earlier version of a search (by request key). */
  getByKey(key: string): Promise<Capsule | undefined>;
  getById(id: string): Promise<Capsule | undefined>;
}

export class MemoryDeltaBaseStore implements DeltaBaseStore {
  private readonly byKey = new Map<string, Capsule>();
  public async save(c: Capsule): Promise<void> { this.byKey.set(c.body.key, c); }
  public async getByKey(key: string): Promise<Capsule | undefined> { return this.byKey.get(key); }
  public async getById(id: string): Promise<Capsule | undefined> {
    return [...this.byKey.values()].find((c) => c.body.id === id);
  }
}

const DB = "SetuSyncDeltaBase";

/** Own small database, so the main SetuSyncDB schema is never touched. */
export class IndexedDbDeltaBaseStore implements DeltaBaseStore {
  private dbPromise?: Promise<IDBDatabase>;

  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore("bases", { keyPath: "key" });
        store.createIndex("byId", "id", { unique: false });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Could not open delta store"));
    });
    return this.dbPromise;
  }

  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction("bases", mode).objectStore("bases"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Delta store failed"));
    });
  }

  public async save(capsule: Capsule): Promise<void> {
    await this.run("readwrite", (s) => s.put({ key: capsule.body.key, id: capsule.body.id, capsule }));
  }
  public async getByKey(key: string): Promise<Capsule | undefined> {
    return ((await this.run("readonly", (s) => s.get(key))) as { capsule: Capsule } | undefined)?.capsule;
  }
  public async getById(id: string): Promise<Capsule | undefined> {
    return ((await this.run("readonly", (s) => s.index("byId").get(id))) as { capsule: Capsule } | undefined)?.capsule;
  }
}

/** Wraps a CapsuleStore: whenever a capsule is replaced by a newer one, keep it as a delta base. */
export class ArchivingCapsuleStore implements CapsuleStore {
  public constructor(private readonly inner: CapsuleStore, private readonly bases: DeltaBaseStore) {}
  public put(r: CapsuleRecord): Promise<void> { return this.inner.put(r); }
  public get(id: string): Promise<CapsuleRecord | undefined> { return this.inner.get(id); }
  public listAll(): Promise<CapsuleRecord[]> { return this.inner.listAll(); }
  public findByKey(key: string): Promise<CapsuleRecord[]> { return this.inner.findByKey(key); }
  public async delete(id: string): Promise<void> {
    try {
      const old = await this.inner.get(id);
      if (old) await this.bases.save(old.capsule);
    } catch { /* archiving is best effort; never block the delete */ }
    await this.inner.delete(id);
  }
}
