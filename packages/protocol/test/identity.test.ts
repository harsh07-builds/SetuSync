import { describe, expect, it } from "vitest";
import {
  computeCapsuleId,
  computeContentHash,
  computeRequestKey,
} from "../src/identity.js";

describe("SetuSync identity", () => {
  it("produces the same request key when object property order changes", () => {
    const first = {
      engine: "google",
      query: "government hospital",
      params: {
        gl: "in",
        hl: "en",
      },
    };

    const second = {
      engine: "google",
      query: "government hospital",
      params: {
        hl: "en",
        gl: "in",
      },
    };

    expect(computeRequestKey(first)).toBe(
      computeRequestKey(second),
    );
  });

  it("changes request key when the query changes", () => {
    const first = {
      engine: "google",
      query: "government hospital",
      params: {},
    };

    const second = {
      engine: "google",
      query: "government office",
      params: {},
    };

    expect(computeRequestKey(first)).not.toBe(
      computeRequestKey(second),
    );
  });

  it("changes content hash when result content changes", () => {
    const first = {
      organic_results: [
        {
          position: 1,
          title: "Hospital A",
          link: "https://example.com/a",
        },
      ],
      related_questions: [],
    };

    const second = {
      organic_results: [
        {
          position: 1,
          title: "Hospital B",
          link: "https://example.com/b",
        },
      ],
      related_questions: [],
    };

    expect(computeContentHash(first)).not.toBe(
      computeContentHash(second),
    );
  });

  it("computes a stable Capsule id from the body", () => {
    const body = {
      key: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
      chash: "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100",
      engine: "google",
      params: {
        gl: "in",
        hl: "en",
      },
      fetched_at: "2026-10-04T00:00:00Z",
      ttl_s: 3600,
      source: {
        provider: "serpapi",
      },
      organic_results: [],
    };

    const id1 = computeCapsuleId(body);

    const id2 = computeCapsuleId({
      ...body,
      params: {
        hl: "en",
        gl: "in",
      },
    });

    expect(id1).toBe(id2);
  });
});