package in.setusync.relay.acquisition;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import in.setusync.relay.domain.SearchRequest;
import in.setusync.relay.persistence.CapsuleCompilationRepository;
import in.setusync.relay.persistence.CapsuleCompilationRepository.CapsuleCompilationClaim;
import in.setusync.relay.persistence.CapsuleRepository;
import in.setusync.relay.protocol.CapsuleDocumentCompiler;
import in.setusync.relay.protocol.CapsuleDocumentCompiler.CapsuleInput;
import in.setusync.relay.storage.CapsuleObjectStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Instant;

@Component
@ConditionalOnProperty(
        prefix = "setusync.object-store",
        name = "enabled",
        havingValue = "true"
)
public class CapsuleCompilationWorker {

    private static final Logger log =
            LoggerFactory.getLogger(CapsuleCompilationWorker.class);

    private static final int BATCH_SIZE = 10;
    private static final int CLAIM_LEASE_SECONDS = 120;

    private static final long CAPSULE_TTL_SECONDS = 1_209_600L;
    private static final long CAPSULE_MAX_LEASE_SECONDS = 3_628_800L;

    private final CapsuleCompilationRepository compilationRepository;
    private final CapsuleDocumentCompiler compiler;
    private final CapsuleObjectStore objectStore;
    private final CapsuleRepository capsuleRepository;
    private final CapsuleCompletionService completionService;
    private final LedgerService ledgerService;
    private final ObjectMapper objectMapper;

    public CapsuleCompilationWorker(
            CapsuleCompilationRepository compilationRepository,
            CapsuleDocumentCompiler compiler,
            CapsuleObjectStore objectStore,
            CapsuleRepository capsuleRepository,
            CapsuleCompletionService completionService,
            LedgerService ledgerService,
            ObjectMapper objectMapper
    ) {
        this.compilationRepository = compilationRepository;
        this.compiler = compiler;
        this.objectStore = objectStore;
        this.capsuleRepository = capsuleRepository;
        this.completionService = completionService;
        this.ledgerService = ledgerService;
        this.objectMapper = objectMapper;
    }

    @Scheduled(
            fixedDelayString =
                    "${setusync.acquisition.capsule-compile-interval-ms:5000}"
    )
    public void compileReadyCapsules() {
        var claims = compilationRepository.claimReady(
                BATCH_SIZE,
                CLAIM_LEASE_SECONDS
        );

        for (CapsuleCompilationClaim claim : claims) {
            processClaim(claim);
        }
    }

    private void processClaim(
            CapsuleCompilationClaim claim
    ) {
        try {
            JsonNode capsule = compile(claim);

            String capsuleId = requiredText(
                    capsule.path("body"),
                    "id"
            );

            String cacheKey = requiredText(
                    capsule.path("body"),
                    "key"
            );

            String chash = requiredText(
                    capsule.path("body"),
                    "chash"
            );

            String kid = requiredText(
                    capsule,
                    "kid"
            );

            JsonNode body =
                    capsule.path("body");

            Instant fetchedAt =
                    Instant.parse(
                            requiredText(
                                    body,
                                    "fetched_at"
                            )
                    );

            long ttlSeconds =
                    body.path("ttl_s").asLong();

            String risk =
                    requiredText(
                            body.path("meta"),
                            "risk"
                    );

            String objectKey =
                    objectStore.store(
                            capsuleId,
                            capsule
                    );

            capsuleRepository.save(
                    capsuleId,
                    cacheKey,
                    chash,
                    fetchedAt,
                    fetchedAt.plusSeconds(ttlSeconds),
                    risk,
                    kid,
                    objectKey
            );

            recordLedger(
                    claim,
                    capsule
            );

            completionService.complete(
                    claim.jobId(),
                    claim.claimToken()
            );

            log.info(
                    "Capsule compiled and persisted for job {}: {}",
                    claim.jobId(),
                    capsuleId
            );

        } catch (Exception exception) {
            log.error(
                    "Capsule compilation failed for job {}",
                    claim.jobId(),
                    exception
            );

            try {
                compilationRepository.releaseClaim(
                        claim.jobId(),
                        claim.claimToken(),
                        safeErrorMessage(exception)
                );
            } catch (Exception releaseException) {
                log.error(
                        "Could not release Capsule compilation claim for job {}",
                        claim.jobId(),
                        releaseException
                );
            }
        }
    }

    private void recordLedger(
            CapsuleCompilationClaim claim,
            JsonNode capsule
    ) throws Exception {
        JsonNode source =
                capsule
                        .path("body")
                        .path("source");

        int credits =
                source
                        .path("credits")
                        .asInt();

        boolean providerCache =
                source
                        .path("cache")
                        .asBoolean(false);

        if (credits < 0) {
            throw new IllegalArgumentException(
                    "Compiled Capsule contains negative provider credits"
            );
        }

        String kind =
                providerCache
                        ? "ACQUISITION_CACHE_HIT"
                        : "ACQUISITION_PROVIDER";

        int savedCredits =
                providerCache ? 1 : 0;

        long bytesRaw =
                claim.providerResultJson()
                        .getBytes(StandardCharsets.UTF_8)
                        .length;

        long bytesCapsule =
                objectMapper
                        .writeValueAsBytes(capsule)
                        .length;

        ledgerService.recordAcquisitionOutcome(
                claim.jobId(),
                kind,
                credits,
                savedCredits,
                bytesRaw,
                bytesCapsule
        );
    }

    private JsonNode compile(
            CapsuleCompilationClaim claim
    ) throws Exception {

        SearchRequest request =
                objectMapper.readValue(
                        claim.requestPayloadJson(),
                        SearchRequest.class
                );

        JsonNode providerResult =
                objectMapper.readTree(
                        claim.providerResultJson()
                );

        JsonNode searchMetadata =
                providerResult.path(
                        "search_metadata"
                );

        if (!searchMetadata.isObject()) {
            throw new IllegalArgumentException(
                    "Provider result has no search_metadata object"
            );
        }

        String providerSearchId =
                requiredText(
                        searchMetadata,
                        "id"
                );

        if (!providerSearchId.equals(
                claim.providerSearchId()
        )) {
            throw new IllegalArgumentException(
                    "Provider search ID does not match the claimed job"
            );
        }

        String providerStatus =
                requiredText(
                        searchMetadata,
                        "status"
                );

        boolean providerCache =
                "Cached".equalsIgnoreCase(
                        providerStatus
                );

        if (!providerCache &&
                !"Success".equalsIgnoreCase(
                        providerStatus
                )) {
            throw new IllegalArgumentException(
                    "Provider result is not successful: "
                            + providerStatus
            );
        }

        int providerCredits =
                providerCache ? 0 : 1;

        JsonNode organicResults =
                arrayOrEmpty(
                        providerResult,
                        "organic_results"
                );

        JsonNode relatedQuestions =
                arrayOrEmpty(
                        providerResult,
                        "related_questions"
                );

        String language =
                request.params()
                        .getOrDefault(
                                "hl",
                                "und"
                        );

        Instant fetchedAt =
                claim.providerResultReceivedAt();

        if (fetchedAt == null) {
            throw new IllegalArgumentException(
                    "Provider result received timestamp is missing"
            );
        }

        CapsuleInput input =
                new CapsuleInput(
                        request.engine(),
                        request.params(),
                        fetchedAt,
                        CAPSULE_TTL_SECONDS,
                        CAPSULE_MAX_LEASE_SECONDS,
                        claim.providerSearchId(),
                        providerCredits,
                        providerCache,
                        organicResults,
                        relatedQuestions,
                        "unknown",
                        false,
                        language,
                        "Results acquired from SerpApi and not independently reviewed."
                );

        return compiler.compile(input);
    }

    private JsonNode arrayOrEmpty(
            JsonNode parent,
            String field
    ) {
        JsonNode value =
                parent.get(field);

        if (value == null ||
                value.isNull()) {
            return JsonNodeFactory
                    .instance
                    .arrayNode();
        }

        if (!value.isArray()) {
            throw new IllegalArgumentException(
                    field +
                            " must be a JSON array when present"
            );
        }

        return value;
    }

    private String requiredText(
            JsonNode parent,
            String field
    ) {
        JsonNode value =
                parent.get(field);

        if (value == null ||
                !value.isTextual() ||
                value.asText().isBlank()) {
            throw new IllegalArgumentException(
                    "Missing or invalid provider field: "
                            + field
            );
        }

        return value.asText();
    }

    private String safeErrorMessage(
            Exception exception
    ) {
        String message =
                exception.getMessage();

        if (message == null ||
                message.isBlank()) {
            return exception
                    .getClass()
                    .getSimpleName();
        }

        return message.length() <= 1000
                ? message
                : message.substring(0, 1000);
    }
}