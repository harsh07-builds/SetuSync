
package in.setusync.relay.acquisition;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import in.setusync.relay.domain.SearchRequest;
import in.setusync.relay.persistence.InstallRepository;
import in.setusync.relay.persistence.OutboxRepository;
import in.setusync.relay.persistence.RequestTicketRepository;
import in.setusync.relay.persistence.RequestTicketRepository.RequestTicket;
import in.setusync.relay.persistence.SearchJobRepository;
import in.setusync.relay.persistence.SearchJobRepository.SearchJob;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class AcquisitionRequestService {

    private final InstallRepository installRepository;
    private final RequestTicketRepository ticketRepository;
    private final SearchJobRepository jobRepository;
    private final OutboxRepository outboxRepository;
    private final ObjectMapper objectMapper;

    public AcquisitionRequestService(
            InstallRepository installRepository,
            RequestTicketRepository ticketRepository,
            SearchJobRepository jobRepository,
            OutboxRepository outboxRepository,
            ObjectMapper objectMapper
    ) {
        this.installRepository = installRepository;
        this.ticketRepository = ticketRepository;
        this.jobRepository = jobRepository;
        this.outboxRepository = outboxRepository;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public AcquisitionRequest request(
            UUID installId,
            String idempotencyKey,
            String cacheKey,
            SearchRequest searchRequest
    ) {
        if (installId == null) {
            throw new IllegalArgumentException(
                    "Install ID must not be null"
            );
        }

        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new IllegalArgumentException(
                    "Idempotency key must not be blank"
            );
        }

        if (cacheKey == null || cacheKey.isBlank()) {
            throw new IllegalArgumentException(
                    "Cache key must not be blank"
            );
        }

        if (searchRequest == null) {
            throw new IllegalArgumentException(
                    "Search request must not be null"
            );
        }

        installRepository.registerOrTouch(installId);

        RequestTicket ticket = ticketRepository.createOrGet(
                installId,
                idempotencyKey,
                cacheKey
        );

        SearchJob job = jobRepository.createOrGetActive(
                ticket.cacheKey(),
                searchRequest
        );

        UUID associatedJobId = ticketRepository.associateSearchJob(
                ticket.id(),
                job.id()
        );

        if (!job.id().equals(associatedJobId)) {
            throw new IllegalStateException(
                    "Request ticket is already associated with a different acquisition job"
            );
        }

        UUID eventId = null;

        if ("QUEUED".equals(job.state())
                && jobRepository.markAcquisitionEventCreated(job.id())) {

            eventId = appendAcquisitionEvent(
                    job.id(),
                    ticket.id(),
                    job.cacheKey()
            );
        }

        return new AcquisitionRequest(
                ticket.id(),
                job.id(),
                job.state(),
                eventId
        );
    }

    private UUID appendAcquisitionEvent(
            UUID jobId,
            UUID ticketId,
            String cacheKey
    ) {
        AcquisitionEvent event = new AcquisitionEvent(
                jobId,
                ticketId,
                cacheKey
        );

        try {
            String payload = objectMapper.writeValueAsString(event);

            return outboxRepository.append(
                    "SearchJob",
                    jobId.toString(),
                    "AcquisitionRequested",
                    payload
            );

        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(
                    "Could not serialize acquisition event",
                    exception
            );
        }
    }

    public record AcquisitionRequest(
            UUID ticketId,
            UUID jobId,
            String state,
            UUID eventId
    ) {
    }

    public record AcquisitionEvent(
            UUID jobId,
            UUID ticketId,
            String cacheKey
    ) {
    }
}
