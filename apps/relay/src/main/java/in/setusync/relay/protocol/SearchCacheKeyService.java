
package in.setusync.relay.protocol;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.erdtman.jcs.JsonCanonicalizer;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.Normalizer;
import java.util.Collections;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

@Component
public class SearchCacheKeyService {

    private final ObjectMapper objectMapper;

    public SearchCacheKeyService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public String generate(String engine, Map<String, String> params) {
        Map<String, String> normalizedParams =
                normalizeParams(engine, params);

        String normalizedEngine = normalizedParams.get("engine");

        SearchIdentity identity = new SearchIdentity(
                normalizedEngine,
                normalizedParams
        );

        try {
            String json = objectMapper.writeValueAsString(identity);

            String canonicalJson =
                    new JsonCanonicalizer(json).getEncodedString();

            byte[] digest = MessageDigest
                    .getInstance("SHA-256")
                    .digest(canonicalJson.getBytes(StandardCharsets.UTF_8));

            return "sha256:" + toHex(digest);

        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(
                    "Could not serialize search identity",
                    exception
            );
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(
                    "SHA-256 is not available",
                    exception
            );
        } catch (Exception exception) {
            throw new IllegalStateException(
                    "Could not canonicalize search identity",
                    exception
            );
        }
    }

    public Map<String, String> normalizeParams(
            String engine,
            Map<String, String> params
    ) {
        if (engine == null || engine.isBlank()) {
            throw new IllegalArgumentException(
                    "Search engine must not be blank"
            );
        }

        if (params == null) {
            throw new IllegalArgumentException(
                    "Search parameters must not be null"
            );
        }

        String normalizedEngine = normalize(engine)
                .toLowerCase(Locale.ROOT);

        Map<String, String> normalizedParams = new TreeMap<>();

        for (Map.Entry<String, String> entry : params.entrySet()) {
            String key = entry.getKey();
            String value = entry.getValue();

            if (key == null || key.isBlank()) {
                throw new IllegalArgumentException(
                        "Search parameter names must not be blank"
                );
            }

            if (value == null) {
                throw new IllegalArgumentException(
                        "Search parameter values must not be null"
                );
            }

            String normalizedKey = normalize(key);
            String normalizedValue = normalize(value);

            if ("engine".equals(normalizedKey)) {
                throw new IllegalArgumentException(
                        "Engine must be supplied separately, not in params"
                );
            }

            if ("hl".equals(normalizedKey)
                    || "gl".equals(normalizedKey)) {
                normalizedValue =
                        normalizedValue.toLowerCase(Locale.ROOT);
            }

            if (normalizedParams.containsKey(normalizedKey)) {
                throw new IllegalArgumentException(
                        "Duplicate parameter after Unicode normalization: "
                                + normalizedKey
                );
            }

            normalizedParams.put(normalizedKey, normalizedValue);
        }

        // Capsule v1 identity includes engine at both levels.
        normalizedParams.put("engine", normalizedEngine);

        return Collections.unmodifiableMap(normalizedParams);
    }

    private String normalize(String value) {
        return Normalizer.normalize(
                value.strip(),
                Normalizer.Form.NFC
        );
    }

    private String toHex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);

        for (byte value : bytes) {
            result.append(
                    String.format("%02x", value & 0xff)
            );
        }

        return result.toString();
    }

    private record SearchIdentity(
            String engine,
            Map<String, String> params
    ) {
    }
}
