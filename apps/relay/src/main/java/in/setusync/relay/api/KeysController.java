package in.setusync.relay.api;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import in.setusync.relay.persistence.KeysetRepository;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.concurrent.TimeUnit;

/**
 * Publishes the public half of the capsule-signing keys.
 *
 * Devices store these once and can then verify capsules completely
 * offline, including capsules that reached them through a friend's
 * pack, a QR transfer or WhatsApp. Public keys are not secret.
 */
@RestController
@RequestMapping("/v1/keys")
public class KeysController {

    private final KeysetRepository keysetRepository;
    private final JsonResponses jsonResponses;

    public KeysController(
            KeysetRepository keysetRepository,
            JsonResponses jsonResponses
    ) {
        this.keysetRepository = keysetRepository;
        this.jsonResponses = jsonResponses;
    }

    @GetMapping
    public ResponseEntity<String> keys() {
        ObjectNode root = jsonResponses.object();
        ArrayNode keys = root.putArray("keys");

        for (KeysetRepository.SigningPublicKey key
                : keysetRepository.findPublishable()) {
            ObjectNode item = keys.addObject();
            item.put("kid", key.kid());
            item.put("alg", key.algorithm());
            item.put("publicKeySpkiB64", key.publicKeySpkiB64());
            item.put("status", key.status());
        }

        return ResponseEntity.ok()
                .cacheControl(
                        CacheControl.maxAge(5, TimeUnit.MINUTES)
                                .cachePublic()
                )
                .contentType(MediaType.APPLICATION_JSON)
                .body(root.toString());
    }
}
