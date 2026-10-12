import { describe, expect, it } from "vitest";
import type { Capsule } from "@setusync/protocol";
import { FreshnessPolicy } from "../src/policy/freshness-policy.js";

function createCapsule(
  fetchedAt: string,
  ttlSeconds: number,
): Capsule {
  return {
    v: 1,
    kid: "test-key",
    alg: "Ed25519",
    sig: "test-signature",
    body: {
      id: "capsule-id",
      key: "capsule-key",
      chash: "content-hash",
      engine: "google",
      params: {},
      fetched_at: fetchedAt,
      ttl_s: ttlSeconds,
      source: {
        provider: "serpapi",
      },
      organic_results: [],
      related_questions: [],
    },
  };
}

describe("FreshnessPolicy", () => {
  const now = new Date("2026-10-04T12:00:00Z");

  it("marks a capsule as FRESH before TTL expires", () => {
    const capsule = createCapsule(
      "2026-10-04T11:30:00Z",
      3600,
    );

    const policy = new FreshnessPolicy();

    const result = policy.evaluate(capsule, now);

    expect(result).toEqual({
      state: "FRESH",
      ageSeconds: 1800,
      expiresAt: "2026-10-04T12:30:00.000Z",
      canServe: true,
      shouldRefresh: false,
    });
  });

  it("marks a capsule as STALE inside the grace window", () => {
    const capsule = createCapsule(
      "2026-10-04T10:00:00Z",
      3600,
    );

    const policy = new FreshnessPolicy({
      staleGraceSeconds: 7200,
      allowStale: true,
    });

    const result = policy.evaluate(capsule, now);

    expect(result).toEqual({
      state: "STALE",
      ageSeconds: 7200,
      expiresAt: "2026-10-04T11:00:00.000Z",
      canServe: true,
      shouldRefresh: true,
    });
  });

  it("does not serve stale data when allowStale is false", () => {
    const capsule = createCapsule(
      "2026-10-04T10:00:00Z",
      3600,
    );

    const policy = new FreshnessPolicy({
      staleGraceSeconds: 7200,
      allowStale: false,
    });

    const result = policy.evaluate(capsule, now);

    expect(result.state).toBe("STALE");
    expect(result.canServe).toBe(false);
    expect(result.shouldRefresh).toBe(true);
  });

  it("marks a capsule as EXPIRED after the grace window", () => {
    const capsule = createCapsule(
      "2026-10-04T08:00:00Z",
      3600,
    );

    const policy = new FreshnessPolicy({
      staleGraceSeconds: 7200,
    });

    const result = policy.evaluate(capsule, now);

    expect(result).toEqual({
      state: "EXPIRED",
      ageSeconds: 14400,
      expiresAt: "2026-10-04T09:00:00.000Z",
      canServe: false,
      shouldRefresh: true,
    });
  });

  it("treats the exact TTL boundary as FRESH", () => {
    const capsule = createCapsule(
      "2026-10-04T11:00:00Z",
      3600,
    );

    const result = new FreshnessPolicy().evaluate(
      capsule,
      now,
    );

    expect(result.state).toBe("FRESH");
    expect(result.canServe).toBe(true);
    expect(result.shouldRefresh).toBe(false);
  });

  it("validates staleGraceSeconds", () => {
    expect(
      () =>
        new FreshnessPolicy({
          staleGraceSeconds: -1,
        }),
    ).toThrow(RangeError);

    expect(
      () =>
        new FreshnessPolicy({
          staleGraceSeconds: Number.NaN,
        }),
    ).toThrow(RangeError);
  });

  it("rejects invalid capsule timestamps", () => {
    const capsule = createCapsule(
      "not-a-timestamp",
      3600,
    );

    expect(() =>
      new FreshnessPolicy().evaluate(capsule, now),
    ).toThrow(TypeError);
  });

  it("rejects invalid TTL values", () => {
    const capsule = createCapsule(
      "2026-10-04T11:30:00Z",
      -1,
    );

    expect(() =>
      new FreshnessPolicy().evaluate(capsule, now),
    ).toThrow(RangeError);
  });
});