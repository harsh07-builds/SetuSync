package in.setusync.relay.config;

import io.minio.MinioClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConditionalOnProperty(
    prefix = "setusync.object-store",
    name = "provider",
    havingValue = "minio"
)
public class MinioClientConfiguration {

    @Bean
    public MinioClient minioClient(
            @Value("${setusync.object-store.endpoint}") String endpoint,
            @Value("${setusync.object-store.access-key}") String accessKey,
            @Value("${setusync.object-store.secret-key}") String secretKey) {

        if (endpoint == null || endpoint.isBlank()
                || accessKey == null || accessKey.isBlank()
                || secretKey == null || secretKey.isBlank()) {
            throw new IllegalStateException(
                "MinIO endpoint and credentials are required when object storage provider is minio"
            );
        }

        return MinioClient.builder()
            .endpoint(endpoint)
            .credentials(accessKey, secretKey)
            .build();
    }
}