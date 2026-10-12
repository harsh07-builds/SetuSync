package in.setusync.relay.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Arrays;

/**
 * Browser access to the Relay.
 *
 * Origins come from setusync.cors.allowed-origins (comma separated,
 * env SETUSYNC_CORS_ALLOWED_ORIGINS). Entries may contain a wildcard,
 * for example https://*.vercel.app. A single "*" allows any origin,
 * which is acceptable here because the API uses no cookies; identity is
 * carried in the X-SetuSync-Install-Id header.
 */
@Configuration
public class CorsConfig {

    @Bean
    public WebMvcConfigurer setuSyncCorsConfigurer(
            @Value("${setusync.cors.allowed-origins:"
                    + "http://localhost:5173,http://127.0.0.1:5173,"
                    + "http://localhost:4173,http://127.0.0.1:4173,"
                    + "http://localhost:8088}")
            String allowedOrigins
    ) {
        String[] patterns = Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .toArray(String[]::new);

        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/v1/**")
                        .allowedOriginPatterns(patterns)
                        .allowedMethods("GET", "POST", "OPTIONS")
                        .allowedHeaders(
                                "Content-Type",
                                "Idempotency-Key",
                                "X-SetuSync-Install-Id"
                        )
                        .maxAge(3600);
            }
        };
    }
}
