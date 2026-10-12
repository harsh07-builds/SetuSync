/**
 * Network lab: wraps fetch so an app can be tried on a bad network
 * without leaving the desk. Failures are a mix of "request never left"
 * and "server got it but the reply was lost", the second kind being the
 * one that breaks naive clients (and why idempotency keys exist).
 */
export type ChaosProfileName =
  | "PERFECT"
  | "3G"
  | "2G"
  | "LOSSY"
  | "TUNNEL";

export interface ChaosProfile {
  name: ChaosProfileName;
  label: string;
  latencyMs: number;
  jitterMs: number;
  /** Probability 0..1 that a request fails. */
  failureRate: number;
  /** Simulated throughput (bytes/s) for request and response bodies. */
  bytesPerSecond?: number;
  /** Alternates reachable / unreachable windows. */
  tunnel?: { upMs: number; downMs: number };
}

export const CHAOS_PROFILES: Record<ChaosProfileName, ChaosProfile> = {
  PERFECT: {
    name: "PERFECT",
    label: "Perfect network",
    latencyMs: 0,
    jitterMs: 0,
    failureRate: 0,
  },
  "3G": {
    name: "3G",
    label: "Slow 3G",
    latencyMs: 400,
    jitterMs: 200,
    failureRate: 0.05,
    bytesPerSecond: 50_000,
  },
  "2G": {
    name: "2G",
    label: "Rural 2G",
    latencyMs: 1500,
    jitterMs: 700,
    failureRate: 0.15,
    bytesPerSecond: 6_000,
  },
  LOSSY: {
    name: "LOSSY",
    label: "Lossy (30% drops)",
    latencyMs: 500,
    jitterMs: 300,
    failureRate: 0.3,
    bytesPerSecond: 30_000,
  },
  TUNNEL: {
    name: "TUNNEL",
    label: "Tunnel (on/off)",
    latencyMs: 300,
    jitterMs: 100,
    failureRate: 0.02,
    tunnel: { upMs: 6_000, downMs: 6_000 },
  },
};

export interface ChaosOptions {
  rng?: () => number;
  sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
  now?: () => number;
  /** Counters for the UI. */
  onEvent?: (event: ChaosEvent) => void;
}

export interface ChaosEvent {
  kind: "REQUEST" | "DROPPED_BEFORE_SERVER" | "REPLY_LOST" | "TUNNEL_DOWN";
  url: string;
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function defaultSleep(
  ms: number,
  signal?: AbortSignal | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createChaosFetch(
  base: typeof fetch,
  getProfile: () => ChaosProfile,
  options: ChaosOptions = {},
): typeof fetch {
  const rng = options.rng ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => Date.now());
  const origin = now();

  const wrapped = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const profile = getProfile();
    const url = String(input);
    const signal = init?.signal ?? null;

    options.onEvent?.({ kind: "REQUEST", url });

    if (profile.name === "PERFECT") {
      return base(input, init);
    }

    const bodyBytes =
      typeof init?.body === "string" ? init.body.length : 0;
    const uplink =
      profile.bytesPerSecond === undefined
        ? 0
        : (bodyBytes / profile.bytesPerSecond) * 1000;

    await sleep(
      profile.latencyMs + rng() * profile.jitterMs + uplink,
      signal,
    );

    if (profile.tunnel !== undefined) {
      const cycle = profile.tunnel.upMs + profile.tunnel.downMs;
      const phase = (now() - origin) % cycle;

      if (phase >= profile.tunnel.upMs) {
        options.onEvent?.({ kind: "TUNNEL_DOWN", url });
        throw new TypeError("Failed to fetch (simulated tunnel)");
      }
    }

    const fails = rng() < profile.failureRate;

    if (fails && rng() < 0.5) {
      options.onEvent?.({ kind: "DROPPED_BEFORE_SERVER", url });
      throw new TypeError("Failed to fetch (simulated drop)");
    }

    const response = await base(input, init);

    if (fails) {
      options.onEvent?.({ kind: "REPLY_LOST", url });
      throw new TypeError("Failed to fetch (simulated lost reply)");
    }

    if (profile.bytesPerSecond !== undefined) {
      const size = (await response.clone().arrayBuffer()).byteLength;
      await sleep((size / profile.bytesPerSecond) * 1000, signal);
    }

    return response;
  };

  return wrapped as typeof fetch;
}
