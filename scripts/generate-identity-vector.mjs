import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  canonicalizeJson,
  computeCapsuleId,
  computeContentHash,
  computeRequestKey,
} from "../packages/protocol/dist/index.js";

const request = {
  engine: "google",
  query: "government hospital",
  params: {
    gl: "in",
    hl: "en",
  },
};

const content = {
  organic_results: [
    {
      position: 1,
      title: "Hospital A",
      link: "https://example.com/a",
    },
  ],
  related_questions: [],
};

const bodyWithoutId = {
  key: computeRequestKey(request),
  chash: computeContentHash(content),
  engine: request.engine,
  params: request.params,
  fetched_at: "2026-10-04T00:00:00Z",
  ttl_s: 3600,
  source: {
    provider: "serpapi",
  },
  organic_results: content.organic_results,
  related_questions: content.related_questions,
};

const output = {
  version: 1,

  request,
  request_canonical: canonicalizeJson({
    engine: request.engine,
    query: request.query,
    params: request.params,
  }),
  request_key: computeRequestKey(request),

  content,
  content_canonical: canonicalizeJson(content),
  content_hash: computeContentHash(content),

  body_without_id: bodyWithoutId,
  body_canonical: canonicalizeJson(bodyWithoutId),
  capsule_id: computeCapsuleId(bodyWithoutId),
};

const outputPath = resolve(
  process.cwd(),
  "packages/protocol/vectors/identity-v1.json",
);

mkdirSync(dirname(outputPath), { recursive: true });

writeFileSync(
  outputPath,
  `${JSON.stringify(output, null, 2)}\n`,
  "utf8",
);

console.log(`Wrote ${outputPath}`);