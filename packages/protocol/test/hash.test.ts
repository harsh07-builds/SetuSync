import { describe, expect, it } from "vitest";
import {
  sha256CanonicalJson,
  sha256Hex,
} from "../src/hash.js";

describe("SHA-256", () => {
  it("produces the standard SHA-256 for abc", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes canonical JSON", () => {
    expect(
      sha256CanonicalJson({
        b: 2,
        a: 1,
      }),
    ).toBe(
      sha256Hex('{"a":1,"b":2}'),
    );
  });
});