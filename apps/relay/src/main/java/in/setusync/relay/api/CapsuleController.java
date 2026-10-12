package in.setusync.relay.api;

import in.setusync.relay.protocol.CapsuleRetrievalService;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/v1/capsules")
public class CapsuleController {

    private static final MediaType JSON_UTF8 =
            new MediaType(
                    "application",
                    "json",
                    StandardCharsets.UTF_8
            );

    private final Optional<CapsuleRetrievalService> capsuleRetrievalService;

    public CapsuleController(
            Optional<CapsuleRetrievalService> capsuleRetrievalService
    ) {
        this.capsuleRetrievalService = capsuleRetrievalService;
    }

    @GetMapping("/{id}")
    public ResponseEntity<String> getCapsule(
            @PathVariable String id
    ) {
        if (id == null || id.isBlank()) {
            return ResponseEntity.badRequest().build();
        }

        if (capsuleRetrievalService.isEmpty()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .build();
        }

        Optional<CapsuleRetrievalService.RetrievedCapsule> capsule =
                capsuleRetrievalService
                        .get()
                        .getByCapsuleId(id);

        if (capsule.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        // The document is a Jackson 2 tree; render it ourselves so the
        // Jackson 3 HTTP converter never sees it (see JsonResponses).
        return ResponseEntity.ok()
                .cacheControl(
                        CacheControl.maxAge(365, TimeUnit.DAYS)
                                .cachePublic()
                                .immutable()
                )
                .contentType(JSON_UTF8)
                .body(capsule.get().document().toString());
    }
}
