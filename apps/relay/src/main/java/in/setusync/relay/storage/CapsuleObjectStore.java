package in.setusync.relay.storage;

import com.fasterxml.jackson.databind.JsonNode;

public interface CapsuleObjectStore {

    String store(String capsuleId, JsonNode capsule);

    JsonNode read(String objectKey);
}