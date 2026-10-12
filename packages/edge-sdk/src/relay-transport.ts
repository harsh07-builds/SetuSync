import type {
  Capsule,
  CapsuleRequest,
} from "@setusync/protocol";

import type { CapsuleTransport } from "./transport.js";

/**
 * Failure categories a caller can react to.
 *
 * NETWORK   the Relay could not be reached (offline, wrong URL, CORS, DNS)
 * TIMEOUT   the Relay was reachable but did not finish in time
 * HTTP      the Relay answered with an unexpected HTTP status
 * FAILED    the Relay accepted the search but could not complete it;
 *           `reason` carries the Relay's explanation when it gave one
 * EXPIRED   the ticket expired before it could be collected
 * PROTOCOL  the Relay answered with something that is not a Capsule
 * ABORTED   the caller cancelled the request
 */
export type RelayErrorCode =
  | "NETWORK"
  | "TIMEOUT"
  | "HTTP"
  | "FAILED"
  | "EXPIRED"
  | "PROTOCOL"
  | "ABORTED";

export class RelayError extends Error {
  public readonly code: RelayErrorCode;
  public readonly status: number | undefined;
  public readonly reason: string | undefined;

  public constructor(
    code: RelayErrorCode,
    message: string,
    details: { status?: number; reason?: string } = {},
  ) {
    super(message);
    this.name = "RelayError";
    this.code = code;
    this.status = details.status;
    this.reason = details.reason;
  }

  /** True when retrying later (for example when back online) can help. */
  public get retryable(): boolean {
    return (
      this.code === "NETWORK" ||
      this.code === "TIMEOUT" ||
      (this.code === "HTTP" &&
        this.status !== undefined &&
        this.status >= 500)
    );
  }
}

export type RelayProgressPhase =
  | "SUBMITTING"
  | "WAITING"
  | "COLLECTING";

export interface RelayProgress {
  phase: RelayProgressPhase;
  query: string;
  ticketId?: string;
  ticketState?: string;
  elapsedMs: number;
}

export interface RelayTransportOptions {
  /**
   * Base URL of the Relay, for example https://relay.example.com.
   * An empty string means "same origin" (requests go to /v1/...), which
   * is what the bundled nginx reverse proxy uses.
   */
  baseUrl: string;

  /** The install identity (UUID v4) or a function that returns it. */
  installId: string | (() => string);

  fetchImpl?: typeof fetch;

  /** Per HTTP request. Default 15 s. */
  requestTimeoutMs?: number;

  /** First delay between ticket polls. Default 1 s. */
  pollIntervalMs?: number;

  /** Largest delay between ticket polls. Default 4 s. */
  maxPollIntervalMs?: number;

  /** Total time to wait for a ticket to become READY. Default 120 s. */
  maxWaitMs?: number;

  /**
   * Consecutive transient poll failures tolerated before giving up.
   * Intermittent links are the normal case here. Default 4.
   */
  maxTransientPollFailures?: number;

  /** Freshness requested from the Relay, in seconds. Default 24 h. */
  maxAgeSeconds?: number;

  /** Name of the provider parameter that carries the query. Default "q". */
  queryParameter?: string;

  onProgress?: (progress: RelayProgress) => void;

  /** Test hooks. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  randomId?: () => string;
}

export interface RelayFetchOptions {
  signal?: AbortSignal;
}

interface RelayTicket {
  ticketId?: unknown;
  state?: unknown;
  reason?: unknown;
}

const DEFAULTS = {
  requestTimeoutMs: 15_000,
  pollIntervalMs: 1_000,
  maxPollIntervalMs: 4_000,
  maxWaitMs: 120_000,
  maxTransientPollFailures: 4,
  maxAgeSeconds: 86_400,
  queryParameter: "q",
} as const;

function defaultSleep(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RelayError("ABORTED", "Request cancelled."));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new RelayError("ABORTED", "Request cancelled."));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function stringifyParams(
  params: CapsuleRequest["params"],
): Record<string, string> {
  const result: Record<string, string> = {};

  if (params === undefined) {
    return result;
  }

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      continue;
    }

    result[key] =
      typeof value === "string" ? value : JSON.stringify(value);
  }

  return result;
}

function isCapsule(value: unknown): value is Capsule {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const body = (value as { body?: unknown }).body;

  if (typeof body !== "object" || body === null) {
    return false;
  }

  const record = body as Record<string, unknown>;

  return (
    typeof record["id"] === "string" &&
    typeof record["key"] === "string" &&
    typeof record["fetched_at"] === "string" &&
    typeof record["ttl_s"] === "number" &&
    Array.isArray(record["organic_results"])
  );
}

/**
 * CapsuleTransport that talks to a SetuSync Relay.
 *
 *   POST /v1/search      -> 200 {state:"READY", key, capsule}
 *                        -> 202 {ticketId, state}   (acquisition running)
 *   GET  /v1/tickets/:id -> {ticketId, state, reason?}
 *
 * The transport hides that dance: fetchCapsule() resolves with a Capsule
 * or rejects with a RelayError that says what went wrong and whether a
 * retry is worthwhile.
 */
export class RelayCapsuleTransport implements CapsuleTransport {
  private readonly baseUrl: string;
  private readonly installId: () => string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxPollIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly maxTransientPollFailures: number;
  private readonly maxAgeSeconds: number;
  private readonly queryParameter: string;
  private readonly onProgress:
    | ((progress: RelayProgress) => void)
    | undefined;
  private readonly sleep: (
    ms: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  private readonly now: () => number;
  private readonly randomId: () => string;

  public constructor(options: RelayTransportOptions) {
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, "");

    const installId = options.installId;
    this.installId =
      typeof installId === "function" ? installId : () => installId;

    this.fetchImpl =
      options.fetchImpl ?? globalThis.fetch.bind(globalThis);

    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;
    this.pollIntervalMs =
      options.pollIntervalMs ?? DEFAULTS.pollIntervalMs;
    this.maxPollIntervalMs =
      options.maxPollIntervalMs ?? DEFAULTS.maxPollIntervalMs;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULTS.maxWaitMs;
    this.maxTransientPollFailures =
      options.maxTransientPollFailures ??
      DEFAULTS.maxTransientPollFailures;
    this.maxAgeSeconds =
      options.maxAgeSeconds ?? DEFAULTS.maxAgeSeconds;
    this.queryParameter =
      options.queryParameter ?? DEFAULTS.queryParameter;
    this.onProgress = options.onProgress;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => Date.now());
    this.randomId =
      options.randomId ?? (() => globalThis.crypto.randomUUID());
  }

  public async fetchCapsule(
    request: CapsuleRequest,
    options: RelayFetchOptions = {},
  ): Promise<Capsule> {
    const started = this.now();
    const deadline = started + this.maxWaitMs;
    const signal = options.signal;

    const emit = (
      phase: RelayProgressPhase,
      extra: { ticketId?: string; ticketState?: string } = {},
    ): void => {
      this.onProgress?.({
        phase,
        query: request.query,
        elapsedMs: this.now() - started,
        ...extra,
      });
    };

    emit("SUBMITTING");

    const first = await this.search(request, signal);

    if (first.status === 200) {
      return this.unwrapCapsule(first.body);
    }

    if (first.status !== 202) {
      throw new RelayError(
        "HTTP",
        `Relay answered HTTP ${first.status} to the search request.`,
        { status: first.status },
      );
    }

    const ticketId = (first.body as RelayTicket | undefined)?.ticketId;

    if (typeof ticketId !== "string" || ticketId.length === 0) {
      throw new RelayError(
        "PROTOCOL",
        "Relay accepted the search but returned no ticket id.",
      );
    }

    let delay = this.pollIntervalMs;
    let transientFailures = 0;
    let lastState = "PROCESSING";

    for (;;) {
      if (this.now() >= deadline) {
        throw new RelayError(
          "TIMEOUT",
          `The relay did not finish within ${Math.round(
            this.maxWaitMs / 1000,
          )}s (last state: ${lastState}). The request is still ` +
            "queued on the relay; try again shortly.",
        );
      }

      await this.sleep(delay, signal);
      delay = Math.min(
        Math.round(delay * 1.4),
        this.maxPollIntervalMs,
      );

      let ticket: RelayTicket;

      try {
        const response = await this.http(
          "GET",
          `/v1/tickets/${encodeURIComponent(ticketId)}`,
          undefined,
          signal,
        );

        if (response.status === 404) {
          throw new RelayError(
            "EXPIRED",
            "The relay no longer knows this ticket.",
            { status: 404 },
          );
        }

        if (response.status >= 500) {
          throw new RelayError(
            "HTTP",
            `Relay answered HTTP ${response.status} while waiting.`,
            { status: response.status },
          );
        }

        if (response.status !== 200) {
          throw new RelayError(
            "HTTP",
            `Relay answered HTTP ${response.status} while waiting.`,
            { status: response.status },
          );
        }

        ticket = (response.body ?? {}) as RelayTicket;
        transientFailures = 0;
      } catch (error) {
        if (
          error instanceof RelayError &&
          error.retryable &&
          transientFailures < this.maxTransientPollFailures
        ) {
          transientFailures += 1;
          continue;
        }

        throw error;
      }

      const state =
        typeof ticket.state === "string" ? ticket.state : "UNKNOWN";
      lastState = state;

      emit("WAITING", { ticketId, ticketState: state });

      if (state === "FAILED") {
        const reason =
          typeof ticket.reason === "string" && ticket.reason
            ? ticket.reason
            : undefined;

        throw new RelayError(
          "FAILED",
          reason ??
            "The relay could not complete this search.",
          reason === undefined ? {} : { reason },
        );
      }

      if (state === "EXPIRED") {
        throw new RelayError(
          "EXPIRED",
          "The relay search expired before it finished.",
        );
      }

      if (state === "READY") {
        emit("COLLECTING", { ticketId, ticketState: state });
        return this.collect(request, signal);
      }
    }
  }

  /**
   * Once a ticket is READY the Capsule is in the Relay's cache; asking
   * for the same search again returns it with HTTP 200.
   */
  private async collect(
    request: CapsuleRequest,
    signal: AbortSignal | undefined,
  ): Promise<Capsule> {
    let lastStatus = 0;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await this.search(request, signal);

      if (result.status === 200) {
        return this.unwrapCapsule(result.body);
      }

      lastStatus = result.status;

      if (attempt < 2) {
        await this.sleep(500 * (attempt + 1), signal);
      }
    }

    throw new RelayError(
      "HTTP",
      `The search finished but the relay returned HTTP ${lastStatus} ` +
        "when the result was collected.",
      { status: lastStatus },
    );
  }

  private unwrapCapsule(body: unknown): Capsule {
    const candidate =
      typeof body === "object" && body !== null
        ? ((body as { capsule?: unknown }).capsule ?? body)
        : undefined;

    if (!isCapsule(candidate)) {
      const keys =
        typeof body === "object" && body !== null
          ? Object.keys(body).join(", ")
          : typeof body;

      throw new RelayError(
        "PROTOCOL",
        "The relay response is not a valid capsule " +
          `(received: ${keys || "empty object"}).`,
      );
    }

    return candidate;
  }

  private search(
    request: CapsuleRequest,
    signal: AbortSignal | undefined,
  ): Promise<{ status: number; body: unknown }> {
    const params = stringifyParams(request.params);

    if (params[this.queryParameter] === undefined) {
      params[this.queryParameter] = request.query;
    }

    return this.http(
      "POST",
      "/v1/search",
      {
        engine: request.engine,
        params,
        max_age_s: this.maxAgeSeconds,
        wait_ms: 0,
        accept: { lite: true, full: true },
      },
      signal,
    );
  }

  private async http(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    external: AbortSignal | undefined,
  ): Promise<{ status: number; body: unknown }> {
    if (external?.aborted) {
      throw new RelayError("ABORTED", "Request cancelled.");
    }

    const controller = new AbortController();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeoutMs);

    const onExternalAbort = (): void => controller.abort();
    external?.addEventListener("abort", onExternalAbort, {
      once: true,
    });

    const headers: Record<string, string> = {
      "X-SetuSync-Install-Id": this.installId(),
    };

    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      headers["Idempotency-Key"] = this.randomId();
    }

    const url = `${this.baseUrl}${path}`;

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        signal: controller.signal,
        ...(body === undefined
          ? {}
          : { body: JSON.stringify(body) }),
      });

      const text = await response.text();
      let parsed: unknown;

      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
      }

      if (response.status >= 400) {
        const message =
          typeof parsed === "object" &&
          parsed !== null &&
          typeof (parsed as { message?: unknown }).message ===
            "string"
            ? (parsed as { message: string }).message
            : text.slice(0, 200) || response.statusText;

        // 4xx other than a missing ticket is a request problem; callers
        // handle 404 themselves, so only throw for the rest here.
        if (response.status !== 404) {
          throw new RelayError(
            "HTTP",
            `Relay HTTP ${response.status}: ${message}`,
            { status: response.status },
          );
        }
      }

      return { status: response.status, body: parsed };
    } catch (error) {
      if (error instanceof RelayError) {
        throw error;
      }

      if (external?.aborted) {
        throw new RelayError("ABORTED", "Request cancelled.");
      }

      if (timedOut) {
        throw new RelayError(
          "TIMEOUT",
          `The relay did not answer within ${Math.round(
            this.requestTimeoutMs / 1000,
          )}s.`,
        );
      }

      throw new RelayError(
        "NETWORK",
        `Could not reach the relay at ${
          this.baseUrl || "this site"
        }. Check your connection, the relay URL and its CORS settings.`,
      );
    } finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    }
  }
}
