import { describe, expect, it } from "vitest";
import { normalizeHinglish, fuzzyTokenMatch, editDistance } from "../src/search/hinglish-search.js";
import * as sdk from "../src/index.js";

describe("Hinglish search", () => {
  it("maps common romanised Hindi terms", () => {
    expect(normalizeHinglish("Sarkari YOJANA kaise apply karein")).toContain("government scheme how");
    expect(normalizeHinglish("kisan bijli")).toBe("farmer electricity");
  });
  it("tolerates a one-letter typo", () => {
    expect(editDistance("hospital", "hospitl")).toBe(1);
    expect(fuzzyTokenMatch("aspataal", "Government hospital Bhopal")).toBe(true);
    expect(fuzzyTokenMatch("sarkari yojana", "Government scheme for farmers")).toBe(true);
    expect(fuzzyTokenMatch("goverment scheme", "Government scheme for farmers")).toBe(true);
  });
  it("is exported from the public SDK entry", () => {
    expect(typeof sdk.normalizeHinglish).toBe("function");
  });
});
