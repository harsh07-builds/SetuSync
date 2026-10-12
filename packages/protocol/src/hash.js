import { sha256 } from "@noble/hashes/sha2.js";
import { canonicalizeJson } from "./canonicalize.js";
function bytesToHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function sha256Hex(value) {
    const bytes = new TextEncoder().encode(value);
    return bytesToHex(sha256(bytes));
}
export function sha256CanonicalJson(value) {
    return sha256Hex(canonicalizeJson(value));
}
