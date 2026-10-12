import type {
  CapsuleBody,
  CapsuleRequest,
} from "./capsule.js";
import type { HexSha256, JsonObject } from "./types.js";
import {
  sha256CanonicalJson,
} from "./hash.js";

function requestIdentityPayload(
  request: CapsuleRequest,
): JsonObject {
  return {
    engine: request.engine,
    query: request.query,
    params: request.params ?? {},
  };
}

export function computeRequestKey(
  request: CapsuleRequest,
): HexSha256 {
  return sha256CanonicalJson(
    requestIdentityPayload(request),
  );
}

export function computeContentHash(
  body: Pick<
    CapsuleBody,
    "organic_results" | "related_questions"
  >,
): HexSha256 {
  return sha256CanonicalJson({
    organic_results: body.organic_results,
    related_questions: body.related_questions ?? [],
  });
}

export function computeCapsuleId(
  body: Omit<CapsuleBody, "id">,
): HexSha256 {
  return sha256CanonicalJson(body);
}