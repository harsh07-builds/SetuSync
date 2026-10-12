package in.setusync.relay.acquisition;

import in.setusync.relay.persistence.RequestTicketRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.UUID;

@Service
public class ArchivePollingFailureService {

    private final JdbcTemplate jdbcTemplate;
    private final RequestTicketRepository ticketRepository;

    public ArchivePollingFailureService(
            JdbcTemplate jdbcTemplate,
            RequestTicketRepository ticketRepository
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.ticketRepository = ticketRepository;
    }

    @Transactional
    public boolean fail(UUID jobId, java.time.Instant claimedUntil) {
        Objects.requireNonNull(jobId, "jobId must not be null");
        Objects.requireNonNull(claimedUntil, "claimedUntil must not be null");

        int updated = jdbcTemplate.update("""
                UPDATE search_job
                SET state = 'FAILED',
                    poll_claimed_until = NULL,
                    next_poll_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND state IN ('SUBMITTED', 'PROCESSING')
                  AND poll_claimed_until = ?
                """,
                jobId,
                claimedUntil
        );

        if (updated != 1) {
            return false;
        }

        ticketRepository.failTicketsForSearchJob(
                jobId,
                "The search provider could not complete this search."
        );
        return true;
    }
}