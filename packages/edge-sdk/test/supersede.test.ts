import { describe, expect, it } from "vitest";
import type { Capsule } from "@setusync/protocol";
import { planCapsuleReplacement } from "../src/storage/supersede.js";
import type { CapsuleRecord } from "../src/storage/types.js";
import { getMockCapsule } from "../src/testing/mock-capsule.js";

function capsule(
  id: string,
  fetchedAt: string,
  key = "request-key",
): Capsule {
  const base = getMockCapsule();

  return {
    ...base,
    body: {
      ...base.body,
      id,
      key,
      fetched_at: fetchedAt,
    },
  };
}

function record(value: Capsule): CapsuleRecord {
  return { capsule: value, storedAt: "2026-10-05T00:00:00Z" };
}

describe("planCapsuleReplacement", () => {
  it("replaces older capsules for the same key", () => {
    const older = capsule("old", "2026-10-01T00:00:00Z");
    const incoming = capsule("new", "2026-10-04T00:00:00Z");

    const plan = planCapsuleReplacement(incoming, [
      record(older),
    ]);

    expect(plan.store).toBe(true);
    expect(plan.remove.map((item) => item.body.id)).toEqual([
      "old",
    ]);
  });

  it("does not store an incoming capsule older than an existing one", () => {
    const newer = capsule("new", "2026-10-04T00:00:00Z");
    const incoming = capsule("old", "2026-10-01T00:00:00Z");

    const plan = planCapsuleReplacement(incoming, [
      record(newer),
    ]);

    expect(plan.store).toBe(false);
    expect(plan.remove).toEqual([]);
  });

  it("leaves capsules with the same id alone", () => {
    const same = capsule("same", "2026-10-01T00:00:00Z");
    const incoming = capsule("same", "2026-10-04T00:00:00Z");

    expect(
      planCapsuleReplacement(incoming, [record(same)]),
    ).toEqual({ store: true, remove: [] });
  });

  it("leaves capsules for other keys alone", () => {
    const other = capsule(
      "other",
      "2026-10-01T00:00:00Z",
      "different-key",
    );
    const incoming = capsule("new", "2026-10-04T00:00:00Z");

    expect(
      planCapsuleReplacement(incoming, [record(other)]),
    ).toEqual({ store: true, remove: [] });
  });

  it("keeps both when fetched_at is identical", () => {
    const existing = capsule("a", "2026-10-04T00:00:00Z");
    const incoming = capsule("b", "2026-10-04T00:00:00Z");

    expect(
      planCapsuleReplacement(incoming, [record(existing)]),
    ).toEqual({ store: true, remove: [] });
  });

  it("does nothing when a timestamp cannot be parsed", () => {
    const existing = capsule("a", "not-a-date");
    const incoming = capsule("b", "2026-10-04T00:00:00Z");
    const badIncoming = capsule("c", "not-a-date");

    expect(
      planCapsuleReplacement(incoming, [record(existing)]),
    ).toEqual({ store: true, remove: [] });

    expect(
      planCapsuleReplacement(badIncoming, [
        record(capsule("d", "2026-10-04T00:00:00Z")),
      ]),
    ).toEqual({ store: true, remove: [] });
  });
});
