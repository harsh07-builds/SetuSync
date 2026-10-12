package in.setusync.relay.acquisition;

import in.setusync.relay.persistence.SearchJobRepository;
import in.setusync.relay.persistence.GovernorRepository;
import in.setusync.relay.persistence.RequestTicketRepository;
import in.setusync.relay.persistence.SearchJobRepository.SubmissionRecoveryJob;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class SubmissionRecoveryWorker {

    private static final Logger log =
            LoggerFactory.getLogger(SubmissionRecoveryWorker.class);

    private final SearchJobRepository searchJobRepository;
    private final GovernorRepository governorRepository;
    private final RequestTicketRepository requestTicketRepository;
    private final int batchSize;
    private final long staleAfterSeconds;

    public SubmissionRecoveryWorker(
            SearchJobRepository searchJobRepository,
            GovernorRepository governorRepository,
            RequestTicketRepository requestTicketRepository,
            @Value("${setusync.acquisition.submission-recovery-batch-size:25}")
            int batchSize,
            @Value("${setusync.acquisition.submission-recovery-stale-after-seconds:120}")
            long staleAfterSeconds
    ) {
        if (batchSize < 1 || batchSize > 500) {
            throw new IllegalArgumentException(
                    "Submission recovery batch size must be between 1 and 500"
            );
        }

        if (staleAfterSeconds < 1 || staleAfterSeconds > 86400) {
            throw new IllegalArgumentException(
                    "Submission recovery stale threshold must be between 1 and 86400 seconds"
            );
        }

        this.searchJobRepository = searchJobRepository;
        this.governorRepository = governorRepository;
        this.requestTicketRepository = requestTicketRepository;
        this.batchSize = batchSize;
        this.staleAfterSeconds = staleAfterSeconds;
    }

    @Scheduled(
            fixedDelayString =
                    "${setusync.acquisition.submission-recovery-interval-ms:30000}"
    )
    public void recoverStaleSubmissions() {
        List<SubmissionRecoveryJob> jobs;

        try {
            jobs = searchJobRepository.findStaleSubmitting(
                    batchSize,
                    staleAfterSeconds
            );
        } catch (Exception exception) {
            log.error(
                    "Could not find stale submitting jobs",
                    exception
            );
            return;
        }

        for (SubmissionRecoveryJob job : jobs) {
            recoverOne(job);
        }
    }

    private void recoverOne(SubmissionRecoveryJob job) {
        if (job.providerSearchId() != null
                && !job.providerSearchId().isBlank()) {

            try {
                boolean recovered =
                        searchJobRepository
                                .recoverSubmittingWithProviderId(
                                        job.jobId()
                                );

                if (recovered) {
                    log.info(
                            "Recovered stale SUBMITTING job {} using persisted provider search ID {}",
                            job.jobId(),
                            job.providerSearchId()
                    );
                } else {
                    log.debug(
                            "Stale SUBMITTING job {} was no longer eligible for recovery",
                            job.jobId()
                    );
                }

            } catch (Exception exception) {
                log.error(
                        "Could not recover stale SUBMITTING job {}",
                        job.jobId(),
                        exception
                );
            }

            return;
        }

        /*
         * No provider search ID means the provider outcome is ambiguous.
         *
         * We do not resubmit automatically because the provider may have
         * accepted the request before the process crashed. After the stale
         * threshold, fail this local job, release its governor reservation,
         * and let a future request create a fresh acquisition.
         */
        try {
            boolean failed =
                    searchJobRepository.markSubmissionFailed(job.jobId());

            if (failed) {
                var installId =
                        requestTicketRepository
                                .findInstallIdForSearchJob(job.jobId())
                                .orElseThrow(() ->
                                        new IllegalStateException(
                                                "No install ID found for search job "
                                                        + job.jobId()
                                        )
                                );

                governorRepository.settle(
                        job.jobId(),
                        installId,
                        0
                );

                requestTicketRepository.failTicketsForSearchJob(
                        job.jobId(),
                        "The search provider did not confirm the request "
                                + "in time. Please try again."
                );

                log.warn(
                        "Marked stale ambiguous SUBMITTING job {} as FAILED; "
                                + "released governor reservation and failed its ticket",
                        job.jobId()
                );
            } else {
                log.debug(
                        "Stale SUBMITTING job {} was no longer eligible for failure recovery",
                        job.jobId()
                );
            }
        } catch (Exception exception) {
            log.error(
                    "Could not fail stale ambiguous SUBMITTING job {}",
                    job.jobId(),
                    exception
            );
        }
    }
}
