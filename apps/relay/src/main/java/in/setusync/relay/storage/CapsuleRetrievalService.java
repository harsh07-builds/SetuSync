package in.setusync.relay.storage;

import com.fasterxml.jackson.databind.JsonNode;
import in.setusync.relay.persistence.CapsuleRepository;
import in.setusync.relay.persistence.CapsuleRepository.CapsuleMetadata;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Objects;

@Service("storageCapsuleRetrievalService")
@ConditionalOnProperty(
        prefix = "setusync.object-store",
        name = "enabled",
        havingValue = "true"
)
public class CapsuleRetrievalService {

    private final CapsuleRepository capsuleRepository;
    private final CapsuleObjectStoreReader objectStoreReader;

    public CapsuleRetrievalService(
            CapsuleRepository capsuleRepository,
            CapsuleObjectStoreReader objectStoreReader
    ) {
        this.capsuleRepository = capsuleRepository;
        this.objectStoreReader = objectStoreReader;
    }

    public RetrievedCapsule getByCacheKey(String cacheKey) {
        if (cacheKey == null || cacheKey.isBlank()) {
            throw new IllegalArgumentException(
                    "Cache key is required"
            );
        }

        CapsuleMetadata metadata =
                capsuleRepository.findValidByCacheKey(
                        cacheKey,
                        Instant.now()
                ).orElse(null);

        if (metadata == null) {
            return null;
        }

        JsonNode capsule =
                objectStoreReader.read(metadata.objectKey());

        validateStoredCapsule(metadata, capsule);

        return new RetrievedCapsule(
                metadata.id(),
                metadata.cacheKey(),
                metadata.chash(),
                metadata.objectKey(),
                capsule
        );
    }

    private void validateStoredCapsule(
            CapsuleMetadata metadata,
            JsonNode capsule
    ) {
        Objects.requireNonNull(
                capsule,
                "Stored Capsule must not be null"
        );

        JsonNode body = capsule.path("body");

        String capsuleId = body.path("id").asText(null);
        String capsuleChash = body.path("chash").asText(null);
        String capsuleKey = body.path("key").asText(null);

        if (!metadata.id().equals(capsuleId)) {
            throw new IllegalStateException(
                    "Stored Capsule ID does not match database metadata"
            );
        }

        if (!metadata.chash().equals(capsuleChash)) {
            throw new IllegalStateException(
                    "Stored Capsule CHASH does not match database metadata"
            );
        }

        if (!metadata.cacheKey().equals(capsuleKey)) {
            throw new IllegalStateException(
                    "Stored Capsule cache key does not match database metadata"
            );
        }
    }

    public record RetrievedCapsule(
            String id,
            String cacheKey,
            String chash,
            String objectKey,
            JsonNode capsule
    ) {
    }
}