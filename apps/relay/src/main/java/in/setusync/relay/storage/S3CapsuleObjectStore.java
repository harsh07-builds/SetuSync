package in.setusync.relay.storage;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;

import java.net.URI;

@Service
@ConditionalOnProperty(
        prefix = "setusync.object-store",
        name = "provider",
        havingValue = "s3"
)
public class S3CapsuleObjectStore implements CapsuleObjectStore {

    private final S3Client s3Client;
    private final ObjectMapper objectMapper;
    private final String bucket;

    public S3CapsuleObjectStore(
            ObjectMapper objectMapper,
            @Value("${setusync.object-store.bucket:}") String bucket,
            @Value("${setusync.object-store.region:}") String region,
            @Value("${setusync.object-store.endpoint:}") String endpoint
    ) {
        if (bucket == null || bucket.isBlank()) {
            throw new IllegalArgumentException(
                    "setusync.object-store.bucket must be configured for S3"
            );
        }

        if (region == null || region.isBlank()) {
            throw new IllegalArgumentException(
                    "setusync.object-store.region must be configured for S3"
            );
        }

        this.objectMapper = objectMapper;
        this.bucket = bucket.trim();

        var builder = S3Client.builder()
                .region(Region.of(region.trim()));

        if (endpoint != null && !endpoint.isBlank()) {
            builder.endpointOverride(URI.create(endpoint.trim()));
        }

        this.s3Client = builder.build();
    }

    @Override
    public String store(
            String capsuleId,
            JsonNode capsule
    ) {
        if (capsuleId == null || capsuleId.isBlank()) {
            throw new IllegalArgumentException(
                    "Capsule ID must not be blank"
            );
        }

        if (capsule == null || !capsule.isObject()) {
            throw new IllegalArgumentException(
                    "Capsule must be a JSON object"
            );
        }

        String objectKey = objectKey(capsuleId);

        try {
            byte[] bytes =
                    objectMapper.writeValueAsBytes(capsule);

            PutObjectRequest request =
                    PutObjectRequest.builder()
                            .bucket(bucket)
                            .key(objectKey)
                            .contentType("application/json")
                            .contentLength((long) bytes.length)
                            .build();

            s3Client.putObject(
                    request,
                    RequestBody.fromBytes(bytes)
            );

            return objectKey;

        } catch (Exception exception) {
            throw new IllegalStateException(
                    "Could not store Capsule object in S3",
                    exception
            );
        }
    }

    @Override
    public JsonNode read(String objectKey) {
        if (objectKey == null || objectKey.isBlank()) {
            throw new IllegalArgumentException(
                    "Object key must not be blank"
            );
        }

        try {
            GetObjectRequest request =
                    GetObjectRequest.builder()
                            .bucket(bucket)
                            .key(objectKey)
                            .build();

            ResponseBytes<GetObjectResponse> response =
                    s3Client.getObjectAsBytes(request);

            return objectMapper.readTree(
                    response.asByteArray()
            );

        } catch (NoSuchKeyException exception) {
            throw new IllegalStateException(
                    "Capsule object does not exist: " + objectKey,
                    exception
            );
        } catch (Exception exception) {
            throw new IllegalStateException(
                    "Could not read Capsule object from S3: "
                            + objectKey,
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
