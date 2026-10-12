package in.setusync.relay.storage;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.minio.BucketExistsArgs;
import io.minio.GetObjectArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.Objects;

@Service
@ConditionalOnProperty(
        prefix = "setusync.object-store",
        name = "provider",
        havingValue = "minio"
)
public class MinioCapsuleObjectStore implements CapsuleObjectStore {

    private final MinioClient minioClient;
    private final ObjectMapper objectMapper;
    private final String bucket;

    public MinioCapsuleObjectStore(
            MinioClient minioClient,
            ObjectMapper objectMapper,
            @Value("${setusync.object-store.bucket}") String bucket
    ) {
        this.minioClient = minioClient;
        this.objectMapper = objectMapper;
        this.bucket = bucket;
    }

    @Override
    public String store(String capsuleId, JsonNode capsule) {
        if (capsuleId == null || capsuleId.isBlank()) {
            throw new IllegalArgumentException("Capsule ID is required");
        }

        Objects.requireNonNull(capsule, "Capsule document is required");

        String objectKey = objectKey(capsuleId);

        try {
            boolean bucketExists = minioClient.bucketExists(
                    BucketExistsArgs.builder()
                            .bucket(bucket)
                            .build()
            );

            if (!bucketExists) {
                minioClient.makeBucket(
                        MakeBucketArgs.builder()
                                .bucket(bucket)
                                .build()
                );
            }

            byte[] content = objectMapper.writeValueAsBytes(capsule);

            minioClient.putObject(
                    PutObjectArgs.builder()
                            .bucket(bucket)
                            .object(objectKey)
                            .contentType("application/json")
                            .stream(
                                    new ByteArrayInputStream(content),
                                    content.length,
                                    -1
                            )
                            .build()
            );

            return objectKey;

        } catch (Exception exception) {
            throw new IllegalStateException(
                    "Failed to store Capsule " + capsuleId,
                    exception
            );
        }
    }

    @Override
    public JsonNode read(String objectKey) {
        if (objectKey == null || objectKey.isBlank()) {
            throw new IllegalArgumentException(
                    "Capsule object key is required"
            );
        }

        try (InputStream inputStream = minioClient.getObject(
                GetObjectArgs.builder()
                        .bucket(bucket)
                        .object(objectKey)
                        .build()
        )) {
            return objectMapper.readTree(inputStream);

        } catch (Exception exception) {
            throw new IllegalStateException(
                    "Failed to read Capsule object " + objectKey,
                    exception
            );
        }
    }

    private String objectKey(String capsuleId) {
        return "capsules/"
                + capsuleId.replace(':', '-')
                + ".json";
    }
}