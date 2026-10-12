import {
  computeCapsuleId,
  computeContentHash,
  computeRequestKey,
  type Capsule,
  type CapsuleRequest,
  type SearchResult,
} from "@setusync/protocol";

const MOCK_REQUEST: CapsuleRequest = {
  engine: "google",
  query: "government hospital",
  params: {
    gl: "in",
    hl: "en",
  },
};

const MOCK_RESULTS: SearchResult[] = [
  {
    position: 1,
    title: "Hospital A",
    link: "https://example.com/a",
    snippet: "Example hospital result",
  },
];

const CONTENT = {
  organic_results: MOCK_RESULTS,
  related_questions: [],
};

const KEY = computeRequestKey(MOCK_REQUEST);

const CHASH = computeContentHash(CONTENT);

const BODY_WITHOUT_ID = {
  key: KEY,
  chash: CHASH,
  engine: MOCK_REQUEST.engine,
  params: MOCK_REQUEST.params ?? {},
  fetched_at: "2026-10-04T00:00:00Z",
  ttl_s: 3600,
  source: {
    provider: "serpapi",
  },
  organic_results: MOCK_RESULTS,
  related_questions: [],
};

const ID = computeCapsuleId(BODY_WITHOUT_ID);

export const MOCK_CAPSULE: Capsule = {
  v: 1,
  kid: "setusync-mock-key-1",
  alg: "Ed25519",

  // This is intentionally a placeholder for Stage 2.
  // Cryptographic verification is implemented in Stage 8.
  sig: "mock-signature",

  body: {
    id: ID,
    key: KEY,
    chash: CHASH,
    engine: BODY_WITHOUT_ID.engine,
    params: BODY_WITHOUT_ID.params,
    fetched_at: BODY_WITHOUT_ID.fetched_at,
    ttl_s: BODY_WITHOUT_ID.ttl_s,
    source: BODY_WITHOUT_ID.source,
    organic_results: BODY_WITHOUT_ID.organic_results,
    related_questions: BODY_WITHOUT_ID.related_questions,
  },
};

export function getMockCapsule(): Capsule {
  return structuredClone(MOCK_CAPSULE);
}