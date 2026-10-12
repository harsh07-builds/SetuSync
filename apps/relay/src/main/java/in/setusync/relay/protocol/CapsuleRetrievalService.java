package in.setusync.relay.protocol;

import com.fasterxml.jackson.databind.JsonNode;
import in.setusync.relay.persistence.CapsuleRepository;
import in.setusync.relay.storage.CapsuleObjectStore;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;

@Service
@ConditionalOnProperty(
        prefix = "setusync.object-store",
        name = "enabled",
        havingValue = "true"
)
public class CapsuleRetrievalService {

    private final CapsuleRepository capsuleRepository;
    private final CapsuleObjectStore objectStore;

    public CapsuleRetrievalService(
            CapsuleRepository capsuleRepository,
            CapsuleObjectStore objectStore
    ) {
        this.capsuleRepository = capsuleRepository;
        this.objectStore = objectStore;
    }

    public Optional<RetrievedCapsule> getByCacheKey(
            String cacheKey
    ) {
        if (cacheKey == null || cacheKey.isBlank()) {
            throw new IllegalArgumentException(
                    "Cache key is required"
            );
        }

        Optional<CapsuleRepository.CapsuleMetadata> metadata =
                capsuleRepository.findValidByCacheKey(
                        cacheKey,
                        Instant.now()
                );

        if (metadata.isEmpty()) {
            return Optional.empty();
        }

        return Optional.of(
                readAndValidate(metadata.get())
        );
    }

    public Optional<RetrievedCapsule> getByCapsuleId(
            String capsuleId
    ) {
        if (capsuleId == null || capsuleId.isBlank()) {
            throw new IllegalArgumentException(
                    "Capsule ID is required"
            );
        }

        Optional<CapsuleRepository.CapsuleMetadata> metadata =
                capsuleRepository.findById(capsuleId);

        if (metadata.isEmpty()) {
            return Optional.empty();
        }

        return Optional.of(
                readAndValidate(metadata.get())
        );
    }

    private RetrievedCapsule readAndValidate(
            CapsuleRepository.CapsuleMetadata metadata
    ) {
        Objects.requireNonNull(
                metadata,
                "Capsule metadata is required"
        );

        JsonNode capsule =
                objectStore.read(
                        metadata.objectKey()
                );

        if (capsule == null || !capsule.isObject()) {
            throw new IllegalStateException(
                    "Stored Capsule is not a JSON object: "
                            + metadata.id()
            );
        }

        JsonNode body =
                capsule.get("body");

        if (body == null || !body.isObject()) {
            throw new IllegalStateException(
                    "Stored Capsule has no body: "
                            + metadata.id()
            );
        }

        String bodyId =
                text(body, "id");

        String bodyKey =
                text(body, "key");

        String bodyChash =
                text(body, "chash");

        if (!metadata.id().equals(bodyId)) {
            throw new IllegalStateException(
                    "Stored Capsule ID does not match metadata: "
                            + metadata.id()
            );
        }

        if (!metadata.cacheKey().equals(bodyKey)) {
            throw new IllegalStateException(
                    "Stored Capsule cache key does not match metadata: "
                            + metadata.id()
            );
        }

        if (!metadata.chash().equals(bodyChash)) {
            throw new IllegalStateException(
                    "Stored Capsule CHASH does not match metadata: "
                            + metadata.id()
            );
        }

        return new RetrievedCapsule(
                metadata.id(),
                metadata.cacheKey(),
                metadata.chash(),
                capsule
        );
    }

    private String text(
            JsonNode node,
            String field
    ) {
        JsonNode value =
                node.get(field);

        if (value == null
                || !value.isTextual()
                || value.asText().isBlank()) {
            throw new IllegalStateException(
                    "Capsule body field is missing or invalid: "
                            + field
            );
        }

        return value.asText();
    }

    public record RetrievedCapsule(
            String id,
            String cacheKey,
            String chash,
            JsonNode document
    ) {
    }
}