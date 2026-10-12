export type GovernorDecision =
  | "ALLOW"
  | "OFFLINE"
  | "CONCURRENCY_LIMIT"
  | "BUDGET_EXHAUSTED";

export interface SdkGovernorOptions {
  maxConcurrentRequests?: number;
  maxRequestsPerWindow?: number;
  windowSeconds?: number;
  now?: () => number;
}

export interface GovernorState {
  connectivity: "ONLINE" | "OFFLINE";
  inFlight: number;
  requestsInWindow: number;
  windowStartedAt: number;
}

export interface GovernorCheckResult {
  decision: GovernorDecision;
  allowed: boolean;
  retryAfterSeconds?: number;
}

export class SdkGovernor {
  private readonly maxConcurrentRequests: number;
  private readonly maxRequestsPerWindow: number;
  private readonly windowSeconds: number;
  private readonly now: () => number;

  private connectivity: "ONLINE" | "OFFLINE" = "OFFLINE";
  private inFlight = 0;
  private requestsInWindow = 0;
  private windowStartedAt: number;

  public constructor(
    options: SdkGovernorOptions = {},
  ) {
    this.maxConcurrentRequests =
      options.maxConcurrentRequests ?? 2;

    this.maxRequestsPerWindow =
      options.maxRequestsPerWindow ?? 10;

    this.windowSeconds =
      options.windowSeconds ?? 60;

    this.now = options.now ?? (() => Date.now());
    this.windowStartedAt = this.now();

    if (
      !Number.isInteger(this.maxConcurrentRequests) ||
      this.maxConcurrentRequests <= 0
    ) {
      throw new RangeError(
        "maxConcurrentRequests must be a positive integer",
      );
    }

    if (
      !Number.isInteger(this.maxRequestsPerWindow) ||
      this.maxRequestsPerWindow <= 0
    ) {
      throw new RangeError(
        "maxRequestsPerWindow must be a positive integer",
      );
    }

    if (
      !Number.isFinite(this.windowSeconds) ||
      this.windowSeconds <= 0
    ) {
      throw new RangeError(
        "windowSeconds must be a positive number",
      );
    }
  }

  public setConnectivity(
    connectivity: "ONLINE" | "OFFLINE",
  ): void {
    this.connectivity = connectivity;
  }

  public check(): GovernorCheckResult {
    this.refreshWindow();

    if (this.connectivity === "OFFLINE") {
      return {
        decision: "OFFLINE",
        allowed: false,
      };
    }

    if (
      this.inFlight >=
      this.maxConcurrentRequests
    ) {
      return {
        decision: "CONCURRENCY_LIMIT",
        allowed: false,
      };
    }

    if (
      this.requestsInWindow >=
      this.maxRequestsPerWindow
    ) {
      return {
        decision: "BUDGET_EXHAUSTED",
        allowed: false,
        retryAfterSeconds:
          this.remainingWindowSeconds(),
      };
    }

    return {
      decision: "ALLOW",
      allowed: true,
    };
  }

  public acquire(): GovernorCheckResult {
    const result = this.check();

    if (!result.allowed) {
      return result;
    }

    this.inFlight += 1;
    this.requestsInWindow += 1;

    return result;
  }

  public release(): void {
    if (this.inFlight === 0) {
      return;
    }

    this.inFlight -= 1;
  }

  public getState(): GovernorState {
    this.refreshWindow();

    return {
      connectivity: this.connectivity,
      inFlight: this.inFlight,
      requestsInWindow: this.requestsInWindow,
      windowStartedAt: this.windowStartedAt,
    };
  }

  private refreshWindow(): void {
    const elapsedSeconds =
      (this.now() - this.windowStartedAt) / 1000;

    if (elapsedSeconds >= this.windowSeconds) {
      this.windowStartedAt = this.now();
      this.requestsInWindow = 0;
    }
  }

  private remainingWindowSeconds(): number {
    const elapsedSeconds =
      (this.now() - this.windowStartedAt) / 1000;

    return Math.max(
      0,
      Math.ceil(this.windowSeconds - elapsedSeconds),
    );
  }
}