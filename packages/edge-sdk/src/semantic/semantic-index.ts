import type { Capsule } from "@setusync/protocol";

/**
 * On-device semantic (meaning-based) search. An Embedder turns text into a unit-length
 * vector; related meanings point the same way, so "cheap places to eat" finds a result
 * saying "budget restaurants". The model runs in the browser: no server, no credits.
 */
export interface Embedder {
  readonly id: string;
  /** One L2-normalised vector per text. */
  embed(texts: string[]): Promise<Float32Array[]>;
}

export interface SemanticDoc {
  docId: string;
  capsuleId: string;
  resultIndex: number;
  vector: Float32Array;
}

export interface SemanticStore {
  all(): Promise<SemanticDoc[]>;
  putMany(docs: SemanticDoc[]): Promise<void>;
  deleteCapsule(capsuleId: string): Promise<void>;
  clear(): Promise<void>;
}

export interface SemanticHit { capsuleId: string; resultIndex: number; score: number }

export class MemorySemanticStore implements SemanticStore {
  private readonly docs = new Map<string, SemanticDoc>();
  public async all(): Promise<SemanticDoc[]> { return [...this.docs.values()]; }
  public async putMany(docs: SemanticDoc[]): Promise<void> { for (const d of docs) this.docs.set(d.docId, d); }
  public async deleteCapsule(id: string): Promise<void> { for (const [k, d] of this.docs) if (d.capsuleId === id) this.docs.delete(k); }
  public async clear(): Promise<void> { this.docs.clear(); }
}

export class IndexedDbSemanticStore implements SemanticStore {
  private dbPromise: Promise<IDBDatabase> | undefined = undefined;

  public constructor(private readonly name = "SetuSyncSemantic") {}

  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore("docs", { keyPath: "docId" });
        s.createIndex("byCapsule", "capsuleId", { unique: false });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Could not open the meaning index"));
    });
    return this.dbPromise;
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction("docs", mode);
      const req = fn(t.objectStore("docs"));
      t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
      t.onerror = () => reject(t.error ?? new Error("Meaning index failed"));
      t.onabort = () => reject(t.error ?? new Error("Meaning index failed"));
    });
  }

  public async all(): Promise<SemanticDoc[]> { return ((await this.tx("readonly", (s) => s.getAll())) as SemanticDoc[] | undefined) ?? []; }
  public async putMany(docs: SemanticDoc[]): Promise<void> { await this.tx("readwrite", (s) => { for (const d of docs) s.put(d); }); }
  public async deleteCapsule(capsuleId: string): Promise<void> {
    await this.tx("readwrite", (s) => {
      const req = s.index("byCapsule").openKeyCursor(IDBKeyRange.only(capsuleId));
      req.onsuccess = () => { const c = req.result; if (c) { s.delete(c.primaryKey); c.continue(); } };
    });
  }
  public async clear(): Promise<void> { await this.tx("readwrite", (s) => { s.clear(); }); }
}

const BATCH = 16;

export function documentText(result: { title?: string; snippet?: string }): string {
  return `${result.title ?? ""}. ${result.snippet ?? ""}`.trim();
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

export class SemanticIndex {
  private docs: SemanticDoc[] = [];
  private loaded = false;

  public constructor(private readonly embedder: Embedder, private readonly store: SemanticStore) {}

  public get size(): number { return this.docs.length; }

  public async load(): Promise<void> {
    this.docs = await this.store.all();
    this.loaded = true;
  }

  /** Embeds results of new capsules and drops capsules that no longer exist. */
  public async sync(capsules: readonly Capsule[], onProgress?: (done: number, total: number) => void): Promise<{ added: number; removed: number }> {
    if (!this.loaded) await this.load();
    const live = new Set(capsules.map((c) => c.body.id));
    const have = new Set(this.docs.map((d) => d.capsuleId));

    let removed = 0;
    for (const id of have) {
      if (!live.has(id)) { await this.store.deleteCapsule(id); removed += 1; }
    }
    this.docs = this.docs.filter((d) => live.has(d.capsuleId));

    const pending: { capsuleId: string; resultIndex: number; text: string }[] = [];
    for (const capsule of capsules) {
      if (have.has(capsule.body.id)) continue;
      capsule.body.organic_results.forEach((r, i) => {
        const text = documentText(r);
        if (text.length > 2) pending.push({ capsuleId: capsule.body.id, resultIndex: i, text });
      });
    }

    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      const vectors = await this.embedder.embed(batch.map((b) => b.text));
      const docs = batch.map((b, j): SemanticDoc => ({ docId: `${b.capsuleId}:${b.resultIndex}`, capsuleId: b.capsuleId, resultIndex: b.resultIndex, vector: vectors[j] ?? new Float32Array() }));
      await this.store.putMany(docs);
      this.docs.push(...docs);
      onProgress?.(Math.min(i + BATCH, pending.length), pending.length);
    }

    return { added: pending.length, removed };
  }

  public async search(query: string, limit = 8, minScore = 0.35): Promise<SemanticHit[]> {
    if (!this.loaded) await this.load();
    const text = query.trim();
    if (!text || this.docs.length === 0) return [];
    const [q] = await this.embedder.embed([text]);
    if (!q) return [];
    return this.docs
      .map((d) => ({ capsuleId: d.capsuleId, resultIndex: d.resultIndex, score: dot(q, d.vector) }))
      .filter((h) => h.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
