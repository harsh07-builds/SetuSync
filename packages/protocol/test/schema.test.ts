import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const schemaPath = fileURLToPath(
  new URL("../schema/capsule-v1.schema.json", import.meta.url),
);

const schema = JSON.parse(
  readFileSync(schemaPath, "utf8"),
) as Record<string, unknown>;

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});

addFormats(ajv);

const validateCapsule = ajv.compile(schema);

const validCapsule = {
  v: 1,
  kid: "setusync-dev-key-1",
  alg: "Ed25519",
  sig: "test-signature",
  body: {
    id: "c20eb5bd033ecd8f5ce26494e9d33b3930273c07be67af99a0ca4a3b8684a30f",
    key: "d811fd3c66cf497b5998eb622821c4e4d37f944d228f708b36379e7f1a776999",
    chash:
      "a6cf45173a7296a648cd3ad5cdd1c9cf3d4c3c19ac4b82b4f12c393cd3db15e7",
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
    organic_results: [
      {
        position: 1,
        title: "Hospital A",
        link: "https://example.com/a",
      },
    ],
    related_questions: [],
  },
};

describe("Capsule JSON Schema", () => {
  it("accepts a structurally valid Capsule", () => {
    expect(validateCapsule(validCapsule)).toBe(true);
  });

  it("rejects an invalid Capsule version", () => {
    const invalidCapsule = {
      ...validCapsule,
      v: 2,
    };

    expect(validateCapsule(invalidCapsule)).toBe(false);
  });

  it("rejects an invalid SHA-256 field", () => {
    const invalidCapsule = {
      ...validCapsule,
      body: {
        ...validCapsule.body,
        id: "not-a-sha256",
      },
    };

    expect(validateCapsule(invalidCapsule)).toBe(false);
  });

  it("rejects an invalid signing algorithm", () => {
    const invalidCapsule = {
      ...validCapsule,
      alg: "RSA",
    };

    expect(validateCapsule(invalidCapsule)).toBe(false);
  });

  it("rejects a Capsule missing the body", () => {
    const invalidCapsule = {
      v: 1,
      kid: "setusync-dev-key-1",
      alg: "Ed25519",
      sig: "test-signature",
    };

    expect(validateCapsule(invalidCapsule)).toBe(false);
  });
});