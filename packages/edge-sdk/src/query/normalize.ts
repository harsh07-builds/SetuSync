/**
 * Query normalisation.
 *
 * Two users who type "Best cafe in Tokyo", "best  cafes tokyo?" and
 * "tokyo best cafe" want the same thing. Treating them as different
 * searches wastes a provider credit each time, so:
 *
 *  - `display`   is the light, safe form that is actually sent to the
 *                Relay (trimmed, NFKC, lower-case, spaces collapsed,
 *                edge punctuation removed). Everyone's phrasing of the
 *                *same text* converges on one cache key.
 *  - `canonical` is an aggressive, order-insensitive form used only
 *                on the device to recognise an equivalent query that is
 *                already cached. It is never sent anywhere.
 */

const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "in", "at", "on", "of", "for", "to", "and",
  "is", "are", "me", "my", "with", "from", "near", "by",
]);

const EDGE_PUNCTUATION = /^[\s"'\u201c\u201d\u2018\u2019.,;:!?]+|[\s"'\u201c\u201d\u2018\u2019.,;:!?]+$/gu;
const TOKEN_SPLIT = /[^\p{L}\p{M}\p{N}+#]+/u;

export interface NormalizedQuery {
  display: string;
  canonical: string;
}

function stem(token: string): string {
  // "cafes" -> "cafe". Only used for equality, never shown or sent.
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }

  return token;
}

export function normalizeQuery(query: string): NormalizedQuery {
  const display = query
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(EDGE_PUNCTUATION, "");

  const tokens = display.split(TOKEN_SPLIT).filter((t) => t !== "");
  const meaningful = tokens.filter((t) => !STOPWORDS.has(t));
  const source = meaningful.length > 0 ? meaningful : tokens;

  const canonical = [...new Set(source.map(stem))].sort().join(" ");

  return { display, canonical };
}

export function areEquivalentQueries(a: string, b: string): boolean {
  const left = normalizeQuery(a).canonical;
  return left !== "" && left === normalizeQuery(b).canonical;
}
