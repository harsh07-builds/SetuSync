import canonicalize from "canonicalize";
import type { JsonValue } from "./types.js";

export function canonicalizeJson(value: JsonValue): string {
  const result = canonicalize(value);

  if (result === undefined) {
    throw new TypeError("Value cannot be represented as canonical JSON");
  }

  return result;
}