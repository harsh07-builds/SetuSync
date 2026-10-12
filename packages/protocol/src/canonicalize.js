import canonicalize from "canonicalize";
export function canonicalizeJson(value) {
    const result = canonicalize(value);
    if (result === undefined) {
        throw new TypeError("Value cannot be represented as canonical JSON");
    }
    return result;
}
