import { describe, expect, it } from "vitest";
import {
  canonicalizeJson,
  computeCapsuleId,
  computeContentHash,
  computeRequestKey,
  type Capsule,
  type CapsuleBody,
} from "@setusync/protocol";
import {
  CapsuleVerifier,
  type CapsulePublicKey,
} from "../src/verification/capsule-verifier.js";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createBody(): CapsuleBody {
  const request = {
    engine: "google",
    query: "government hospital",
    params: {
      gl: "in",
      hl: "en",
    },
  };

  const organicResults = [
    {
      position: 1,
      title: "Government Hospital Bhopal",
      link: "https://example.com/bhopal",
      snippet: "Public hospital services",
    },
  ];

  const key = computeRequestKey(request);

  const chash = computeContentHash({
    organic_results: organicResults,
    related_questions: [],
  });

  const bodyWithoutId = {
    key,
    chash,
    engine: request.engine,
    params: request.params,
    fetched_at: "2026-10-04T12:00:00Z",
    ttl_s: 3600,
    source: {
      provider: "serpapi",
    },
    organic_results: organicResults,
    related_questions: [],
  };

  const id = computeCapsuleId(bodyWithoutId);

  return {
    id,
    ...bodyWithoutId,
  };
}

async function createSignedCapsule(): Promise<{
  capsule: Capsule;
  publicKey: CapsulePublicKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "Ed25519",
    },
    true,
    ["sign", "verify"],
  );

  const body = createBody();

  const message = new TextEncoder().encode(
    canonicalizeJson(body),
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign(
      {
        name: "Ed25519",
      },
      keyPair.privateKey,
      message,
    ),
  );

  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey(
      "raw",
      keyPair.publicKey,
    ),
  );

  return {
    capsule: {
      v: 1,
      kid: "test-key-1",
      alg: "Ed25519",
      sig: bytesToBase64Url(signature),
      body,
    },
    publicKey,
  };
}

function createVerifier(
  publicKey: CapsulePublicKey,
): CapsuleVerifier {
  return new CapsuleVerifier(
    async (kid) => {
      if (kid !== "test-key-1") {
        return undefined;
      }

      return publicKey;
    },
  );
}

describe("CapsuleVerifier", () => {
  it("accepts a valid signed capsule", async () => {
    const { capsule, publicKey } =
      await createSignedCapsule();

    const result =
      await createVerifier(publicKey).verify(capsule);

    expect(result).toEqual({
      valid: true,
      signatureValid: true,
      idValid: true,
      contentHashValid: true,
    });
  });

  it("rejects a capsule whose body was modified", async () => {
    const { capsule, publicKey } =
      await createSignedCapsule();

    const tamperedCapsule: Capsule = {
      ...capsule,
      body: {
        ...capsule.body,
        organic_results: [
          {
            ...capsule.body.organic_results[0],
            title: "Modified Hospital",
          },
        ],
      },
    };

    const result =
      await createVerifier(publicKey).verify(
        tamperedCapsule,
      );

    expect(result.valid).toBe(false);
    expect(result.idValid).toBe(false);
    expect(result.contentHashValid).toBe(false);
  });

  it("rejects a capsule with an invalid signature", async () => {
    const { capsule, publicKey } =
      await createSignedCapsule();

    const invalidSignatureCapsule: Capsule = {
      ...capsule,
      sig: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    };

    const result =
      await createVerifier(publicKey).verify(
        invalidSignatureCapsule,
      );

    expect(result.valid).toBe(false);
    expect(result.signatureValid).toBe(false);
    expect(result.idValid).toBe(true);
    expect(result.contentHashValid).toBe(true);
    expect(result.reason).toBe(
      "Invalid capsule signature",
    );
  });

  it("rejects an unknown key ID", async () => {
    const { capsule, publicKey } =
      await createSignedCapsule();

    const unknownKeyCapsule: Capsule = {
      ...capsule,
      kid: "unknown-key",
    };

    const result =
      await createVerifier(publicKey).verify(
        unknownKeyCapsule,
      );

    expect(result.valid).toBe(false);
    expect(result.signatureValid).toBe(false);
    expect(result.reason).toBe(
      "Unknown capsule key ID",
    );
  });

  it("rejects an invalid capsule ID", async () => {
    const { capsule, publicKey } =
      await createSignedCapsule();

    const invalidIdCapsule: Capsule = {
      ...capsule,
      body: {
        ...capsule.body,
        id: "0000000000000000000000000000000000000000000000000000000000000000",
      },
    };

    const result =
      await createVerifier(publicKey).verify(
        invalidIdCapsule,
      );

    expect(result.valid).toBe(false);
    expect(result.idValid).toBe(false);
    expect(result.reason).toBe(
      "Capsule ID mismatch",
    );
  });

  it("rejects an invalid content hash", async () => {
    const { capsule, publicKey } =
      await createSignedCapsule();

    const invalidHashCapsule: Capsule = {
      ...capsule,
      body: {
        ...capsule.body,
        chash:
          "0000000000000000000000000000000000000000000000000000000000000000",
      },
    };

    const result =
      await createVerifier(publicKey).verify(
        invalidHashCapsule,
      );

    expect(result.valid).toBe(false);
    expect(result.contentHashValid).toBe(false);
    expect(result.reason).toBe(
      "Capsule content hash mismatch",
    );
  });

  it("rejects an unsupported capsule version", async () => {
    const { capsule, publicKey } =
      await createSignedCapsule();

    const invalidVersionCapsule = {
      ...capsule,
      v: 2,
    } as Capsule;

    const result =
      await createVerifier(publicKey).verify(
        invalidVersionCapsule,
      );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe(
      "Unsupported capsule version",
    );
  });

  it("rejects an unsupported signature algorithm", async () => {
    const { capsule, publicKey } =
      await createSignedCapsule();

    const invalidAlgorithmCapsule = {
      ...capsule,
      alg: "RSA",
    } as unknown as Capsule;

    const result =
      await createVerifier(publicKey).verify(
        invalidAlgorithmCapsule,
      );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe(
      "Unsupported capsule signature algorithm",
    );
  });

  it("rejects a malformed signature encoding without throwing", async () => {
    const { capsule, publicKey } =
      await createSignedCapsule();

    const malformedSignatureCapsule: Capsule = {
      ...capsule,
      sig: "!!not*base64!!",
    };

    const result =
      await createVerifier(publicKey).verify(
        malformedSignatureCapsule,
      );

    expect(result.valid).toBe(false);
    expect(result.signatureValid).toBe(false);
    expect(result.idValid).toBe(true);
    expect(result.contentHashValid).toBe(true);
    expect(result.reason).toBe(
      "Malformed capsule signature encoding",
    );
  });
});
