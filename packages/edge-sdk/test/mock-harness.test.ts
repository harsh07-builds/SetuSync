import { describe, expect, it } from "vitest";
import {
  getMockCapsule,
  MOCK_CAPSULE,
} from "../src/testing/mock-capsule.js";

describe("Mock SDK harness", () => {
  it("provides a deterministic Capsule", () => {
    const capsule = getMockCapsule();

    expect(capsule.v).toBe(1);
    expect(capsule.alg).toBe("Ed25519");
    expect(capsule.body.engine).toBe("google");
    expect(capsule.body.organic_results).toHaveLength(1);
  });

  it("returns an independent Capsule copy", () => {
    const first = getMockCapsule();
    const second = getMockCapsule();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first).not.toBe(MOCK_CAPSULE);
  });
});