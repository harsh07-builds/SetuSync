package in.setusync.relay.protocol;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.erdtman.jcs.JsonCanonicalizer;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

@Component
public class CapsuleIntegrityService {

    private final ObjectMapper objectMapper;

    public CapsuleIntegrityService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * Computes the Capsule v1 content hash.
     *
     * The projection contains exactly:
     * {
     *   "organic_results": [...],
     *   "related_questions": [...]
     * }
     */
    public String computeChash(
            JsonNode organicResults,
            JsonNode relatedQuestions
    ) {
        if (organicResults == null || !organicResults.isArray()) {
            throw new IllegalArgumentException(
                    "organic_results must be a JSON array"
            );
        }

        if (relatedQuestions == null || !relatedQuestions.isArray()) {
            throw new IllegalArgumentException(
                    "related_questions must be a JSON array"
            );
        }

        ObjectNode projection = objectMapper.createObjectNode();
        projection.set("organic_results", organicResults);
        projection.set("related_questions", relatedQuestions);

        return sha256Canonical(projection);
    }

    /**
     * Computes the Capsule v1 ID from the complete body without its id.
     */
    public String computeCapsuleId(ObjectNode bodyWithoutId) {
        if (bodyWithoutId == null) {
            throw new IllegalArgumentException(
                    "Capsule body must not be null"
            );
        }

        if (bodyWithoutId.has("id")) {
            throw new IllegalArgumentException(
                    "Capsule ID input must not contain the id field"
            );
        }

        return sha256Canonical(bodyWithoutId);
    }

    /**
     * Returns RFC 8785-style canonical JSON for signing.
     */
    public String canonicalize(JsonNode value) {
        if (value == null) {
            throw new IllegalArgumentException(
                    "JSON value must not be null"
            );
        }

        try {
            String json = objectMapper.writeValueAsString(value);
            return new JsonCanonicalizer(json).getEncodedString();

        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(
                    "Could not serialize JSON for canonicalization",
                    exception
            );
        } catch (Exception exception) {
            throw new IllegalStateException(
                    "Could not canonicalize JSON",
                    exception
            );
        }
    }

    private String sha256Canonical(JsonNode value) {
        String canonicalJson = canonicalize(value);

        try {
            byte[] digest = MessageDigest
                    .getInstance("SHA-256")
                    .digest(canonicalJson.getBytes(StandardCharsets.UTF_8));

            return toHex(digest);

        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(
                    "SHA-256 is not available",
                    exception
            );
        }
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
}
