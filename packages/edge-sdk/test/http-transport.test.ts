import { describe, expect, it, vi } from "vitest";

import type { Capsule } from "@setusync/protocol";

import { HttpCapsuleTransport } from "../src/http-transport.js";

const request = {
  engine: "google",
  query: "Bhopal",
  params: {
    location: "India",
  },
};

const capsule: Capsule = {
  v: 1,
  kid: "test-key",
  alg: "Ed25519",
  sig: "test-signature",
  body: {
    id: "test-capsule-id",
    key: "test-request-key",
    chash: "test-content-hash",
    engine: "google",
    params: {
      location: "India",
      q: "Bhopal",
    },
    fetched_at: "2026-10-04T00:00:00.000Z",
    ttl_s: 86400,
    source: {
      provider: "test",
    },
    organic_results: [],
  },
};

describe("HttpCapsuleTransport", () => {
  it("sends the request as JSON with POST", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify(capsule), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });

    const transport = new HttpCapsuleTransport({
      endpoint: "https://relay.example.com/api/capsules",
      fetchImpl: fetchMock,
    });

    await transport.fetchCapsule(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];

    expect(url).toBe("https://relay.example.com/api/capsules");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "content-type": "application/json",
    });

    expect(JSON.parse(String(init?.body))).toEqual(request);
  });

  it("returns the Capsule returned by the Relay", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify(capsule), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });

    const transport = new HttpCapsuleTransport({
      endpoint: "https://relay.example.com/api/capsules",
      fetchImpl: fetchMock,
    });

    const result = await transport.fetchCapsule(request);

    expect(result).toEqual(capsule);
  });

  it("throws a useful error for a non-success response", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response("Relay unavailable", {
        status: 503,
        statusText: "Service Unavailable",
      });
    });

    const transport = new HttpCapsuleTransport({
      endpoint: "https://relay.example.com/api/capsules",
      fetchImpl: fetchMock,
    });

    await expect(
      transport.fetchCapsule(request),
    ).rejects.toThrow(
      "Relay request failed with HTTP 503: Relay unavailable",
    );
  });

  it("allows custom headers", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify(capsule), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });

    const transport = new HttpCapsuleTransport({
      endpoint: "https://relay.example.com/api/capsules",
      fetchImpl: fetchMock,
      headers: {
        authorization: "Bearer test-token",
      },
    });

    await transport.fetchCapsule(request);

    const [, init] = fetchMock.mock.calls[0] ?? [];

    expect(init?.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer test-token",
    });
  });
});
