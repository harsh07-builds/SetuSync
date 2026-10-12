import type { Capsule } from "@setusync/protocol";

import type { KeyValueStorage } from "../keys/keyring.js";

/**
 * Learns how quickly the answer to a query changes.
 *
 * Every time a query is fetched again, the new top results are compared
 * with the previous ones. A cafe search that never changes can be trusted
 * for weeks; a news search should be refreshed in minutes. A fixed TTL
 * can't express that, but the history can.
 */
export interface VolatilityRecord {
  fetches: number;
  changes: number;
  signature: string;
  firstFetchedAt: string;
  lastFetchedAt: string;
  lastChangedAt?: string;
}

export type VolatilityVerdict =
  | "UNKNOWN"
  | "LIKELY_VALID"
  | "MAY_HAVE_CHANGED";

export interface VolatilityAssessment {
  verdict: VolatilityVerdict;
  label: string;
}

/** Compact fingerprint of what the user would see at the top. */
export function resultsSignature(capsule: Capsule): string {
  return capsule.body.organic_results
    .slice(0, 5)
    .map((r) => r.link ?? r.title ?? "")
    .join("|");
}

const HOUR = 3600;

export class VolatilityTracker {
  private readonly storage: KeyValueStorage;
  private readonly storageKey: string;
  private records: Record<string, VolatilityRecord>;

  public constructor(
    storage: KeyValueStorage,
    storageKey = "setusync.volatility.v1",
  ) {
    this.storage = storage;
    this.storageKey = storageKey;
    this.records = {};

    try {
      const raw = storage.getItem(storageKey);
      const parsed: unknown = raw === null ? {} : JSON.parse(raw);

      if (typeof parsed === "object" && parsed !== null) {
        this.records = parsed as Record<string, VolatilityRecord>;
      }
    } catch {
      this.records = {};
    }
  }

  public get(canonical: string): VolatilityRecord | undefined {
    return this.records[canonical];
  }

  public record(canonical: string, signature: string, at: Date): void {
    const iso = at.toISOString();
    const previous = this.records[canonical];

    if (previous === undefined) {
      this.records[canonical] = {
        fetches: 1,
        changes: 0,
        signature,
        firstFetchedAt: iso,
        lastFetchedAt: iso,
      };
    } else {
      const changed = previous.signature !== signature;

      this.records[canonical] = {
        ...previous,
        fetches: previous.fetches + 1,
        changes: previous.changes + (changed ? 1 : 0),
        signature,
        lastFetchedAt: iso,
        ...(changed ? { lastChangedAt: iso } : {}),
      };
    }

    try {
      this.storage.setItem(this.storageKey, JSON.stringify(this.records));
    } catch {
      // Memory copy is still correct for this session.
    }
  }

  /**
   * Is a capsule of this age probably still accurate?
   * With fewer than two observations we honestly say we don't know.
   */
  public assess(canonical: string, ageSeconds: number): VolatilityAssessment {
    const rec = this.records[canonical];

    if (rec === undefined || rec.fetches < 2) {
      return {
        verdict: "UNKNOWN",
        label: "Not enough history yet to judge how fast this changes",
      };
    }

    const span = Math.max(
      HOUR,
      (Date.parse(rec.lastFetchedAt) - Date.parse(rec.firstFetchedAt)) / 1000,
    );
    // No change seen => assume it lasts at least twice what we observed.
    const typicalLife = rec.changes > 0 ? span / rec.changes : span * 2;

    return ageSeconds < typicalLife * 0.5
      ? {
          verdict: "LIKELY_VALID",
          label: "Results for this search rarely change, likely still accurate",
        }
      : {
          verdict: "MAY_HAVE_CHANGED",
          label: "This search changes often, consider refreshing when online",
        };
  }
}
