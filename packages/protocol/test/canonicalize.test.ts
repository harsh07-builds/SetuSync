import { describe, expect, it } from "vitest";
import { canonicalizeJson } from "../src/canonicalize.js";

describe("canonicalizeJson", () => {
  it("sorts object properties deterministically", () => {
    const input = {
      b: 2,
      a: 1,
      nested: {
        d: 4,
        c: 3,
      },
    };

    expect(canonicalizeJson(input)).toBe(
      '{"a":1,"b":2,"nested":{"c":3,"d":4}}',
    );
  });

  it("preserves array order", () => {
    const input = {
      values: [3, 1, 2],
    };

    expect(canonicalizeJson(input)).toBe(
      '{"values":[3,1,2]}',
    );
  });

  it("uses JCS-compatible number serialization", () => {
    const input = {
      integer: 4.0,
      small: 0.002,
    };

    expect(canonicalizeJson(input)).toBe(
      '{"integer":4,"small":0.002}',
    );
  });

  it("preserves Unicode strings without normalization", () => {
    const input = {
      text: "Cafe\u0301",
    };

    expect(canonicalizeJson(input)).toBe(
      '{"text":"Café"}',
    );
  });

  it("rejects non-finite numbers", () => {
    expect(() =>
      canonicalizeJson({
        value: Number.NaN,
      }),
    ).toThrow();

    expect(() =>
      canonicalizeJson({
        value: Number.POSITIVE_INFINITY,
      }),
    ).toThrow();
  });
});