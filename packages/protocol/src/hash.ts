import { sha256 } from "@noble/hashes/sha2.js";
import type { HexSha256, JsonValue } from "./types.js";
import { canonicalizeJson } from "./canonicalize.js";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function sha256Hex(value: string): HexSha256 {
  const bytes = new TextEncoder().encode(value);
  return bytesToHex(sha256(bytes));
}

export function sha256CanonicalJson(value: JsonValue): HexSha256 {
  return sha256Hex(canonicalizeJson(value));
}