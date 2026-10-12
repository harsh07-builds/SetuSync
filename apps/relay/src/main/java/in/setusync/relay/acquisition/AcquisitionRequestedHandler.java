package in.setusync.relay.acquisition;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import in.setusync.relay.domain.SearchRequest;
import in.setusync.relay.persistence.OutboxRepository.OutboxEvent;
import in.setusync.relay.persistence.RequestTicketRepository;
import in.setusync.relay.persistence.RequestTicketRepository.RequestTicket;
import in.setusync.relay.persistence.SearchJobRepository;
import in.setusync.relay.persistence.SearchJobRepository.SearchJob;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.UUID;

@Component
public class AcquisitionRequestedHandler
        implements OutboxEventHandler {

    private final ObjectMapper objectMapper;
    private final SearchJobRepository searchJobRepository;
    private final RequestTicketRepository ticketRepository;
    private final SearchProvider searchProvider;
    private final CreditGovernorService governor;

    public AcquisitionRequestedHandler(
            ObjectMapper objectMapper,
            SearchJobRepository searchJobRepository,
            RequestTicketRepository ticketRepository,
            SearchProvider searchProvider,
            CreditGovernorService governor
    ) {
        this.objectMapper = objectMapper;
        this.searchJobRepository =
                searchJobRepository;
        this.ticketRepository =
                ticketRepository;
        this.searchProvider =
                searchProvider;
        this.governor =
                governor;
    }

    @Override
    public String eventType() {
        return "AcquisitionRequested";
    }

    @Override
    public void handle(OutboxEvent event) {
        AcquisitionEvent acquisitionEvent =
                parseEvent(
                        event.payloadJson()
                );

        SearchJob currentJob =
                searchJobRepository
                        .findById(
                                acquisitionEvent.jobId()
                        )
                        .orElseThrow(
                                () ->
                                        new IllegalStateException(
                                                "Acquisition job does not exist: "
                                                        + acquisitionEvent.jobId()
                                        )
                        );

        if (
                currentJob.providerSearchId() != null
                        && !currentJob.providerSearchId().isBlank()
        ) {
            return;
        }

        if ("SUBMITTING".equals(
                currentJob.state()
        )) {
            throw new IllegalStateException(
                    "Acquisition submission outcome is ambiguous for job "
                            + currentJob.id()
                            + "; automatic resubmission is blocked"
            );
        }

        if (!"QUEUED".equals(
                currentJob.state()
        )) {
            return;
        }

        RequestTicket ticket =
                ticketRepository
                        .findById(
                                acquisitionEvent.ticketId()
                        )
                        .orElseThrow(
                                () ->
                                        new IllegalStateException(
                                                "Request ticket does not exist: "
                                                        + acquisitionEvent.ticketId()
                                        )
                        );

        if (ticket.installId() == null) {
            throw new IllegalStateException(
                    "Request ticket has no installation: "
                            + ticket.id()
            );
        }

        if (
                !acquisitionEvent.jobId()
                        .equals(
                                ticket.searchJobId()
                        )
        ) {
            throw new IllegalStateException(
                    "Request ticket is associated with a different acquisition job"
            );
        }

        SearchRequest request =
                parseSearchRequest(
                        requireRequestPayload(
                                currentJob
                        )
                );

        try {
            searchProvider.preflight();
        } catch (IllegalStateException exception) {
            failQueuedJob(
                    currentJob.id(),
                    exception.getMessage()
            );
            return;
        }

        CreditGovernorService.GovernorDecision
                decision =
                governor.approve(
                        currentJob.id(),
                        ticket.installId(),
                        request.engine()
                );

        if (!decision.approved()) {
            /*
             * A refusal is final for this request. Retrying every 30
             * seconds would only leave the client polling a PROCESSING
             * ticket until it times out, so fail the job and tell the
             * client why.
             */
            failQueuedJob(
                    currentJob.id(),
                    describeDenial(decision.reason())
            );
            return;
        }

        SearchJob claimedJob =
                searchJobRepository
                        .claimForSubmission(
                                currentJob.id()
                        )
                        .orElseThrow(
                                () ->
                                        new IllegalStateException(
                                                "Could not claim queued acquisition job "
                                                        + currentJob.id()
                                        )
                        );

        try {
            ProviderSubmission submission =
                    searchProvider.submit(
                            request
                    );

            /*
             * SerpApi's immediate Cached response is free. A non-cached
             * accepted search is reserved as one provider credit.
             */
            int actualCredits =
                    submission.completed()
                            ? 0
                            : 1;

            governor.settle(
                    claimedJob.id(),
                    ticket.installId(),
                    actualCredits
            );

            boolean persisted =
                    searchJobRepository.markSubmitted(
                            claimedJob.id(),
                            submission.providerSearchId(),
                            submission.completed()
                    );

            if (!persisted) {
                throw new IllegalStateException(
                        "Provider accepted the request, but its search ID "
                                + "could not be persisted for job "
                                + claimedJob.id()
                );
            }

        } catch (RuntimeException exception) {
            System.err.println("=== SERPAPI SUBMISSION FAILURE ===");
            exception.printStackTrace(System.err);
            System.err.println("=== END SERPAPI SUBMISSION FAILURE ===");

            /*
             * The provider outcome is ambiguous if submit() failed after
             * the request may have reached SerpApi. Do not release the
             * reservation here; SubmissionRecoveryWorker owns that state.
             */
            throw exception;
        }
    }

    private void failQueuedJob(UUID jobId, String reason) {
        searchJobRepository.markQueuedFailed(jobId);
        ticketRepository.failTicketsForSearchJob(jobId, reason);
    }

    private String describeDenial(String reason) {
        if (reason == null) {
            return "The relay declined to run this search.";
        }

        return switch (reason) {
            case "BUDGET_NOT_CONFIGURED" ->
                    "The relay has no provider-credit budget configured "
                            + "(set SETUSYNC_GOVERNOR_MONTHLY_CREDIT_BUDGET).";
            case "INSTALL_QUOTA_NOT_CONFIGURED" ->
                    "The relay has no per-install quota configured "
                            + "(set SETUSYNC_GOVERNOR_PER_INSTALL_CREDIT_QUOTA).";
            case "BUDGET_EXHAUSTED" ->
                    "The relay's monthly provider-credit budget is used up.";
            case "INSTALL_QUOTA" ->
                    "This device has used its live-search quota. "
                            + "Cached results are still available.";
            case "GLOBAL_KILL_SWITCH" ->
                    "Live searching is temporarily disabled by the "
                            + "relay operator.";
            case "DOMAIN_BLOCKED" ->
                    "This search engine is blocked by the relay operator.";
            default ->
                    "The relay declined to run this search ("
                            + reason + ").";
        };
    }

    private String requireRequestPayload(
            SearchJob job
    ) {
        if (
                job.requestPayload() == null
                        || job.requestPayload().isBlank()
        ) {
            throw new IllegalStateException(
                    "Acquisition job has no persisted request payload: "
                            + job.id()
            );
        }

        return job.requestPayload();
    }

    private AcquisitionEvent parseEvent(
            String payloadJson
    ) {
        try {
            return objectMapper.readValue(
                    payloadJson,
                    AcquisitionEvent.class
            );
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException(
                    "Invalid AcquisitionRequested event payload",
                    exception
            );
        }
    }

    private SearchRequest parseSearchRequest(
            String requestPayload
    ) {
        try {
            return objectMapper.readValue(
                    requestPayload,
                    SearchRequest.class
            );
        } catch (IOException exception) {
            throw new IllegalStateException(
                    "Could not deserialize persisted search request",
                    exception
            );
        }
    }

    public record AcquisitionEvent(
            UUID jobId,
            UUID ticketId,
            String cacheKey
    ) {
    }

    public static class GovernorDeferredException
            extends RuntimeException {

        public GovernorDeferredException(
                UUID jobId,
                String reason
        ) {
            super(
                    "Acquisition deferred by governor for job "
                            + jobId
                            + ": "
                            + reason
            );
        }
    }
}