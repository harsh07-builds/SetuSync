package in.setusync.relay.storage;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Base64;
import java.util.Objects;

@Service
@ConditionalOnProperty(
        prefix = "setusync.object-store",
        name = "provider",
        havingValue = "local"
)
public class LocalCapsuleObjectStore implements CapsuleObjectStore {

    private final ObjectMapper objectMapper;
    private final Path root;

    public LocalCapsuleObjectStore(
            ObjectMapper objectMapper,
            @Value("${setusync.object-store.local-directory:./data/capsules}")
            String directory
    ) {
        this.objectMapper = objectMapper;
        this.root = Path.of(directory).toAbsolutePath().normalize();
    }

    @Override
    public String store(String capsuleId, JsonNode capsule) {
        if (capsuleId == null || capsuleId.isBlank()) {
            throw new IllegalArgumentException("Capsule ID is required");
        }
        Objects.requireNonNull(capsule, "Capsule document is required");

        String key = objectKey(capsuleId);
        Path target = resolve(key);
        Path temporary = target.resolveSibling(target.getFileName() + ".tmp");

        try {
            Files.createDirectories(target.getParent());
            objectMapper.writeValue(temporary.toFile(), capsule);
            try {
                Files.move(
                        temporary, target,
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING
                );
            } catch (IOException atomicMoveFailure) {
                Files.move(
                        temporary, target,
                        StandardCopyOption.REPLACE_EXISTING
                );
            }
            return key;
        } catch (IOException exception) {
            throw new IllegalStateException(
                    "Failed to store Capsule " + capsuleId, exception
            );
        } finally {
            try {
                Files.deleteIfExists(temporary);
            } catch (IOException ignored) {
                // Preserve the original storage result or exception.
            }
        }
    }

    @Override
    public JsonNode read(String objectKey) {
        if (objectKey == null || objectKey.isBlank()) {
            throw new IllegalArgumentException("Object key is required");
        }

        try {
            Path file = resolve(objectKey);
            if (!Files.isRegularFile(file)) {
                throw new IllegalStateException(
                        "Capsule object does not exist: " + objectKey
                );
            }
            return objectMapper.readTree(file.toFile());
        } catch (IOException exception) {
            throw new IllegalStateException(
                    "Failed to read Capsule object " + objectKey, exception
            );
        }
    }

    private Path resolve(String key) {
        Path path = root.resolve(key).normalize();
        if (!path.startsWith(root)) {
            throw new IllegalArgumentException("Invalid capsule object key");
        }
        return path;
    }

    private String objectKey(String capsuleId) {
        String encoded = Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(capsuleId.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return "capsules/" + encoded + ".json";
    }
}
