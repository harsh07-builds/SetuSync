import { describe, expect, it } from "vitest";

import type { Capsule } from "@setusync/protocol";

import {
  RelayCapsuleTransport,
  RelayError,
  type RelayProgress,
} from "../src/relay-transport.js";

const INSTALL_ID = "3f0b9c0e-4e5a-4a8e-9a53-0d6b7c1d2e3f";

function capsule(): Capsule {
  return {
    v: 1,
    kid: "test-key",
    alg: "Ed25519",
    sig: "c2ln",
    body: {
      id: "a".repeat(64),
      key: "b".repeat(64),
      chash: "c".repeat(64),
      engine: "google",
      params: { q: "best cafe in Tokyo" },
      fetched_at: "2026-10-10T00:00:00Z",
      ttl_s: 3600,
      source: { provider: "serpapi" },
      organic_results: [
        { position: 1, title: "Cafe", link: "https://example.com" },
      ],
    },
  };
}

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (call: Call, index: number) => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeFetch(handler: Handler): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];

  const fetchImpl = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body:
        typeof init?.body === "string"
          ? JSON.parse(init.body)
          : undefined,
    };

    calls.push(call);

    return handler(call, calls.length - 1);
  }) as typeof fetch;

  return { fetchImpl, calls };
}

function transport(
  fetchImpl: typeof fetch,
  extra: Partial<
    ConstructorParameters<typeof RelayCapsuleTransport>[0]
  > = {},
): RelayCapsuleTransport {
  let id = 0;

  return new RelayCapsuleTransport({
    baseUrl: "https://relay.test/",
    installId: INSTALL_ID,
    fetchImpl,
    sleep: async () => undefined,
    randomId: () => `idem-${(id += 1)}`,
    ...extra,
  });
}

const REQUEST = {
  engine: "google",
  query: "best cafe in Tokyo",
} as const;

describe("RelayCapsuleTransport", () => {
  it("unwraps a capsule from a 200 READY envelope", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json(200, { state: "READY", key: "k", capsule: capsule() }),
    );

    const result = await transport(fetchImpl).fetchCapsule(REQUEST);

    expect(result.body.id).toBe("a".repeat(64));
    expect(calls.length).toBe(1);

    const call = calls[0]!;
    expect(call.url).toBe("https://relay.test/v1/search");
    expect(call.headers["X-SetuSync-Install-Id"]).toBe(INSTALL_ID);
    expect(call.headers["Idempotency-Key"]).toBe("idem-1");
    expect(call.body).toEqual({
      engine: "google",
      params: { q: "best cafe in Tokyo" },
      max_age_s: 86400,
      wait_ms: 0,
      accept: { lite: true, full: true },
    });
  });

  it("polls a 202 ticket until READY, then collects the capsule", async () => {
    let polls = 0;
    let searches = 0;

    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.method === "POST") {
        searches += 1;

        return searches === 1
          ? json(202, { ticketId: "t-1", state: "PROCESSING" })
          : json(200, {
              state: "READY",
              key: "k",
              capsule: capsule(),
            });
      }

      polls += 1;

      return json(200, {
        ticketId: "t-1",
        state: polls < 3 ? "PROCESSING" : "READY",
      });
    });

    const progress: RelayProgress[] = [];

    const result = await transport(fetchImpl, {
      onProgress: (p) => progress.push(p),
    }).fetchCapsule(REQUEST);

    expect(result.body.key).toBe("b".repeat(64));
    expect(polls).toBe(3);
    expect(calls.filter((c) => c.method === "POST").length).toBe(2);
    expect(progress[0]?.phase).toBe("SUBMITTING");
    expect(progress[progress.length - 1]?.phase).toBe("COLLECTING");

    // Each POST uses its own idempotency key.
    const keys = calls
      .filter((c) => c.method === "POST")
      .map((c) => c.headers["Idempotency-Key"]);
    expect(new Set(keys).size).toBe(2);
  });

  it("surfaces the relay's failure reason", async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.method === "POST"
        ? json(202, { ticketId: "t-2", state: "PROCESSING" })
        : json(200, {
            ticketId: "t-2",
            state: "FAILED",
            reason: "The relay's monthly provider-credit budget is used up.",
          }),
    );

    await expect(
      transport(fetchImpl).fetchCapsule(REQUEST),
    ).rejects.toMatchObject({
      code: "FAILED",
      reason: "The relay's monthly provider-credit budget is used up.",
      message: "The relay's monthly provider-credit budget is used up.",
    });
  });

  it("tolerates transient poll failures on a flaky link", async () => {
    let polls = 0;
    let searches = 0;

    const { fetchImpl } = fakeFetch((call) => {
      if (call.method === "POST") {
        searches += 1;

        return searches === 1
          ? json(202, { ticketId: "t-3", state: "PROCESSING" })
          : json(200, { state: "READY", key: "k", capsule: capsule() });
      }

      polls += 1;

      if (polls === 1) {
        throw new TypeError("Failed to fetch");
      }

      if (polls === 2) {
        return json(503, { message: "busy" });
      }

      return json(200, { ticketId: "t-3", state: "READY" });
    });

    const result = await transport(fetchImpl).fetchCapsule(REQUEST);

    expect(result.body.id).toBe("a".repeat(64));
    expect(polls).toBe(3);
  });

  it("gives up after too many consecutive transient failures", async () => {
    const { fetchImpl } = fakeFetch((call) => {
      if (call.method === "POST") {
        return json(202, { ticketId: "t-4", state: "PROCESSING" });
      }

      throw new TypeError("Failed to fetch");
    });

    await expect(
      transport(fetchImpl, {
        maxTransientPollFailures: 2,
      }).fetchCapsule(REQUEST),
    ).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("reports NETWORK when the relay is unreachable", async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    });

    const error = await transport(fetchImpl)
      .fetchCapsule(REQUEST)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RelayError);
    expect((error as RelayError).code).toBe("NETWORK");
    expect((error as RelayError).retryable).toBe(true);
  });

  it("times out when the relay stops answering", async () => {
    const { fetchImpl } = fakeFetch(
      (_call) =>
        new Promise<Response>(() => {
          // never settles; the abort signal is not observed here, so the
          // transport must not depend on it to give up.
        }),
    );

    // fetch fakes that ignore the signal still need a bounded wait, so
    // wrap the fake to honour the abort signal like real fetch does.
    const abortable = ((input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        void fetchImpl(input, init);
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as typeof fetch;

    await expect(
      transport(abortable, { requestTimeoutMs: 20 }).fetchCapsule(
        REQUEST,
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("times out overall when the ticket never becomes READY", async () => {
    let clock = 0;

    const { fetchImpl } = fakeFetch((call) =>
      call.method === "POST"
        ? json(202, { ticketId: "t-5", state: "PROCESSING" })
        : json(200, { ticketId: "t-5", state: "PROCESSING" }),
    );

    await expect(
      transport(fetchImpl, {
        maxWaitMs: 10_000,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      }).fetchCapsule(REQUEST),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("rejects a response that is not a capsule", async () => {
    const { fetchImpl } = fakeFetch(() =>
      json(200, {
        state: "READY",
        key: "k",
        capsule: {
          array: false,
          containerNode: true,
          missingNode: false,
        },
      }),
    );

    await expect(
      transport(fetchImpl).fetchCapsule(REQUEST),
    ).rejects.toMatchObject({ code: "PROTOCOL" });
  });

  it("maps 4xx/5xx search responses to HTTP errors", async () => {
    const { fetchImpl } = fakeFetch(() =>
      json(400, {
        code: "BAD_REQUEST",
        message: "Search parameters are required",
      }),
    );

    const error = (await transport(fetchImpl)
      .fetchCapsule(REQUEST)
      .catch((e: unknown) => e)) as RelayError;

    expect(error.code).toBe("HTTP");
    expect(error.status).toBe(400);
    expect(error.message).toContain("Search parameters are required");
    expect(error.retryable).toBe(false);
  });

  it("can be cancelled by the caller", async () => {
    const controller = new AbortController();
    controller.abort();

    const { fetchImpl } = fakeFetch(() =>
      json(200, { state: "READY", key: "k", capsule: capsule() }),
    );

    await expect(
      transport(fetchImpl).fetchCapsule(REQUEST, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("uses same-origin paths when baseUrl is empty", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json(200, { state: "READY", key: "k", capsule: capsule() }),
    );

    await transport(fetchImpl, { baseUrl: "" }).fetchCapsule(REQUEST);

    expect(calls[0]?.url).toBe("/v1/search");
  });

  it("merges extra params and stringifies non-string values", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json(200, { state: "READY", key: "k", capsule: capsule() }),
    );

    await transport(fetchImpl).fetchCapsule({
      engine: "google",
      query: "tea",
      params: { gl: "in", num: 5, flag: true },
    });

    expect((calls[0]!.body as { params: unknown }).params).toEqual({
      gl: "in",
      num: "5",
      flag: "true",
      q: "tea",
    });
  });
});
