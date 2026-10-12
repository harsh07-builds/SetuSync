package in.setusync.relay.api;

import in.setusync.relay.sync.SyncRequest;
import in.setusync.relay.sync.SyncResponse;
import in.setusync.relay.sync.SyncService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/v1/sync")
public class SyncController {

    private static final String INSTALL_ID_ATTRIBUTE =
            "setusync.installId";

    private final SyncRequestValidator validator;
    private final SyncService syncService;
    private final JsonResponses jsonResponses;

    public SyncController(
            SyncRequestValidator validator,
            SyncService syncService,
            JsonResponses jsonResponses
    ) {
        this.validator = validator;
        this.syncService = syncService;
        this.jsonResponses = jsonResponses;
    }

    @PostMapping
    public ResponseEntity<String> sync(
            @RequestBody SyncRequest request,
            HttpServletRequest httpRequest
    ) {
        UUID authenticatedInstallId =
                getInstallId(httpRequest);

        validator.validate(
                request,
                authenticatedInstallId
        );

        SyncResponse response = syncService.synchronize(
                authenticatedInstallId,
                request
        );

        return jsonResponses.json(jsonResponses.syncBody(response));
    }

    private UUID getInstallId(HttpServletRequest request) {
        Object value =
                request.getAttribute(INSTALL_ID_ATTRIBUTE);

        if (value instanceof UUID installId) {
            return installId;
        }

        throw new IllegalStateException(
                "Install identity was not established by the request filter"
        );
    }
}