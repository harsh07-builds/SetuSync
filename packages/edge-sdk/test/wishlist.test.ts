import { describe, expect, it } from "vitest";
import {
  computeRequestKey,
  type CapsuleRequest,
} from "@setusync/protocol";
import {
  Wishlist,
  type WishlistEntry,
} from "../src/wishlist/wishlist.js";

describe("Wishlist", () => {
  const request: CapsuleRequest = {
    engine: "google",
    query: "government hospital",
    params: {
      gl: "in",
      hl: "en",
    },
  };

  it("adds a request with the default lease", () => {
    const now = new Date("2026-10-04T17:00:00.000Z");

    const wishlist = new Wishlist({
      now: () => now,
      defaultLeaseSeconds: 3600,
    });

    const entry = wishlist.add(request);

    expect(entry).toEqual({
      key: computeRequestKey(request),
      request,
      createdAt: "2026-10-04T17:00:00.000Z",
      expiresAt: "2026-10-04T18:00:00.000Z",
    });

    expect(wishlist.size).toBe(1);
  });

  it("supports a custom lease duration", () => {
    const now = new Date("2026-10-04T17:00:00.000Z");

    const wishlist = new Wishlist({
      now: () => now,
      defaultLeaseSeconds: 3600,
    });

    const entry = wishlist.add(request, 7200);

    expect(entry.expiresAt).toBe(
      "2026-10-04T19:00:00.000Z",
    );
  });

  it("retrieves entries by request or request key", () => {
    const wishlist = new Wishlist({
      now: () =>
        new Date("2026-10-04T17:00:00.000Z"),
    });

    const entry = wishlist.add(request);

    expect(wishlist.get(request)).toEqual(entry);
    expect(wishlist.get(entry.key)).toEqual(entry);
    expect(wishlist.has(request)).toBe(true);
    expect(wishlist.has(entry.key)).toBe(true);
  });

  it("uses the deterministic request key for equivalent requests", () => {
    const wishlist = new Wishlist({
      now: () =>
        new Date("2026-10-04T17:00:00.000Z"),
    });

    const equivalentRequest: CapsuleRequest = {
      engine: "google",
      query: "government hospital",
      params: {
        hl: "en",
        gl: "in",
      },
    };

    const first = wishlist.add(request);
    const second = wishlist.add(
      equivalentRequest,
    );

    expect(first.key).toBe(second.key);
    expect(wishlist.size).toBe(1);
  });

  it("expires an entry at the lease boundary", () => {
    const now = {
      value: new Date(
        "2026-10-04T17:00:00.000Z",
      ),
    };

    const wishlist = new Wishlist({
      now: () => now.value,
    });

    wishlist.add(request, 3600);

    expect(wishlist.has(request)).toBe(true);
    expect(
      wishlist.remainingLeaseSeconds(request),
    ).toBe(3600);

    now.value = new Date(
      "2026-10-04T18:00:00.000Z",
    );

    expect(wishlist.has(request)).toBe(false);
    expect(
      wishlist.remainingLeaseSeconds(request),
    ).toBe(0);
    expect(wishlist.size).toBe(0);
  });

  it("removes an entry", () => {
    const wishlist = new Wishlist();

    wishlist.add(request);

    expect(wishlist.remove(request)).toBe(true);
    expect(wishlist.has(request)).toBe(false);
    expect(wishlist.remove(request)).toBe(false);
  });

  it("lists active entries and removes expired entries", () => {
    const now = {
      value: new Date(
        "2026-10-04T17:00:00.000Z",
      ),
    };

    const secondRequest: CapsuleRequest = {
      engine: "google",
      query: "railway station",
      params: {
        gl: "in",
        hl: "en",
      },
    };

    const wishlist = new Wishlist({
      now: () => now.value,
    });

    wishlist.add(request, 3600);
    wishlist.add(secondRequest, 7200);

    expect(wishlist.list()).toHaveLength(2);

    now.value = new Date(
      "2026-10-04T18:30:00.000Z",
    );

    expect(wishlist.list()).toHaveLength(1);
    expect(wishlist.has(request)).toBe(false);
    expect(wishlist.has(secondRequest)).toBe(true);
  });

  it("removes expired entries explicitly", () => {
    const now = {
      value: new Date(
        "2026-10-04T17:00:00.000Z",
      ),
    };

    const wishlist = new Wishlist({
      now: () => now.value,
    });

    wishlist.add(request, 1800);

    now.value = new Date(
      "2026-10-04T17:31:00.000Z",
    );

    expect(wishlist.removeExpired()).toBe(1);
    expect(wishlist.size).toBe(0);
  });

  it("returns defensive copies", () => {
    const wishlist = new Wishlist({
      now: () =>
        new Date("2026-10-04T17:00:00.000Z"),
    });

    const entry = wishlist.add(request);

    entry.request.query = "modified";

    const stored = wishlist.get(request);

    expect(stored?.request.query).toBe(
      "government hospital",
    );
  });

  it("clears all entries", () => {
    const wishlist = new Wishlist();

    const secondRequest: CapsuleRequest = {
      engine: "google",
      query: "railway station",
      params: {
        gl: "in",
        hl: "en",
      },
    };

    wishlist.add(request);
    wishlist.add(secondRequest);

    expect(wishlist.size).toBe(2);

    wishlist.clear();

    expect(wishlist.size).toBe(0);
    expect(wishlist.list()).toEqual([]);
  });

  it("validates lease configuration", () => {
    expect(
      () =>
        new Wishlist({
          defaultLeaseSeconds: 0,
        }),
    ).toThrow(RangeError);

    expect(
      () =>
        new Wishlist({
          defaultLeaseSeconds: -1,
        }),
    ).toThrow(RangeError);

    expect(
      () =>
        new Wishlist({
          defaultLeaseSeconds: Number.NaN,
        }),
    ).toThrow(RangeError);
  });

  it("validates a custom lease duration", () => {
    const wishlist = new Wishlist();

    expect(() =>
      wishlist.add(request, 0),
    ).toThrow(RangeError);

    expect(() =>
      wishlist.add(request, -1),
    ).toThrow(RangeError);

    expect(() =>
      wishlist.add(request, Number.NaN),
    ).toThrow(RangeError);
  });

  it("rejects an invalid clock", () => {
    const wishlist = new Wishlist({
      now: () => new Date("invalid"),
    });

    expect(() => wishlist.add(request)).toThrow(
      TypeError,
    );
  });
});