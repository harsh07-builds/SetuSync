import { describe, expect, it } from "vitest";
import {
  SdkGovernor,
  type GovernorState,
} from "../src/governor/sdk-governor.js";

describe("SdkGovernor", () => {
  it("starts offline and rejects requests", () => {
    const governor = new SdkGovernor();

    const result = governor.check();

    expect(result).toEqual({
      decision: "OFFLINE",
      allowed: false,
    });
  });

  it("allows a request when online and under limits", () => {
    const governor = new SdkGovernor();

    governor.setConnectivity("ONLINE");

    expect(governor.check()).toEqual({
      decision: "ALLOW",
      allowed: true,
    });
  });

  it("tracks in-flight requests", () => {
    const governor = new SdkGovernor({
      maxConcurrentRequests: 2,
    });

    governor.setConnectivity("ONLINE");

    expect(governor.acquire()).toEqual({
      decision: "ALLOW",
      allowed: true,
    });

    expect(governor.acquire()).toEqual({
      decision: "ALLOW",
      allowed: true,
    });

    expect(governor.check()).toEqual({
      decision: "CONCURRENCY_LIMIT",
      allowed: false,
    });

    expect(governor.getState().inFlight).toBe(2);

    governor.release();

    expect(governor.check()).toEqual({
      decision: "ALLOW",
      allowed: true,
    });

    expect(governor.getState().inFlight).toBe(1);
  });

  it("does not reduce in-flight below zero", () => {
    const governor = new SdkGovernor();

    governor.release();
    governor.release();

    expect(governor.getState().inFlight).toBe(0);
  });

  it("enforces the request budget within the window", () => {
    const now = { value: 1_000 };

    const governor = new SdkGovernor({
      maxRequestsPerWindow: 2,
      windowSeconds: 60,
      now: () => now.value,
    });

    governor.setConnectivity("ONLINE");

    expect(governor.acquire().decision).toBe("ALLOW");
    governor.release();

    expect(governor.acquire().decision).toBe("ALLOW");
    governor.release();

    expect(governor.check()).toEqual({
      decision: "BUDGET_EXHAUSTED",
      allowed: false,
      retryAfterSeconds: 60,
    });

    expect(
      governor.getState().requestsInWindow,
    ).toBe(2);
  });

  it("resets the request budget after the window expires", () => {
    const now = { value: 1_000 };

    const governor = new SdkGovernor({
      maxRequestsPerWindow: 1,
      windowSeconds: 60,
      now: () => now.value,
    });

    governor.setConnectivity("ONLINE");

    expect(governor.acquire().decision).toBe("ALLOW");
    governor.release();

    expect(
      governor.check().decision,
    ).toBe("BUDGET_EXHAUSTED");

    now.value += 60_000;

    expect(
      governor.check().decision,
    ).toBe("ALLOW");

    expect(
      governor.getState().requestsInWindow,
    ).toBe(0);
  });

  it("keeps connectivity independent from request counters", () => {
    const governor = new SdkGovernor();

    governor.setConnectivity("ONLINE");
    governor.acquire();

    governor.setConnectivity("OFFLINE");

    expect(governor.check()).toEqual({
      decision: "OFFLINE",
      allowed: false,
    });

    const state: GovernorState =
      governor.getState();

    expect(state.connectivity).toBe("OFFLINE");
    expect(state.inFlight).toBe(1);
    expect(state.requestsInWindow).toBe(1);
  });

  it("validates concurrency configuration", () => {
    expect(
      () =>
        new SdkGovernor({
          maxConcurrentRequests: 0,
        }),
    ).toThrow(RangeError);

    expect(
      () =>
        new SdkGovernor({
          maxConcurrentRequests: 1.5,
        }),
    ).toThrow(RangeError);
  });

  it("validates request budget configuration", () => {
    expect(
      () =>
        new SdkGovernor({
          maxRequestsPerWindow: 0,
        }),
    ).toThrow(RangeError);

    expect(
      () =>
        new SdkGovernor({
          maxRequestsPerWindow: 1.5,
        }),
    ).toThrow(RangeError);
  });

  it("validates the window duration", () => {
    expect(
      () =>
        new SdkGovernor({
          windowSeconds: 0,
        }),
    ).toThrow(RangeError);

    expect(
      () =>
        new SdkGovernor({
          windowSeconds: -1,
        }),
    ).toThrow(RangeError);

    expect(
      () =>
        new SdkGovernor({
          windowSeconds: Number.NaN,
        }),
    ).toThrow(RangeError);
  });
});