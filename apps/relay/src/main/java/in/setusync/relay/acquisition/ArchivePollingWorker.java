package in.setusync.relay.acquisition;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import in.setusync.relay.persistence.ArchivePollingRepository;
import in.setusync.relay.persistence.ArchivePollingRepository.ArchivePollClaim;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class ArchivePollingWorker {

    private static final Logger log =
            LoggerFactory.getLogger(ArchivePollingWorker.class);

    private final ArchivePollingRepository pollingRepository;
    private final SearchProvider searchProvider;
    private final ArchivePollingFailureService failureService;
    private final ObjectMapper objectMapper;
    private final int maxPollAttempts;

    public ArchivePollingWorker(
            ArchivePollingRepository pollingRepository,
            SearchProvider searchProvider,
            ArchivePollingFailureService failureService,
            ObjectMapper objectMapper,
            @Value("${setusync.acquisition.archive-poll-max-attempts:12}")
            int maxPollAttempts
    ) {
        if (maxPollAttempts < 1 || maxPollAttempts > 1000) {
            throw new IllegalArgumentException(
                    "Archive poll max attempts must be between 1 and 1000"
            );
        }

        this.pollingRepository = pollingRepository;
        this.searchProvider = searchProvider;
        this.failureService = failureService;
        this.objectMapper = objectMapper;
        this.maxPollAttempts = maxPollAttempts;
    }

    @Scheduled(
            fixedDelayString =
                    "${setusync.acquisition.archive-poll-interval-ms:5000}"
    )
    public void pollArchives() {
        var claims = pollingRepository.claimDue(10, 120);

        for (ArchivePollClaim claim : claims) {
            processClaim(claim);
        }
    }

    private void processClaim(ArchivePollClaim claim) {
        if (claim.pollAttempt() >= maxPollAttempts) {
            failExhaustedClaim(claim);
            return;
        }

        try {
            ProviderResult result =
                    searchProvider.getArchive(claim.providerSearchId());

            if (result == null) {
                throw new IllegalStateException(
                        "Provider returned a null archive result"
                );
            }

            if (!claim.providerSearchId().equals(result.providerSearchId())) {
                throw new IllegalStateException(
                        "Provider archive ID does not match the claimed job"
                );
            }

            if (result.rawJson() == null || result.rawJson().isBlank()) {
                throw new IllegalStateException(
                        "Provider returned an empty archive response"
                );
            }

            JsonNode response =
                    objectMapper.readTree(result.rawJson());

            if (isTerminalFailure(response)) {
                boolean failed = failureService.fail(
                        claim.jobId(),
                        claim.claimedUntil()
                );

                if (failed) {
                    log.warn(
                            "Provider reported terminal failure for job {}",
                            claim.jobId()
                    );
                } else {
                    log.debug(
                            "Terminal failure claim was no longer owned for job {}",
                            claim.jobId()
                    );
                }

                return;
            }

            if (result.ready()) {
                boolean markedReady = pollingRepository.markReady(
                        claim.jobId(),
                        claim.claimedUntil(),
                        result.rawJson()
                );

                if (!markedReady) {
                    log.debug(
                            "Archive result was ready but claim was no longer owned for job {}",
                            claim.jobId()
                    );
                }

                return;
            }

            scheduleRetry(claim);

        } catch (Exception exception) {
            log.warn(
                    "Archive polling failed for job {} on attempt {}",
                    claim.jobId(),
                    claim.pollAttempt(),
                    exception
            );

            if (claim.pollAttempt() >= maxPollAttempts) {
                failExhaustedClaim(claim);
            } else {
                scheduleRetry(claim);
            }
        }
    }

    private boolean isTerminalFailure(JsonNode response) {
        JsonNode metadata = response.path("search_metadata");

        String status = metadata
                .path("status")
                .asText("");

        if ("Error".equalsIgnoreCase(status)
                || "Failed".equalsIgnoreCase(status)) {
            return true;
        }

        JsonNode error = response.get("error");

        return error != null
                && !error.isNull()
                && !error.asText("").isBlank();
    }

    private void scheduleRetry(ArchivePollClaim claim) {
        int attempt = Math.max(1, claim.pollAttempt());

        int delay = (int) Math.min(
                300L,
                5L * (1L << Math.min(attempt - 1, 6))
        );

        try {
            boolean scheduled = pollingRepository.markNotReady(
                    claim.jobId(),
                    claim.claimedUntil(),
                    delay
            );

            if (!scheduled) {
                log.debug(
                        "Archive retry claim was no longer owned for job {}",
                        claim.jobId()
                );
            }

        } catch (Exception schedulingException) {
            log.error(
                    "Could not schedule archive retry for job {}",
                    claim.jobId(),
                    schedulingException
            );
        }
    }

    private void failExhaustedClaim(ArchivePollClaim claim) {
        try {
            boolean failed = failureService.fail(
                    claim.jobId(),
                    claim.claimedUntil()
            );

            if (failed) {
                log.warn(
                        "Archive polling exhausted after {} attempts for job {}",
                        claim.pollAttempt(),
                        claim.jobId()
                );
            } else {
                log.debug(
                        "Archive polling exhaustion claim was no longer owned for job {}",
                        claim.jobId()
                );
            }

        } catch (Exception failureException) {
            log.error(
                    "Could not mark exhausted archive job {} as FAILED",
                    claim.jobId(),
                    failureException
            );
        }
    }
}