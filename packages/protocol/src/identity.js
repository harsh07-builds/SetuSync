import { sha256CanonicalJson, } from "./hash.js";
function requestIdentityPayload(request) {
    return {
        engine: request.engine,
        query: request.query,
        params: request.params ?? {},
    };
}
export function computeRequestKey(request) {
    return sha256CanonicalJson(requestIdentityPayload(request));
}
export function computeContentHash(body) {
    return sha256CanonicalJson({
        organic_results: body.organic_results,
        related_questions: body.related_questions ?? [],
    });
}
export function computeCapsuleId(body) {
    return sha256CanonicalJson(body);
}
