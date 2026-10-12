
package in.setusync.relay.protocol;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class CapsuleCacheKeyCompatibilityTest {

    @Test
    void javaCacheKeyMatchesCapsuleV1GoldenVector() throws Exception {
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

        ObjectMapper mapper = new ObjectMapper();

        JsonNode vector = mapper.readTree(
                Files.readString(vectorPath)
        );

        JsonNode body = vector.path("capsule").path("body");

        String expectedKey = body.path("key").asText();

        Map<String, String> expectedParams = mapper.convertValue(
                body.path("params"),
                new TypeReference<TreeMap<String, String>>() {}
        );

        Map<String, String> inputParams = new TreeMap<>(expectedParams);

        String engine = inputParams.remove("engine");

        assertNotNull(engine, "Golden vector params must contain engine");

        SearchCacheKeyService service =
                new SearchCacheKeyService(mapper);

        String actualKey = service.generate(engine, inputParams);

        assertEquals(
                expectedKey,
                actualKey,
                "Java cache key must match the Capsule v1 golden vector"
        );

        Map<String, String> actualParams =
                service.normalizeParams(engine, inputParams);

        assertEquals(
                expectedParams,
                actualParams,
                "Capsule params must equal the normalized cache identity"
        );
    }
}
