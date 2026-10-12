package in.setusync.relay.protocol;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;

@Component
public class CapsuleDocumentCompiler {

    private final ObjectMapper objectMapper;
    private final SearchCacheKeyService cacheKeyService;
    private final CapsuleIntegrityService integrityService;
    private final CapsuleSigningService signingService;

    public CapsuleDocumentCompiler(
            ObjectMapper objectMapper,
            SearchCacheKeyService cacheKeyService,
            CapsuleIntegrityService integrityService,
            CapsuleSigningService signingService
    ) {
        this.objectMapper = objectMapper;
        this.cacheKeyService = cacheKeyService;
        this.integrityService = integrityService;
        this.signingService = signingService;
    }

    public ObjectNode compile(CapsuleInput input) {
        validate(input);

        String cacheKey = cacheKeyService.generate(
                input.engine(),
                input.params()
        );

        ObjectNode capsuleParams = objectMapper.createObjectNode();
        capsuleParams.put("engine", input.engine());

        new TreeMap<>(input.params()).forEach(capsuleParams::put);

        String chash = integrityService.computeChash(
                input.organicResults(),
                input.relatedQuestions()
        );

        ObjectNode bodyWithoutId = objectMapper.createObjectNode();

        bodyWithoutId.put("kind", "serp");
        bodyWithoutId.put("key", cacheKey);
        bodyWithoutId.put("chash", chash);
        bodyWithoutId.set("params", capsuleParams);

        bodyWithoutId.put(
                "fetched_at",
                input.fetchedAt().toString()
        );

        bodyWithoutId.put("ttl_s", input.ttlSeconds());
        bodyWithoutId.put("max_lease_s", input.maxLeaseSeconds());

        ObjectNode source = objectMapper.createObjectNode();
        source.put("provider", "serpapi");
        source.put("search_id", input.providerSearchId());
        source.put("credits", input.providerCredits());
        source.put("cache", input.providerCache());

        bodyWithoutId.set("source", source);

        bodyWithoutId.set(
                "organic_results",
                input.organicResults().deepCopy()
        );

        bodyWithoutId.set(
                "related_questions",
                input.relatedQuestions().deepCopy()
        );

        ObjectNode meta = objectMapper.createObjectNode();

        MetadataPolicy.apply(meta, input.language());

        bodyWithoutId.set("meta", meta);

        String capsuleId = integrityService.computeCapsuleId(
                bodyWithoutId
        );

        ObjectNode body = bodyWithoutId.deepCopy();
        body.put("id", capsuleId);

        String canonicalBody = integrityService.canonicalize(body);

        CapsuleSigningService.SignedCapsuleSignature signed =
                signingService.signCanonicalBody(canonicalBody);

        ObjectNode capsule = objectMapper.createObjectNode();

        capsule.put("v", 1);
        capsule.put("kid", signed.kid());
        capsule.put("alg", signed.algorithm());
        capsule.put("sig", signed.signature());
        capsule.set("body", body);

        return capsule;
    }

    private void validate(CapsuleInput input) {
        Objects.requireNonNull(input, "input must not be null");

        if (input.engine() == null || input.engine().isBlank()) {
            throw new IllegalArgumentException(
                    "engine must not be blank"
            );
        }

        if (input.params() == null) {
            throw new IllegalArgumentException(
                    "params must not be null"
            );
        }

        if (input.params().containsKey("engine")) {
            throw new IllegalArgumentException(
                    "params must not contain engine; provide it separately"
            );
        }

        if (input.fetchedAt() == null) {
            throw new IllegalArgumentException(
                    "fetchedAt must not be null"
            );
        }

        if (input.ttlSeconds() <= 0) {
            throw new IllegalArgumentException(
                    "ttlSeconds must be positive"
            );
        }

        if (input.maxLeaseSeconds() < input.ttlSeconds()) {
            throw new IllegalArgumentException(
                    "maxLeaseSeconds must be greater than or equal to ttlSeconds"
            );
        }

        if (input.providerSearchId() == null
                || input.providerSearchId().isBlank()) {
            throw new IllegalArgumentException(
                    "providerSearchId must not be blank"
            );
        }

        if (input.providerCredits() < 0) {
            throw new IllegalArgumentException(
                    "providerCredits must not be negative"
            );
        }

        if (input.organicResults() == null
                || !input.organicResults().isArray()) {
            throw new IllegalArgumentException(
                    "organicResults must be a JSON array"
            );
        }

        if (input.relatedQuestions() == null
                || !input.relatedQuestions().isArray()) {
            throw new IllegalArgumentException(
                    "relatedQuestions must be a JSON array"
            );
        }

        if (input.language() == null || input.language().isBlank()) {
            throw new IllegalArgumentException(
                    "language must not be blank"
            );
        }
    }

    public record CapsuleInput(
            String engine,
            Map<String, String> params,
            Instant fetchedAt,
            long ttlSeconds,
            long maxLeaseSeconds,
            String providerSearchId,
            int providerCredits,
            boolean providerCache,
            JsonNode organicResults,
            JsonNode relatedQuestions,
            String risk,
            boolean reviewed,
            String language,
            String microSummary
    ) {
    }
}
