package in.setusync.relay.api;

import in.setusync.relay.persistence.RequestTicketRepository;
import in.setusync.relay.persistence.RequestTicketRepository.RequestTicket;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.UUID;

@RestController
@RequestMapping("/v1/tickets")
public class TicketController {

    private static final String INSTALL_ID_ATTRIBUTE =
            "setusync.installId";

    public static final String INSTALL_ID_HEADER =
            "X-SetuSync-Install-Id";

    private final RequestTicketRepository ticketRepository;

    public TicketController(
            RequestTicketRepository ticketRepository
    ) {
        this.ticketRepository = ticketRepository;
    }

    /**
     * Returns the current state of a deferred search ticket.
     *
     * A ticket is scoped to the install that created it. The install
     * identity is therefore required both by the request filter and
     * by the repository lookup.
     */
    @GetMapping("/{id}")
    public TicketResponse getTicket(
            @PathVariable String id,
            HttpServletRequest httpRequest
    ) {
        UUID ticketId = parseTicketId(id);
        UUID installId = getInstallId(httpRequest);

        RequestTicket ticket = ticketRepository
                .findByIdAndInstallId(ticketId, installId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "Ticket not found"
                ));

        String reason = null;

        if ("FAILED".equals(ticket.state())) {
            reason = ticketRepository
                    .findFailureReason(ticket.id())
                    .orElse(null);
        }

        return new TicketResponse(
                ticket.id(),
                ticket.state(),
                ticket.createdAt(),
                reason
        );
    }

    private UUID getInstallId(HttpServletRequest request) {
        Object value = request.getAttribute(INSTALL_ID_ATTRIBUTE);

        if (value instanceof UUID installId) {
            return installId;
        }

        throw new ResponseStatusException(
                HttpStatus.BAD_REQUEST,
                "Valid install identity is required"
        );
    }

    private UUID parseTicketId(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Invalid ticket ID"
            );
        }
    }

    public record TicketResponse(
            UUID ticketId,
            String state,
            Instant createdAt,
            String reason
    ) {
    }
}