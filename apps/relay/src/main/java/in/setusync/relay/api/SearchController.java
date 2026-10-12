package in.setusync.relay.api;

import com.fasterxml.jackson.databind.node.ObjectNode;
import in.setusync.relay.acquisition.AcquisitionRequestService;
import in.setusync.relay.domain.SearchRequest;
import in.setusync.relay.protocol.SearchCacheKeyService;
import in.setusync.relay.storage.CapsuleRetrievalService;
import in.setusync.relay.storage.CapsuleRetrievalService.RetrievedCapsule;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@RestController
@RequestMapping("/v1")
public class SearchController {

    private static final String INSTALL_ID_ATTRIBUTE =
            "setusync.installId";

    private final AcquisitionRequestService acquisitionRequestService;
    private final SearchCacheKeyService searchCacheKeyService;
    private final Optional<CapsuleRetrievalService> capsuleRetrievalService;
    private final JsonResponses jsonResponses;

    public SearchController(
            AcquisitionRequestService acquisitionRequestService,
            SearchCacheKeyService searchCacheKeyService,
            Optional<CapsuleRetrievalService> capsuleRetrievalService,
            JsonResponses jsonResponses
    ) {
        this.jsonResponses = jsonResponses;
        this.acquisitionRequestService =
                acquisitionRequestService;
        this.searchCacheKeyService =
                searchCacheKeyService;
        this.capsuleRetrievalService =
                capsuleRetrievalService;
    }

    @PostMapping("/search")
    public ResponseEntity<?> search(
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @RequestBody SearchRequest request,
            HttpServletRequest httpRequest
    ) {
        UUID installId = getInstallId(httpRequest);

        validateRequest(request, idempotencyKey);

        String cacheKey = searchCacheKeyService.generate(
                request.engine(),
                request.params()
        );

        if (capsuleRetrievalService.isPresent()) {
            RetrievedCapsule cached =
                    capsuleRetrievalService
                            .get()
                            .getByCacheKey(cacheKey);

            if (cached != null) {
                ObjectNode body = jsonResponses.object();
                body.put("state", "READY");
                body.put("key", cached.cacheKey());
                body.set("capsule", cached.capsule());

                return jsonResponses.json(HttpStatus.OK, body);
            }
        }

        AcquisitionRequestService.AcquisitionRequest result =
                acquisitionRequestService.request(
                        installId,
                        idempotencyKey,
                        cacheKey,
                        request
                );

        ObjectNode accepted = jsonResponses.object();
        accepted.put("ticketId", result.ticketId().toString());
        accepted.put("state", result.state());

        return jsonResponses.json(HttpStatus.ACCEPTED, accepted);
    }

    private UUID getInstallId(HttpServletRequest request) {
        Object value =
                request.getAttribute(INSTALL_ID_ATTRIBUTE);

        if (!(value instanceof UUID installId)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Valid install identity is required"
            );
        }

        return installId;
    }

    private void validateRequest(
            SearchRequest request,
            String idempotencyKey
    ) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Idempotency-Key header is required"
            );
        }

        if (request == null) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Search request body is required"
            );
        }

        if (request.engine() == null || request.engine().isBlank()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Search engine is required"
            );
        }

        if (request.params() == null || request.params().isEmpty()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Search parameters are required"
            );
        }

        for (Map.Entry<String, String> entry
                : request.params().entrySet()) {

            if (entry.getKey() == null
                    || entry.getKey().isBlank()
                    || entry.getValue() == null) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "Search parameter names and values must be valid"
                );
            }
        }

        if (request.params().containsKey("engine")) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "engine must be supplied separately"
            );
        }

        if (request.maxAgeS() < 0) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "max_age_s cannot be negative"
            );
        }

        if (request.waitMs() < 0) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "wait_ms cannot be negative"
            );
        }

        if (request.accept() == null) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "accept configuration is required"
            );
        }
    }

    public record SearchResponse(
            UUID ticketId,
            String state
    ) {
    }

}