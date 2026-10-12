package in.setusync.relay.acquisition;

import in.setusync.relay.persistence.RequestTicketRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.UUID;

@Service
public class CapsuleCompletionService {

    private final JdbcTemplate jdbcTemplate;
    private final RequestTicketRepository ticketRepository;

    public CapsuleCompletionService(
            JdbcTemplate jdbcTemplate,
            RequestTicketRepository ticketRepository
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.ticketRepository = ticketRepository;
    }

    @Transactional
    public void complete(UUID jobId, UUID claimToken) {
        Objects.requireNonNull(jobId, "jobId must not be null");
        Objects.requireNonNull(claimToken, "claimToken must not be null");

        int updated = jdbcTemplate.update("""
                UPDATE search_job
                SET state = 'COMPLETED',
                    capsule_claimed_until = NULL,
                    capsule_claim_token = NULL,
                    capsule_last_error = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND state = 'RESULT_READY'
                  AND capsule_claim_token = ?
                """,
                jobId,
                claimToken
        );

        if (updated != 1) {
            throw new IllegalStateException(
                    "Capsule completion rejected: job is no longer owned by this claim"
            );
        }

        ticketRepository.updateStateForSearchJob(jobId, "READY");
    }
}