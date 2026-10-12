import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import {
  canonicalizeJson,
  computeCapsuleId,
  computeContentHash,
  computeRequestKey,
} from "../src/index.js";

interface IdentityVector {
  version: number;
  request: {
    engine: string;
    query: string;
    params: Record<string, unknown>;
  };
  request_canonical: string;
  request_key: string;
  content: {
    organic_results: unknown[];
    related_questions: unknown[];
  };
  content_canonical: string;
  content_hash: string;
  body_without_id: Record<string, unknown>;
  body_canonical: string;
  capsule_id: string;
}

const vectorPath = resolve(
  import.meta.dirname,
  "../vectors/identity-v1.json",
);

const vector = JSON.parse(
  readFileSync(vectorPath, "utf8"),
) as IdentityVector;

describe("identity-v1 golden vector", () => {
  it("matches the recorded request canonical form", () => {
    expect(
      canonicalizeJson(vector.request as never),
    ).toBe(vector.request_canonical);
  });

  it("matches the recorded request key", () => {
    expect(computeRequestKey(vector.request)).toBe(
      vector.request_key,
    );
  });

  it("matches the recorded content canonical form", () => {
    expect(
      canonicalizeJson(vector.content as never),
    ).toBe(vector.content_canonical);
  });

  it("matches the recorded content hash", () => {
    expect(computeContentHash(vector.content as never)).toBe(
      vector.content_hash,
    );
  });

  it("matches the recorded Capsule body canonical form", () => {
    expect(
      canonicalizeJson(vector.body_without_id as never),
    ).toBe(vector.body_canonical);
  });

  it("matches the recorded Capsule id", () => {
    expect(
      computeCapsuleId(vector.body_without_id as never),
    ).toBe(vector.capsule_id);
  });
});