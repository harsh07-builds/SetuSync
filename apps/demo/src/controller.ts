import {
  CHAOS_PROFILES,
  CapsuleIndexer,
  CapsuleVerifier,
  FrameAssembler,
  FreshnessPolicy,
  Keyring,
  QrTransferTooLargeError,
  SavingsTracker,
  VolatilityTracker,
  buildPack,
  createChaosFetch,
  decodePack,
  encodePack,
  fetchRelayKeys,
  inspectPack,
  keyFingerprint,
  makeQrFrames,
  normalizeQuery,
  resultsSignature,
  safeLocalStorage,
  PackError,
  PACK_FILE_EXTENSION,
  IndexedDbCapsuleStore,
  IndexedDbMetadataStore,
  IndexedDbOutboxStore,
  IndexedDbSyncStateStore,
  LocalSearchIndex,
  OfflineSearch,
  RelayCapsuleTransport,
  RelayError,
  SyncEngine,
  type Capsule,
  type CapsuleStore,
  type ChaosProfileName,
  type CustodyHop,
  type FrameProgress,
  type FreshnessEvaluation,
  type KeyValueStorage,
  type SavingsSnapshot,
  type TrustedKey,
  type VolatilityAssessment,
  type LocalSearchHit,
  type MetadataStore,
  type OutboxRecord,
  type OutboxStore,
  type RelayProgress,
  type SearchState,
  type SyncStateStore,
  normalizeHinglish,
  ArchivingCapsuleStore,
  BgInbox,
  DELTA_PACK_FORMAT,
  IndexedDbDeltaBaseStore,
  InboxFirstTransport,
  MemoryDeltaBaseStore,
  MemoryInbox,
  createDelta,
  decodeDeltaPack,
  encodeDeltaPack,
  rebuildFullPack,
  registerBackgroundSync,
  type DeltaBaseStore,
  type Embedder,
  type SemanticStore,
  IndexedDbSemanticStore,
  MemorySemanticStore,
  SemanticIndex,
  type ManifestItem,
  type PackPart,
  type InboxLike,
} from "@setusync/edge-sdk";

const INSTALL_STORAGE_KEY = "setusync.install-id";
const STALE_GRACE_SECONDS = 7 * 24 * 3600;
const AUTO_RETRY_MS = 20_000;
const MAX_LOG = 40;

export type NoticeKind = "info" | "success" | "error";

export interface Notice {
  kind: NoticeKind;
  text: string;
}

export interface LogEntry {
  at: string;
  kind: NoticeKind;
  text: string;
}

/** Where a saved search came from and whether its signature checked out. */
export interface Provenance {
  origin: "relay" | "pack" | "qr" | "p2p";
  receivedAt: string;
  /** true = signature verified, false = failed, null = key not known yet. */
  verified: boolean | null;
  kid?: string;
  fingerprint?: string;
  hops: CustodyHop[];
}

export interface CapsuleView {
  id: string;
  query: string;
  canonical: string;
  fetchedAt: string;
  resultCount: number;
  freshness: FreshnessEvaluation | undefined;
  provenance: Provenance | undefined;
  volatility: VolatilityAssessment | undefined;
}

export interface OutboxView {
  id: string;
  query: string;
  status: OutboxRecord["status"];
  attempts: number;
  createdAt: string;
  lastError: string | undefined;
}

export interface SemanticState {
  status: "off" | "loading" | "indexing" | "ready" | "error";
  /** 0-100 while the model downloads or results are being understood. */
  progress: number;
  docs: number;
  message?: string;
}

const SEMANTIC_FLAG = "setusync.semantic.enabled";

export interface HitView extends LocalSearchHit {
  freshness: FreshnessEvaluation | undefined;
  provenance: Provenance | undefined;
  volatility: VolatilityAssessment | undefined;
}

export interface ChaosCounters {
  requests: number;
  dropped: number;
  repliesLost: number;
  tunnelDown: number;
}

export interface LabScore {
  ok: number;
  failed: number;
}

export interface LabState {
  naive: LabScore;
  setusync: LabScore;
  running: boolean;
  lastNaive: string | undefined;
}

export type ImportOutcome =
  | {
      status: "IMPORTED";
      imported: number;
      skipped: number;
      rejected: number;
      message: string;
    }
  | {
      status: "NEEDS_TRUST";
      keys: { kid: string; fingerprint: string }[];
    }
  | { status: "REJECTED"; message: string };

export interface SearchView {
  state: SearchState;
  hits: HitView[];
}

export interface ControllerState {
  restoring: boolean;
  storageError: string | undefined;
  browserOnline: boolean;
  simulatedOffline: boolean;
  online: boolean;
  syncing: boolean;
  progress: RelayProgress | undefined;
  relayReachable: boolean | undefined;
  lastSyncAt: string | undefined;
  capsules: CapsuleView[];
  outbox: OutboxView[];
  notice: Notice | undefined;
  log: LogEntry[];
  keys: TrustedKey[];
  savings: SavingsSnapshot;
  networkProfile: ChaosProfileName;
  chaos: ChaosCounters;
  /** On-device meaning-based search (transformers.js). */
  semantic: SemanticState;
  lab: LabState;
  linkQuality: string | undefined;
  pendingTrust: { kid: string; fingerprint: string }[] | undefined;
}

export interface ControllerDeps {
  relayUrl: string;
  capsules?: CapsuleStore;
  metadata?: MetadataStore;
  outbox?: OutboxStore;
  syncState?: SyncStateStore;
  /** Earlier versions of searches, kept so updates can travel as small deltas. */
  deltaBase?: DeltaBaseStore;
  /** Where the Background Sync worker parks downloaded capsules. */
  inbox?: InboxLike;
  /** Test hooks for smart search. */
  semanticStore?: SemanticStore;
  embedderFactory?: (onProgress: (percent: number) => void) => Promise<Embedder>;
  fetchImpl?: typeof fetch;
  installId?: string;
  /** Where keys, provenance, volatility and impact counters persist. */
  storage?: KeyValueStorage;
  now?: () => Date;
  browserOnline?: boolean;
  autoRetryMs?: number;
  /** Test hooks for the network lab. */
  chaos?: {
    rng?: () => number;
    sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
  };
  naivePollMs?: number;
  transportOptions?: {
    pollIntervalMs?: number;
    maxWaitMs?: number;
    requestTimeoutMs?: number;
  };
}

const PROVENANCE_KEY = "setusync.provenance.v1";
const LINK_RANK: Record<string, number> = {
  "slow-2g": 0,
  "2g": 1,
  "3g": 2,
  "4g": 3,
};

export type RequestOutcome =
  | "EMPTY"
  | "FRESH_IN_CACHE"
  | "QUEUED_OFFLINE"
  | "QUEUED_SYNCING";

function loadInstallId(): string {
  try {
    const existing = localStorage.getItem(INSTALL_STORAGE_KEY);

    if (existing) {
      return existing;
    }

    const created = crypto.randomUUID();
    localStorage.setItem(INSTALL_STORAGE_KEY, created);
    return created;
  } catch {
    // Storage blocked (private mode): identity lasts for this session.
    return crypto.randomUUID();
  }
}

function normalize(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function describeError(error: unknown): string {
  if (error instanceof RelayError) {
    return error.message;
  }

  return error instanceof Error
    ? error.message
    : "Something went wrong.";
}

export class SetuSyncController {
  private state: ControllerState;
  private readonly listeners = new Set<() => void>();

  private readonly capsuleStore: CapsuleStore;
  private readonly deltaBase: DeltaBaseStore;
  private readonly inbox: InboxLike;
  private readonly semanticStore: SemanticStore;
  private readonly embedderFactory: (onProgress: (percent: number) => void) => Promise<Embedder>;
  private semanticIndex: SemanticIndex | undefined = undefined;
  private semanticSyncing = false;
  private readonly semanticCounted = new Set<string>();
  private readonly outboxStore: OutboxStore;
  private readonly searchIndex = new LocalSearchIndex();
  private readonly indexer: CapsuleIndexer;
  private readonly search: OfflineSearch;
  private readonly engine: SyncEngine;
  private readonly freshness = new FreshnessPolicy({
    staleGraceSeconds: STALE_GRACE_SECONDS,
    allowStale: true,
  });
  private readonly now: () => Date;

  private readonly keyring: Keyring;
  private readonly volatility: VolatilityTracker;
  private readonly savings: SavingsTracker;
  private readonly kv: KeyValueStorage;
  private provenance: Record<string, Provenance> = {};
  private readonly relayUrl: string;
  private readonly installId: string;
  private readonly naivePollMs: number;
  private readonly rawFetch: typeof fetch;
  private readonly chaosFetch: typeof fetch;
  private networkProfile: ChaosProfileName = "PERFECT";
  private readonly qr = new FrameAssembler();
  private pendingImport:
    | { bytes: Uint8Array; source: "pack" | "qr" | "p2p" }
    | undefined;
  private readonly offlineQueued = new Set<string>();

  private draining = false;
  private drainAgain = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  private version = 0;
  private readonly retryMs: number;

  public constructor(deps: ControllerDeps) {
    this.now = deps.now ?? (() => new Date());

    const hasIdb = typeof indexedDB !== "undefined";
    this.semanticStore = deps.semanticStore ?? (hasIdb ? new IndexedDbSemanticStore() : new MemorySemanticStore());
    this.embedderFactory =
      deps.embedderFactory ??
      (async (onProgress) => (await import("./semantic-embedder.js")).createTransformersEmbedder(onProgress));
    this.deltaBase = deps.deltaBase ?? (hasIdb ? new IndexedDbDeltaBaseStore() : new MemoryDeltaBaseStore());
    this.inbox = deps.inbox ?? (hasIdb ? new BgInbox() : new MemoryInbox());
    this.capsuleStore = new ArchivingCapsuleStore(
      deps.capsules ?? new IndexedDbCapsuleStore(),
      this.deltaBase,
    );
    const metadata = deps.metadata ?? new IndexedDbMetadataStore();
    this.outboxStore = deps.outbox ?? new IndexedDbOutboxStore();
    const syncState = deps.syncState ?? new IndexedDbSyncStateStore();

    this.indexer = new CapsuleIndexer(this.capsuleStore, {
      searchIndex: this.searchIndex,
    });
    this.search = new OfflineSearch(
      { initialConnectivity: "OFFLINE" },
      this.searchIndex,
    );

    const installId = deps.installId ?? loadInstallId();

    this.kv = deps.storage ?? safeLocalStorage();
    this.keyring = new Keyring(this.kv);
    this.volatility = new VolatilityTracker(this.kv);
    this.savings = new SavingsTracker(this.kv);
    this.provenance = loadProvenance(this.kv);
    this.relayUrl = deps.relayUrl;
    this.installId = installId;
    this.naivePollMs = deps.naivePollMs ?? 1_000;
    this.rawFetch = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);

    // Every network call goes through the "network lab" wrapper. On the
    // default PERFECT profile it is a plain pass-through.
    this.chaosFetch = createChaosFetch(
      this.rawFetch,
      () => CHAOS_PROFILES[this.networkProfile],
      {
        ...(deps.chaos?.rng ? { rng: deps.chaos.rng } : {}),
        ...(deps.chaos?.sleep ? { sleep: deps.chaos.sleep } : {}),
        onEvent: (event) => {
          const c = this.state.chaos;
          this.patch({
            chaos: {
              requests: c.requests + (event.kind === "REQUEST" ? 1 : 0),
              dropped:
                c.dropped + (event.kind === "DROPPED_BEFORE_SERVER" ? 1 : 0),
              repliesLost:
                c.repliesLost + (event.kind === "REPLY_LOST" ? 1 : 0),
              tunnelDown:
                c.tunnelDown + (event.kind === "TUNNEL_DOWN" ? 1 : 0),
            },
          });
        },
      },
    );

    const relayTransport = new RelayCapsuleTransport({
      baseUrl: deps.relayUrl,
      installId,
      fetchImpl: this.chaosFetch,
      ...deps.transportOptions,
      onProgress: (progress) => {
        this.patch({ progress });
      },
    });

    // Results the Background Sync worker already downloaded are used first.
    const transport = new InboxFirstTransport(this.inbox, relayTransport, () => {
      this.bump("backgroundSyncs");
    });

    this.engine = new SyncEngine(
      transport,
      {
        outbox: this.outboxStore,
        capsules: this.capsuleStore,
        metadata,
        syncState,
      },
      { now: this.now },
    );

    const browserOnline =
      deps.browserOnline ??
      (typeof navigator === "undefined" ||
        navigator.onLine !== false);

    this.state = {
      restoring: true,
      storageError: undefined,
      browserOnline,
      simulatedOffline: false,
      online: browserOnline,
      syncing: false,
      progress: undefined,
      relayReachable: undefined,
      lastSyncAt: undefined,
      capsules: [],
      outbox: [],
      notice: undefined,
      log: [],
      keys: this.keyring.list(),
      savings: this.savings.snapshot(),
      networkProfile: "PERFECT",
      chaos: { requests: 0, dropped: 0, repliesLost: 0, tunnelDown: 0 },
      semantic: { status: "off", progress: 0, docs: 0 },
      lab: {
        naive: { ok: 0, failed: 0 },
        setusync: { ok: 0, failed: 0 },
        running: false,
        lastNaive: undefined,
      },
      linkQuality: undefined,
      pendingTrust: undefined,
    };

    this.search.setConnectivity(browserOnline ? "ONLINE" : "OFFLINE");

    this.retryMs = deps.autoRetryMs ?? AUTO_RETRY_MS;
  }

  // ---- subscription (React useSyncExternalStore friendly) ----------

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getState = (): ControllerState => this.state;

  /** Bumps whenever the local index changes; use as a memo key. */
  public getVersion = (): number => this.version;

  private patch(change: Partial<ControllerState>): void {
    this.state = { ...this.state, ...change };
    this.version += 1;

    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  private notify(kind: NoticeKind, text: string): void {
    const entry: LogEntry = {
      at: this.now().toISOString(),
      kind,
      text,
    };

    this.patch({
      notice: { kind, text },
      log: [entry, ...this.state.log].slice(0, MAX_LOG),
    });
  }

  private logOnly(kind: NoticeKind, text: string): void {
    const entry: LogEntry = {
      at: this.now().toISOString(),
      kind,
      text,
    };

    this.patch({ log: [entry, ...this.state.log].slice(0, MAX_LOG) });
  }

  public dismissNotice(): void {
    this.patch({ notice: undefined });
  }

  // ---- lifecycle ----------------------------------------------------

  public async init(): Promise<void> {
    this.disposed = false;
    this.startAutoRetry();

    try {
      await this.indexer.rebuildAll();
      await this.refreshViews();
      this.patch({ restoring: false, storageError: undefined });
    } catch (error) {
      this.patch({
        restoring: false,
        storageError:
          "Local storage is unavailable, so results can't be saved " +
          `on this device (${describeError(error)}).`,
      });
    }

    if (this.state.online) {
      void this.refreshRelayKeys();
    }

    if (typeof navigator !== "undefined" && navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener("message", this.onWorkerMessage);
    }
    void this.armBackgroundSync();

    try {
      if (this.kv.getItem(SEMANTIC_FLAG) === "1") void this.enableSemantic();
    } catch { /* storage unavailable */ }

    if (this.state.online && this.state.outbox.length > 0) {
      void this.drain();
    }
  }

  /**
   * Stops background work. Safe under React StrictMode, which runs
   * effect cleanup and then runs the effect again: init() revives it.
   */
  /** The service worker tells us when it finished searches in the background. */
  private readonly onWorkerMessage = (event: MessageEvent): void => {
    const data = event.data as { type?: string } | undefined;
    if (data?.type === "BG_SYNC_DONE" && this.state.online) void this.drain();
  };

  /**
   * Gives the service worker what it needs (relay address and install id) and asks the
   * browser to run a background sync. Returns false where Background Sync is unsupported
   * (for example Firefox and Safari); the normal retry timer still works there.
   */
  public async armBackgroundSync(): Promise<boolean> {
    try {
      await this.inbox.setConfig({ baseUrl: this.relayUrl, installId: this.installId });
      if (typeof navigator === "undefined" || !navigator.serviceWorker) return false;
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1500)),
      ]);
      return await registerBackgroundSync(registration as never);
    } catch {
      return false;
    }
  }

  public dispose(): void {
    this.disposed = true;

    if (typeof navigator !== "undefined" && navigator.serviceWorker) {
      navigator.serviceWorker.removeEventListener("message", this.onWorkerMessage);
    }

    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private startAutoRetry(): void {
    if (this.timer !== undefined || this.retryMs <= 0) {
      return;
    }

    this.timer = setInterval(() => {
      if (
        this.state.outbox.length > 0 &&
        this.state.online &&
        !this.draining
      ) {
        void this.drain();
      }
    }, this.retryMs);
  }

  // ---- connectivity -------------------------------------------------

  private recomputeOnline(): void {
    const online =
      this.state.browserOnline && !this.state.simulatedOffline;

    const changed = online !== this.state.online;

    this.search.setConnectivity(online ? "ONLINE" : "OFFLINE");
    this.patch({ online });

    if (changed) {
      this.logOnly(
        "info",
        online ? "Back online." : "Offline. Searching local cache only.",
      );
    }

    if (changed && online && this.state.outbox.length > 0) {
      void this.drain();
    }
  }

  public setBrowserOnline(online: boolean): void {
    this.patch({ browserOnline: online });
    this.recomputeOnline();
  }

  public setSimulatedOffline(offline: boolean): void {
    this.patch({ simulatedOffline: offline });
    this.recomputeOnline();
  }

  // ---- local search -------------------------------------------------

  public searchLocal(query: string): SearchView {
    let snapshot = this.search.search(query);
    if (snapshot.results.length === 0 && query.trim()) {
      // Hinglish / romanised-Hindi fallback ("sarkari yojana" -> "government scheme").
      const translated = normalizeHinglish(query);
      if (translated && translated !== query.trim().toLocaleLowerCase("en-IN")) {
        const fallback = this.search.search(translated);
        if (fallback.results.length > 0) snapshot = fallback;
      }
    }
    const byCapsule = new Map(this.state.capsules.map((c) => [c.id, c]));

    return {
      state: snapshot.state,
      hits: snapshot.results.map((hit) => ({
        ...hit,
        freshness: byCapsule.get(hit.capsuleId)?.freshness,
        provenance: byCapsule.get(hit.capsuleId)?.provenance,
        volatility: byCapsule.get(hit.capsuleId)?.volatility,
      })),
    };
  }

  // ---- live requests ------------------------------------------------

  /**
   * Asks for fresh results. Always goes through the durable outbox, so
   * the request survives a lost connection or a closed tab.
   */
  public async requestLive(
    query: string,
    options: { force?: boolean } = {},
  ): Promise<RequestOutcome> {
    const trimmed = query.trim();
    const normalized = normalizeQuery(trimmed);

    if (trimmed === "" || normalized.display === "") {
      return "EMPTY";
    }

    const wanted = normalized.canonical;

    if (!options.force) {
      const fresh = this.state.capsules.find(
        (c) => c.canonical === wanted && c.freshness?.state === "FRESH",
      );

      if (fresh) {
        const sameWords = normalize(fresh.query) === normalize(trimmed);

        this.bump(sameWords ? "freshCacheHits" : "equivalentHits");
        this.notify(
          "info",
          sameWords
            ? `"${trimmed}" is already fresh on this device ` +
                `(${formatAge(fresh.freshness?.ageSeconds ?? 0)} old). ` +
                "No credit used."
            : `Same search as "${fresh.query}", already fresh on this ` +
                `device (${formatAge(fresh.freshness?.ageSeconds ?? 0)} ` +
                "old). No credit used.",
        );
        return "FRESH_IN_CACHE";
      }
    }

    if (!this.state.online && this.searchLocal(trimmed).hits.length > 0) {
      this.bump("offlineAnswers");
    }

    const alreadyQueued = this.state.outbox.some(
      (o) => normalizeQuery(o.query).canonical === wanted,
    );

    if (!alreadyQueued) {
      const at = this.now().toISOString();
      const id = crypto.randomUUID();

      await this.outboxStore.put({
        id,
        // Light normalisation only: everyone's phrasing of the same
        // text then shares one Relay cache entry (one credit, many people).
        request: { engine: "google", query: normalized.display },
        status: "PENDING",
        attempts: 0,
        createdAt: at,
        updatedAt: at,
        requestState: "PENDING",
      });

      if (!this.state.online) {
        this.offlineQueued.add(id);
        this.bump("queuedWhileOffline");
      }

      // Always register, online or not: if the tab is closed mid-search (or the
      // connection drops), the service worker finishes the job.
      void this.armBackgroundSync();

      await this.refreshViews();
    }

    if (!this.state.online) {
      this.notify(
        "info",
        `Saved "${trimmed}". It will be fetched automatically ` +
          "when you're back online.",
      );
      return "QUEUED_OFFLINE";
    }

    void this.drain();
    return "QUEUED_SYNCING";
  }

  public async retry(id: string): Promise<void> {
    const record = await this.outboxStore.get(id);

    if (record) {
      await this.outboxStore.put({
        ...record,
        status: "PENDING",
        updatedAt: this.now().toISOString(),
      });
      await this.refreshViews();
    }

    if (this.state.online) {
      void this.drain();
    }
  }

  public async dismiss(id: string): Promise<void> {
    await this.outboxStore.delete(id);
    await this.refreshViews();
  }

  /** Pushes everything in the outbox to the Relay. Safe to call often. */
  public async drain(): Promise<void> {
    if (this.draining) {
      this.drainAgain = true;
      return;
    }

    if (!this.state.online || this.disposed) {
      return;
    }

    this.draining = true;
    this.patch({ syncing: true });

    try {
      do {
        this.drainAgain = false;

        const known = new Set(
          (await this.capsuleStore.listAll()).map((r) => r.capsule.body.id),
        );

        const result = await this.engine.sync();
        await this.indexer.rebuildAll();

        const arrived = (await this.capsuleStore.listAll())
          .map((r) => r.capsule)
          .filter((c) => !known.has(c.body.id));

        await this.absorbRelayCapsules(arrived);

        if (result.succeeded > 0) {
          this.bump("liveFetches", result.succeeded);
        }

        if (result.processed > 0) {
          const lab = this.state.lab;
          this.patch({
            lab: {
              ...lab,
              setusync: {
                ok: lab.setusync.ok + result.succeeded,
                failed: lab.setusync.failed + result.failed,
              },
            },
          });
        }

        if (result.failed > 0) {
          this.bump("failedAttempts", result.failed);
        }

        await this.refreshViews();
        this.countDelivered();

        if (result.processed > 0) {
          const failedRecords =
            await this.outboxStore.listByStatus("FAILED");
          const lastError = failedRecords.find(
            (r) => r.lastError,
          )?.lastError;

          if (result.failed === 0) {
            this.patch({ relayReachable: true });
            this.notify(
              "success",
              result.succeeded === 1
                ? "Fresh results saved on this device."
                : `${result.succeeded} searches saved on this device.`,
            );
          } else {
            const unreachable =
              lastError?.startsWith("Could not reach") ?? false;

            this.patch({
              relayReachable: unreachable ? false : true,
            });
            this.notify(
              "error",
              (lastError ?? "The relay could not complete the search.") +
                (unreachable || lastError?.includes("did not")
                  ? " Your request is kept and will retry automatically."
                  : ""),
            );
          }

          if (result.succeeded > 0) {
            this.patch({ lastSyncAt: this.now().toISOString() });
          }
        }
      } while (
        this.drainAgain &&
        this.state.online &&
        !this.disposed
      );
    } catch (error) {
      this.notify("error", describeError(error));
    } finally {
      this.draining = false;
      this.patch({ syncing: false, progress: undefined });
    }
  }

  // ---- maintenance --------------------------------------------------

  private async refreshViews(): Promise<void> {
    const records = await this.capsuleStore.listAll();

    const capsules: CapsuleView[] = records
      .map(({ capsule }): CapsuleView => {
        let freshness: FreshnessEvaluation | undefined;

        try {
          freshness = this.freshness.evaluate(capsule, this.now());
        } catch {
          freshness = undefined;
        }

        const query = queryOf(capsule);
        const canonical = normalizeQuery(query).canonical;

        return {
          id: capsule.body.id,
          query,
          canonical,
          fetchedAt: capsule.body.fetched_at,
          resultCount: capsule.body.organic_results.length,
          freshness,
          provenance: this.provenance[capsule.body.id],
          volatility: this.volatility.assess(
            canonical,
            freshness?.ageSeconds ?? 0,
          ),
        };
      })
      .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));

    const pending: OutboxRecord[] = [
      ...(await this.outboxStore.listByStatus("PENDING")),
      ...(await this.outboxStore.listByStatus("SENDING")),
      ...(await this.outboxStore.listByStatus("FAILED")),
    ];

    const outbox: OutboxView[] = pending
      .map((r) => ({
        id: r.id,
        query: r.request.query,
        status: r.status,
        attempts: r.attempts,
        createdAt: r.createdAt,
        lastError: r.lastError,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    this.patch({
      capsules,
      outbox,
      keys: this.keyring.list(),
      savings: this.savings.snapshot(),
    });

    void this.syncSemantic();
  }

  // ---- smart search: meaning-based, on-device -----------------------

  /** Downloads the model once (needs internet the first time), then works offline. */
  public async enableSemantic(): Promise<void> {
    const { status } = this.state.semantic;
    if (status === "loading" || status === "indexing" || status === "ready") return;

    this.patch({ semantic: { status: "loading", progress: 0, docs: 0 } });

    try {
      const embedder = await this.embedderFactory((percent) => {
        this.patch({ semantic: { status: "loading", progress: percent, docs: 0 } });
      });
      this.semanticIndex = new SemanticIndex(embedder, this.semanticStore);
      try { this.kv.setItem(SEMANTIC_FLAG, "1"); } catch { /* preference only */ }
      await this.syncSemantic();
    } catch (error) {
      this.semanticIndex = undefined;
      this.patch({
        semantic: {
          status: "error",
          progress: 0,
          docs: 0,
          message: this.state.online
            ? `Smart search could not start (${describeError(error)}).`
            : "Smart search needs a one-time model download. Connect once, then it works offline.",
        },
      });
    }
  }

  public disableSemantic(): void {
    this.semanticIndex = undefined;
    try { this.kv.setItem(SEMANTIC_FLAG, "0"); } catch { /* preference only */ }
    this.patch({ semantic: { status: "off", progress: 0, docs: 0 } });
  }

  private async syncSemantic(): Promise<void> {
    const index = this.semanticIndex;
    if (index === undefined || this.semanticSyncing) return;

    this.semanticSyncing = true;

    try {
      const records = await this.capsuleStore.listAll();
      await index.sync(
        records.map((r) => r.capsule),
        (done, total) => {
          this.patch({ semantic: { status: "indexing", progress: Math.round((done / total) * 100), docs: index.size } });
        },
      );
      this.patch({ semantic: { status: "ready", progress: 100, docs: index.size } });
    } catch (error) {
      this.patch({ semantic: { status: "error", progress: 0, docs: 0, message: `Smart search failed (${describeError(error)}).` } });
    } finally {
      this.semanticSyncing = false;
    }
  }

  /** Results related in meaning to the query (Hinglish is understood too). */
  public async searchSemantic(query: string, exclude: ReadonlySet<string> = new Set()): Promise<HitView[]> {
    const index = this.semanticIndex;
    const text = query.trim();
    if (index === undefined || this.state.semantic.status !== "ready" || text.length < 3) return [];

    const found = await index.search(normalizeHinglish(text) || text, 8);
    const byCapsule = new Map(this.state.capsules.map((c) => [c.id, c]));
    const hits: HitView[] = [];

    for (const hit of found) {
      const record = await this.capsuleStore.get(hit.capsuleId);
      const result = record?.capsule.body.organic_results[hit.resultIndex];
      if (!record || !result) continue;

      const id = `${hit.capsuleId}:${hit.resultIndex}`;
      if (exclude.has(id)) continue;

      hits.push({
        id,
        capsuleId: hit.capsuleId,
        resultPosition: result.position ?? hit.resultIndex + 1,
        engine: record.capsule.body.engine,
        title: result.title ?? "",
        snippet: result.snippet ?? "",
        link: result.link ?? "",
        displayedLink: result.displayedLink ?? "",
        score: hit.score,
        freshness: byCapsule.get(hit.capsuleId)?.freshness,
        provenance: byCapsule.get(hit.capsuleId)?.provenance,
        volatility: byCapsule.get(hit.capsuleId)?.volatility,
      });
    }

    if (hits.length > 0 && !this.semanticCounted.has(text.toLowerCase())) {
      this.semanticCounted.add(text.toLowerCase());
      this.bump("semanticAnswers");
    }

    return hits;
  }

  private bump(
    key: Parameters<SavingsTracker["add"]>[0],
    amount = 1,
  ): void {
    this.savings.add(key, amount);
    this.patch({ savings: this.savings.snapshot() });
  }

  private countDelivered(): void {
    const stillWaiting = new Set(this.state.outbox.map((o) => o.id));

    for (const id of [...this.offlineQueued]) {
      if (!stillWaiting.has(id)) {
        this.offlineQueued.delete(id);
        this.bump("deliveredFromOutbox");
      }
    }
  }

  private saveProvenance(): void {
    try {
      this.kv.setItem(PROVENANCE_KEY, JSON.stringify(this.provenance));
    } catch {
      // Labels are informational; losing them never loses results.
    }
  }

  // ---- trust, provenance ------------------------------------------

  /** Fetches the Relay's public keys so signatures can be checked offline. */
  public async refreshRelayKeys(): Promise<void> {
    try {
      const keys = await fetchRelayKeys(this.relayUrl, this.installId, this.chaosFetch);

      for (const key of keys) {
        const result = await this.keyring.trust(key, "relay", this.now);

        if (!result.ok && result.reason === "KEY_CONFLICT") {
          this.notify(
            "error",
            `The relay's key "${key.kid}" changed unexpectedly. Results ` +
              "signed with it will not be trusted.",
          );
        }
      }

      this.patch({ keys: this.keyring.list() });
    } catch {
      // Offline, or an older relay without /v1/keys. Results then show
      // as "not checked" instead of "verified".
    }
  }

  private async absorbRelayCapsules(
    capsules: readonly Capsule[],
  ): Promise<void> {
    if (capsules.length === 0) {
      return;
    }

    const verifier = new CapsuleVerifier(this.keyring.resolver);

    for (const capsule of capsules) {
      const id = capsule.body.id;
      const canonical = normalizeQuery(queryOf(capsule)).canonical;

      this.volatility.record(
        canonical,
        resultsSignature(capsule),
        new Date(capsule.body.fetched_at),
      );
      this.savings.add("relayBytes", JSON.stringify(capsule).length);

      let verified: boolean | null = null;

      try {
        let check = await verifier.verify(capsule);

        if (!check.valid && check.reason === "Unknown capsule key ID") {
          await this.refreshRelayKeys();
          check = await verifier.verify(capsule);
        }

        verified = check.valid
          ? true
          : check.reason === "Unknown capsule key ID"
            ? null
            : false;

        if (verified === false) {
          this.logOnly(
            "error",
            `A result from the relay failed signature verification (${
              check.reason ?? "unknown reason"
            }). It is kept but won't be shared.`,
          );
        }
      } catch {
        // e.g. a browser without WebCrypto Ed25519 support.
        verified = null;
      }

      const trusted = this.keyring.get(capsule.kid);

      this.provenance[id] = {
        origin: "relay",
        receivedAt: this.now().toISOString(),
        verified,
        kid: capsule.kid,
        ...(trusted ? { fingerprint: trusted.fingerprint } : {}),
        hops: [
          { role: "origin", at: capsule.body.fetched_at, label: "relay" },
        ],
      };
    }

    this.saveProvenance();
    this.patch({ savings: this.savings.snapshot() });
  }

  // ---- sharing: packs and QR ---------------------------------------

  /** Builds a signed-capsule pack. Only verified results are shared. */
  public async exportPack(
    ids?: readonly string[],
  ): Promise<{ bytes: Uint8Array; filename: string; count: number }> {
    const wanted = ids === undefined ? undefined : new Set(ids);
    const chosen: Capsule[] = [];

    for (const { capsule } of await this.capsuleStore.listAll()) {
      const id = capsule.body.id;

      if (wanted !== undefined && !wanted.has(id)) continue;
      if (this.provenance[id]?.verified !== true) continue;

      chosen.push(capsule);
    }

    if (chosen.length === 0) {
      throw new Error(
        "There are no verified searches to share yet. Fetch one while " +
          "online first.",
      );
    }

    const at = this.now().toISOString();
    const custody: Record<string, CustodyHop[]> = {};

    for (const capsule of chosen) {
      custody[capsule.body.id] = [
        ...(this.provenance[capsule.body.id]?.hops ?? []),
        { role: "exporter", at },
      ];
    }

    const keys = this.keyring.list().map((k) => ({
      kid: k.kid,
      alg: k.alg,
      publicKeySpkiB64: k.publicKeySpkiB64,
    }));

    const bytes = await encodePack(
      buildPack({ capsules: chosen, keys, custody, now: this.now() }),
    );

    return {
      bytes,
      filename: `setusync-${chosen.length}-searches-${at
        .slice(0, 10)
        .replace(/-/g, "")}${PACK_FILE_EXTENSION}`,
      count: chosen.length,
    };
  }

  /**
   * Builds an "update pack": for searches whose earlier version we still hold, only the
   * changes since that version. The receiver must already have the earlier version.
   */
  public async exportDeltaPack(
    ids?: readonly string[],
  ): Promise<{ bytes: Uint8Array; filename: string; count: number; fullBytes: number }> {
    const wanted = ids === undefined ? undefined : new Set(ids);
    const deltas = [];
    const fresh: Capsule[] = [];

    for (const { capsule } of await this.capsuleStore.listAll()) {
      const id = capsule.body.id;

      if (wanted !== undefined && !wanted.has(id)) continue;
      if (this.provenance[id]?.verified !== true) continue;

      const base = await this.deltaBase.getByKey(capsule.body.key);
      const delta = base ? createDelta(base, capsule) : undefined;

      if (delta) {
        deltas.push(delta);
        fresh.push(capsule);
      }
    }

    if (deltas.length === 0) {
      throw new Error(
        "No changed searches to send yet. An update needs an earlier version of the same " +
          "search: fetch it again after it changes, then try again.",
      );
    }

    const at = this.now().toISOString();
    const custody: Record<string, CustodyHop[]> = {};

    for (const capsule of fresh) {
      custody[capsule.body.id] = [
        ...(this.provenance[capsule.body.id]?.hops ?? []),
        { role: "exporter", at },
      ];
    }

    const keys = this.keyring.list().map((k) => ({
      kid: k.kid,
      alg: k.alg,
      publicKeySpkiB64: k.publicKeySpkiB64,
    }));

    const bytes = await encodeDeltaPack({
      format: DELTA_PACK_FORMAT,
      version: 1,
      createdAt: at,
      deltas,
      keys: keys.filter((k) => fresh.some((c) => c.kid === k.kid)),
      custody,
    });
    const fullBytes = (
      await encodePack(buildPack({ capsules: fresh, keys, custody, now: this.now() }))
    ).length;

    return {
      bytes,
      filename: `setusync-update-${deltas.length}-searches-${at.slice(0, 10).replace(/-/g, "")}${PACK_FILE_EXTENSION}`,
      count: deltas.length,
      fullBytes,
    };
  }

  // ---- nearby phone to phone (WebRTC) ---------------------------------

  /** What this phone can offer a nearby phone: verified searches only. */
  public async p2pManifest(): Promise<ManifestItem[]> {
    const items: ManifestItem[] = [];

    for (const { capsule } of await this.capsuleStore.listAll()) {
      if (this.provenance[capsule.body.id]?.verified !== true) continue;
      items.push({ key: capsule.body.key, id: capsule.body.id, fetchedAt: capsule.body.fetched_at });
    }

    return items;
  }

  /** Only what the other phone lacks; changes alone (a delta) when it holds the earlier version. */
  public async p2pBuild(peer: readonly ManifestItem[]): Promise<PackPart[]> {
    const theirs = new Map(peer.map((p) => [p.key, p]));
    const full: string[] = [];
    const changed: string[] = [];

    for (const mine of await this.p2pManifest()) {
      const other = theirs.get(mine.key);

      if (other === undefined) { full.push(mine.id); continue; }
      if (other.id === mine.id) continue;
      if (Date.parse(other.fetchedAt) >= Date.parse(mine.fetchedAt)) continue; // they have a newer answer

      const base = await this.deltaBase.getByKey(mine.key);
      (base?.body.id === other.id ? changed : full).push(mine.id);
    }

    const parts: PackPart[] = [];

    if (full.length > 0) {
      const pack = await this.exportPack(full);
      parts.push({ bytes: pack.bytes, count: pack.count });
    }

    if (changed.length > 0) {
      try {
        const update = await this.exportDeltaPack(changed);
        parts.push({ bytes: update.bytes, count: update.count });
      } catch {
        const pack = await this.exportPack(changed); // no usable base after all: send in full
        parts.push({ bytes: pack.bytes, count: pack.count });
      }
    }

    return parts;
  }

  /** Everything received from a nearby phone goes through the normal verified import. */
  public async p2pReceive(bytes: Uint8Array): Promise<{ imported: number; message: string }> {
    const outcome = await this.importPack(bytes, "p2p");

    if (outcome.status === "IMPORTED") {
      if (outcome.imported > 0) this.bump("p2pCapsules", outcome.imported);
      return { imported: outcome.imported, message: outcome.message };
    }

    if (outcome.status === "NEEDS_TRUST") {
      return { imported: 0, message: "Approve the sender's signing key below to finish importing." };
    }

    return { imported: 0, message: outcome.message };
  }

  /** Frames for the animated QR transfer (pick a few searches). */
  public async prepareQr(
    ids?: readonly string[],
  ): Promise<{ frames: string[]; bytes: number; count: number }> {
    const pack = await this.exportPack(ids);

    try {
      return {
        frames: await makeQrFrames(pack.bytes),
        bytes: pack.bytes.length,
        count: pack.count,
      };
    } catch (error) {
      if (error instanceof QrTransferTooLargeError) {
        throw error;
      }

      throw new Error("Could not prepare the QR transfer.");
    }
  }

  public async importPack(
    bytes: Uint8Array,
    source: "pack" | "qr" | "p2p",
    options: { approvedKids?: readonly string[]; declineUnknown?: boolean } = {},
  ): Promise<ImportOutcome> {
    // A "delta pack" carries only what changed since a version we already hold.
    // Rebuild the full signed capsules, then run the normal verified import.
    const deltaPack = await decodeDeltaPack(bytes).catch(() => undefined);

    if (deltaPack !== undefined) {
      const rebuilt = await rebuildFullPack(
        deltaPack,
        async (id) => (await this.capsuleStore.get(id))?.capsule,
      );

      if (rebuilt.rebuilt === 0) {
        const message =
          rebuilt.missingBase > 0
            ? "This update needs the earlier version of the search, which this device does not have. Ask for a full pack instead."
            : "This update file could not be applied.";
        this.notify("error", message);
        return { status: "REJECTED", message };
      }

      const full = await encodePack(rebuilt.pack);
      const outcome = await this.importPack(full, source, options);

      if (outcome.status === "IMPORTED" && outcome.imported > 0) {
        this.bump("deltaCapsules", outcome.imported);
        this.bump("deltaBytesSaved", Math.max(0, full.length - bytes.length));
      }

      return outcome;
    }

    let pack;

    try {
      pack = await decodePack(bytes);
    } catch (error) {
      const message =
        error instanceof PackError
          ? error.message
          : "This file could not be read.";
      this.notify("error", message);
      return { status: "REJECTED", message };
    }

    for (const kid of options.approvedKids ?? []) {
      const offered = pack.keys.find((k) => k.kid === kid);

      if (offered === undefined) continue;

      const trust = await this.keyring.trust(offered, "user", this.now);

      if (!trust.ok) {
        const message =
          trust.reason === "KEY_CONFLICT"
            ? `A different key is already trusted for "${kid}". This pack ` +
              "looks forged, so nothing was imported."
            : "The signing key in this pack is invalid.";
        this.notify("error", message);
        this.patch({ pendingTrust: undefined });
        return { status: "REJECTED", message };
      }
    }

    this.patch({ keys: this.keyring.list() });

    const report = await inspectPack(pack, this.keyring);

    if (report.needsTrust.length > 0 && options.declineUnknown !== true) {
      this.pendingImport = { bytes, source };

      const keys = await Promise.all(
        report.needsTrust.map(async (k) => ({
          kid: k.kid,
          fingerprint: await keyFingerprint(k.publicKeySpkiB64),
        })),
      );

      this.patch({ pendingTrust: keys });
      return { status: "NEEDS_TRUST", keys };
    }

    this.pendingImport = undefined;
    this.patch({ pendingTrust: undefined });

    const at = this.now().toISOString();
    let imported = 0;
    let skipped = 0;
    let importedBytes = 0;

    for (const { capsule } of report.valid) {
      const id = capsule.body.id;

      if ((await this.capsuleStore.get(id)) !== undefined) {
        skipped += 1;
        continue;
      }

      await this.indexer.indexCapsule(capsule);

      if ((await this.capsuleStore.get(id)) === undefined) {
        skipped += 1; // we already hold a newer answer to this search
        continue;
      }

      imported += 1;
      importedBytes += JSON.stringify(capsule).length;

      const trusted = this.keyring.get(capsule.kid);

      this.provenance[id] = {
        origin: source,
        receivedAt: at,
        verified: true,
        kid: capsule.kid,
        ...(trusted ? { fingerprint: trusted.fingerprint } : {}),
        hops: [...sanitizeHops(pack.custody[id]), { role: "importer", at }],
      };
    }

    const rejected = report.invalid.length;

    if (imported > 0) {
      this.savings.add("peerCapsules", imported);
      this.savings.add("peerBytes", importedBytes);
    }

    this.saveProvenance();
    await this.refreshViews();

    const message =
      imported > 0
        ? `Imported ${imported} verified search${imported === 1 ? "" : "es"}` +
          (skipped > 0 ? `, ${skipped} already up to date` : "") +
          (rejected > 0 ? `, ${rejected} rejected` : "") +
          ". No credits used."
        : rejected > 0
          ? `Nothing imported: ${rejected} result${rejected === 1 ? "" : "s"} failed verification (${
              report.invalid[0]?.verification.reason ?? "invalid"
            }).`
          : "Nothing new in this pack. You already have these results.";

    this.notify(imported > 0 || rejected === 0 ? "success" : "error", message);

    return { status: "IMPORTED", imported, skipped, rejected, message };
  }

  /** Answer to the "trust this sender's key?" question. */
  public async confirmPendingImport(approve: boolean): Promise<ImportOutcome> {
    const pending = this.pendingImport;
    const keys = this.state.pendingTrust ?? [];

    if (pending === undefined) {
      return { status: "REJECTED", message: "There is nothing waiting." };
    }

    this.pendingImport = undefined;
    this.patch({ pendingTrust: undefined });

    const outcome = await this.importPack(pending.bytes, pending.source, {
      ...(approve
        ? { approvedKids: keys.map((k) => k.kid) }
        : { declineUnknown: true }),
    });

    if (pending.source === "p2p" && outcome.status === "IMPORTED" && outcome.imported > 0) {
      this.bump("p2pCapsules", outcome.imported); // approved after the transfer
    }

    return outcome;
  }

  private qrFinishing = false;

  /** Feed every decoded QR code here; imports once the transfer is whole. */
  public async qrScan(
    text: string,
  ): Promise<{ progress: FrameProgress; outcome?: ImportOutcome }> {
    if (this.qrFinishing) {
      return { progress: this.qr.add("") };
    }

    const progress = this.qr.add(text);

    if (!progress.complete) {
      return { progress };
    }

    this.qrFinishing = true;

    try {
      const bytes = await this.qr.finish();
      this.qr.reset();
      return { progress, outcome: await this.importPack(bytes, "qr") };
    } catch (error) {
      this.qr.reset();
      const message = describeError(error);
      this.notify("error", message);
      return { progress, outcome: { status: "REJECTED", message } };
    } finally {
      this.qrFinishing = false;
    }
  }

  public resetQr(): void {
    this.qr.reset();
  }

  // ---- network lab ---------------------------------------------------

  public setNetworkProfile(name: ChaosProfileName): void {
    this.networkProfile = name;
    this.patch({ networkProfile: name });
    this.logOnly("info", `Network lab: ${CHAOS_PROFILES[name].label}.`);
  }

  public resetLab(): void {
    this.patch({
      chaos: { requests: 0, dropped: 0, repliesLost: 0, tunnelDown: 0 },
      lab: {
        naive: { ok: 0, failed: 0 },
        setusync: { ok: 0, failed: 0 },
        running: false,
        lastNaive: undefined,
      },
    });
  }

  public resetImpact(): void {
    this.savings.reset();
    this.patch({ savings: this.savings.snapshot() });
  }

  /**
   * Same search, same bad network: a typical app (one attempt, no
   * retries, no cache) versus SetuSync (durable outbox, retries, polling
   * that survives drops).
   */
  public async compare(query: string): Promise<void> {
    const display = normalizeQuery(query).display;

    if (display === "") {
      return;
    }

    if (!this.state.online) {
      this.notify(
        "info",
        "The comparison needs a connection. Switch to online first.",
      );
      return;
    }

    this.patch({ lab: { ...this.state.lab, running: true } });

    const naive = await this.runNaiveSearch(display);
    const lab = this.state.lab;

    this.patch({
      lab: {
        ...lab,
        naive: {
          ok: lab.naive.ok + (naive.ok ? 1 : 0),
          failed: lab.naive.failed + (naive.ok ? 0 : 1),
        },
        lastNaive: naive.message,
      },
    });

    await this.requestLive(display, { force: true });

    while (this.draining) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    this.patch({ lab: { ...this.state.lab, running: false } });
  }

  private async runNaiveSearch(
    query: string,
  ): Promise<{ ok: boolean; message: string }> {
    const base = this.relayUrl.replace(/\/+$/, "");
    const headers = {
      "X-SetuSync-Install-Id": this.installId,
    };

    const call = async (
      path: string,
      init: RequestInit,
    ): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);

      try {
        return await this.chaosFetch(`${base}${path}`, {
          ...init,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    };

    const search = (): Promise<Response> =>
      call("/v1/search", {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          engine: "google",
          params: { q: query },
          max_age_s: 86_400,
          wait_ms: 0,
          accept: { lite: true, full: true },
        }),
      });

    try {
      let response = await search();

      if (response.status === 202) {
        const { ticketId } = (await response.json()) as {
          ticketId: string;
        };
        const deadline = Date.now() + 25_000;

        for (;;) {
          if (Date.now() > deadline) {
            return { ok: false, message: "Typical app: gave up waiting." };
          }

          await new Promise((resolve) =>
            setTimeout(resolve, this.naivePollMs),
          );

          const ticket = (await (
            await call(`/v1/tickets/${ticketId}`, { headers })
          ).json()) as { state?: string; reason?: string };

          if (ticket.state === "FAILED") {
            return {
              ok: false,
              message: `Typical app: ${ticket.reason ?? "search failed"}.`,
            };
          }

          if (ticket.state === "READY") {
            response = await search();
            break;
          }
        }
      }

      return response.status === 200
        ? { ok: true, message: "Typical app: got results." }
        : {
            ok: false,
            message: `Typical app: relay answered HTTP ${response.status}.`,
          };
    } catch {
      return {
        ok: false,
        message: "Typical app: the connection dropped, so it failed.",
      };
    }
  }

  // ---- opportunistic sync -------------------------------------------

  /** Call with navigator.connection.effectiveType when it changes. */
  public setLinkQuality(effectiveType: string | undefined): void {
    const previous = this.state.linkQuality;
    this.patch({ linkQuality: effectiveType });

    const rank = (value: string | undefined): number =>
      value === undefined ? -1 : (LINK_RANK[value] ?? -1);

    if (
      previous !== undefined &&
      rank(effectiveType) > rank(previous) &&
      rank(effectiveType) >= 2 &&
      this.state.online &&
      this.state.outbox.length > 0
    ) {
      this.logOnly(
        "info",
        `Connection improved to ${effectiveType}. Syncing queued searches now.`,
      );
      void this.drain();
    }
  }
}

function queryOf(capsule: Capsule): string {
  const q = (capsule.body.params as Record<string, unknown>)["q"];
  return typeof q === "string" ? q : "(unknown query)";
}

function loadProvenance(storage: KeyValueStorage): Record<string, Provenance> {
  try {
    const raw = storage.getItem(PROVENANCE_KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);

    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, Provenance>)
      : {};
  } catch {
    return {};
  }
}

function sanitizeHops(value: unknown): CustodyHop[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const roles = new Set(["origin", "exporter", "importer"]);
  const hops: CustodyHop[] = [];

  for (const entry of value.slice(0, 8)) {
    const hop = entry as Partial<CustodyHop> | null;

    if (
      hop !== null &&
      typeof hop === "object" &&
      typeof hop.role === "string" &&
      roles.has(hop.role) &&
      typeof hop.at === "string"
    ) {
      hops.push({
        role: hop.role,
        at: hop.at.slice(0, 40),
        ...(typeof hop.label === "string"
          ? { label: hop.label.slice(0, 40) }
          : {}),
      });
    }
  }

  return hops;
}

export function formatAge(seconds: number): string {
  if (seconds < 90) return "moments";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}
