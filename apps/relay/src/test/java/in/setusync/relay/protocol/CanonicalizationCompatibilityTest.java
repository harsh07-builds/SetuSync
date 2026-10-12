package in.setusync.relay.protocol;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.erdtman.jcs.JsonCanonicalizer;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;

import static org.junit.jupiter.api.Assertions.assertEquals;

class CanonicalizationCompatibilityTest {

    @Test
    void javaMatchesTypeScriptCacheKeyVector() throws Exception {
        Path vectorPath = Path.of(
                "..",
                "..",
                "packages",
                "protocol",
                "vectors",
                "cache-key-v1.json"
        );

        JsonNode vector = new ObjectMapper()
                .readTree(Files.readString(vectorPath));

        String inputJson = vector.get("input").toString();

        String javaCanonical =
                new JsonCanonicalizer(inputJson).getEncodedString();

        String expectedCanonical =
                vector.get("canonical").asText();

        String javaHash = "sha256:" + sha256(javaCanonical);

        String expectedKey =
                vector.get("key").asText();

        assertEquals(expectedCanonical, javaCanonical);
        assertEquals(expectedKey, javaHash);
    }

    private static String sha256(String value) throws Exception {
        byte[] digest = MessageDigest
                .getInstance("SHA-256")
                .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));

        StringBuilder hex = new StringBuilder();

        for (byte b : digest) {
            hex.append(String.format("%02x", b));
        }

        return hex.toString();
    }
}