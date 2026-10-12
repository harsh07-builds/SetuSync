package in.setusync.relay.protocol;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class CapsuleIntegrityCompatibilityTest {

    private final ObjectMapper mapper = new ObjectMapper();

    private final CapsuleIntegrityService integrityService =
            new CapsuleIntegrityService(mapper);

    @Test
    void javaIntegrityMatchesCapsuleV1GoldenVector() throws Exception {
        Path vectorPath = Path.of(
                "..",
                "..",
                "packages",
                "protocol",
                "vectors",
                "capsule-v1.json"
        );

        assertNotNull(
                Files.exists(vectorPath) ? vectorPath : null,
                "Capsule v1 golden vector was not found: " + vectorPath
        );

        JsonNode vector = mapper.readTree(
                Files.readString(vectorPath)
        );

        JsonNode body = vector.path("capsule").path("body");

        assertNotNull(body, "Capsule body is required");
        assertEquals("serp", body.path("kind").asText());

        String expectedId = body.path("id").asText();
        String expectedChash = body.path("chash").asText();

        assertEquals(
                "sha256:cf1dc5096d2813fc0fd3bd96f1a95249acb77d3d4b29bdc0311fdf63c564314d",
                expectedId
        );

        assertEquals(
                "sha256:424350175f1e5aecbd23cde9beefe148015d2313997ca27d78de44f8806567e1",
                expectedChash
        );

        String actualChash = integrityService.computeChash(
                body.path("organic_results"),
                body.path("related_questions")
        );

        assertEquals(
                expectedChash,
                actualChash,
                "Java CHASH must match the TypeScript golden vector"
        );

        ObjectNode bodyWithoutId = ((ObjectNode) body).deepCopy();
        bodyWithoutId.remove("id");

        String actualId =
                integrityService.computeCapsuleId(bodyWithoutId);

        assertEquals(
                expectedId,
                actualId,
                "Java Capsule ID must match the TypeScript golden vector"
        );
    }
}