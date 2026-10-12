package in.setusync.relay.storage;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

@Service
@ConditionalOnProperty(
        prefix = "setusync.object-store",
        name = "provider"
)
public class CapsuleObjectStoreReader {

    private final CapsuleObjectStore objectStore;

    public CapsuleObjectStoreReader(
            CapsuleObjectStore objectStore
    ) {
        this.objectStore = objectStore;
    }

    public JsonNode read(String objectKey) {
        return objectStore.read(objectKey);
    }
}