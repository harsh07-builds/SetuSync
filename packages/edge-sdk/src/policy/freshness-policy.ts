import type { Capsule } from "@setusync/protocol";

export type FreshnessState = "FRESH" | "STALE" | "EXPIRED";

export interface FreshnessPolicyOptions {
  staleGraceSeconds?: number;
  allowStale?: boolean;
}

export interface FreshnessEvaluation {
  state: FreshnessState;
  ageSeconds: number;
  expiresAt: string;
  canServe: boolean;
  shouldRefresh: boolean;
}

function parseTimestamp(value: string, fieldName: string): number {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${fieldName} must be a valid ISO timestamp`);
  }

  return timestamp;
}

export class FreshnessPolicy {
  private readonly staleGraceSeconds: number;
  private readonly allowStale: boolean;

  public constructor(options: FreshnessPolicyOptions = {}) {
    this.staleGraceSeconds = options.staleGraceSeconds ?? 0;
    this.allowStale = options.allowStale ?? true;

    if (
      !Number.isFinite(this.staleGraceSeconds) ||
      this.staleGraceSeconds < 0
    ) {
      throw new RangeError(
        "staleGraceSeconds must be a finite non-negative number",
      );
    }
  }

  public evaluate(
    capsule: Capsule,
    now: Date = new Date(),
  ): FreshnessEvaluation {
    const fetchedAtMs = parseTimestamp(
      capsule.body.fetched_at,
      "capsule.body.fetched_at",
    );

    const nowMs = now.getTime();

    if (!Number.isFinite(nowMs)) {
      throw new TypeError("now must be a valid Date");
    }

    const ageSeconds = Math.max(0, (nowMs - fetchedAtMs) / 1000);

    const ttlSeconds = capsule.body.ttl_s;

    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
      throw new RangeError(
        "capsule.body.ttl_s must be a finite non-negative number",
      );
    }

    const expiresAtMs = fetchedAtMs + ttlSeconds * 1000;
    const staleUntilMs =
      expiresAtMs + this.staleGraceSeconds * 1000;

    const expiresAt = new Date(expiresAtMs).toISOString();

    if (nowMs <= expiresAtMs) {
      return {
        state: "FRESH",
        ageSeconds,
        expiresAt,
        canServe: true,
        shouldRefresh: false,
      };
    }

    if (nowMs <= staleUntilMs) {
      return {
        state: "STALE",
        ageSeconds,
        expiresAt,
        canServe: this.allowStale,
        shouldRefresh: true,
      };
    }

    return {
      state: "EXPIRED",
      ageSeconds,
      expiresAt,
      canServe: false,
      shouldRefresh: true,
    };
  }
}
