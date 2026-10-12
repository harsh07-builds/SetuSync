import type { KeyValueStorage } from "../keys/keyring.js";

export interface SavingsCounters {
  /** Live searches that actually used a provider credit. */
  liveFetches: number;
  /** Requests answered because an identical fresh result was on-device. */
  freshCacheHits: number;
  /** ...because a differently-worded equivalent query was on-device. */
  equivalentHits: number;
  /** Searches answered from the device while there was no connection. */
  offlineAnswers: number;
  /** Verified results received from other people instead of the Relay. */
  peerCapsules: number;
  peerBytes: number;
  /** Requests saved while offline and delivered after reconnecting. */
  queuedWhileOffline: number;
  deliveredFromOutbox: number;
  failedAttempts: number;
  /** Bytes downloaded from the Relay. */
  relayBytes: number;
  /** Bytes NOT sent because only the changes (a delta) were transferred. */
  deltaBytesSaved: number;
  deltaCapsules: number;
  /** Results received straight from a nearby phone over WebRTC. */
  p2pCapsules: number;
  /** Searches answered by the on-device semantic (meaning-based) index. */
  semanticAnswers: number;
  /** Queued searches finished by Background Sync while the app was closed. */
  backgroundSyncs: number;
}

export interface SavingsSnapshot extends SavingsCounters {
  /** Provider credits NOT spent thanks to reuse and sharing. */
  creditsAvoided: number;
  /** Share of requests that needed no live provider credit, 0..1. */
  reuseRate: number;
}

const EMPTY: SavingsCounters = {
  liveFetches: 0,
  freshCacheHits: 0,
  equivalentHits: 0,
  offlineAnswers: 0,
  peerCapsules: 0,
  peerBytes: 0,
  queuedWhileOffline: 0,
  deliveredFromOutbox: 0,
  failedAttempts: 0,
  relayBytes: 0,
  deltaBytesSaved: 0,
  deltaCapsules: 0,
  p2pCapsules: 0,
  semanticAnswers: 0,
  backgroundSyncs: 0,
};

export class SavingsTracker {
  private readonly storage: KeyValueStorage;
  private readonly storageKey: string;
  private counters: SavingsCounters;

  public constructor(
    storage: KeyValueStorage,
    storageKey = "setusync.savings.v1",
  ) {
    this.storage = storage;
    this.storageKey = storageKey;
    this.counters = { ...EMPTY };

    try {
      const raw = storage.getItem(storageKey);
      const parsed: unknown = raw === null ? {} : JSON.parse(raw);

      if (typeof parsed === "object" && parsed !== null) {
        for (const key of Object.keys(EMPTY) as (keyof SavingsCounters)[]) {
          const value = (parsed as Record<string, unknown>)[key];

          if (typeof value === "number" && Number.isFinite(value)) {
            this.counters[key] = value;
          }
        }
      }
    } catch {
      this.counters = { ...EMPTY };
    }
  }

  public add(key: keyof SavingsCounters, amount = 1): void {
    this.counters[key] += amount;

    try {
      this.storage.setItem(this.storageKey, JSON.stringify(this.counters));
    } catch {
      // Counting is best-effort.
    }
  }

  public snapshot(): SavingsSnapshot {
    const c = this.counters;
    const creditsAvoided = c.freshCacheHits + c.equivalentHits + c.peerCapsules;
    const total = creditsAvoided + c.liveFetches;

    return {
      ...c,
      creditsAvoided,
      reuseRate: total === 0 ? 0 : creditsAvoided / total,
    };
  }

  public reset(): void {
    this.counters = { ...EMPTY };

    try {
      this.storage.removeItem(this.storageKey);
    } catch {
      // ignore
    }
  }
}
