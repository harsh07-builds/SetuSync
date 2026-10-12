import { describe, expect, it } from "vitest";

import { MockCapsuleTransport } from "../src/testing/mock-transport.js";

describe("MockCapsuleTransport", () => {
  it("returns the deterministic mock Capsule", async () => {
    const transport = new MockCapsuleTransport();

    const capsule = await transport.fetchCapsule({
      engine: "google",
      query: "government hospital",
      params: {
        gl: "in",
        hl: "en",
      },
    });

    expect(capsule.v).toBe(1);
    expect(capsule.alg).toBe("Ed25519");
    expect(capsule.body.engine).toBe("google");
    expect(capsule.body.organic_results).toHaveLength(1);
  });

  it("rejects an unsupported mock request", async () => {
    const transport = new MockCapsuleTransport();

    await expect(
      transport.fetchCapsule({
        engine: "google",
        query: "something else",
        params: {},
      }),
    ).rejects.toThrow("Mock capsule not found for request");
  });
});