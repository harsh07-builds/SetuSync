package in.setusync.relay.persistence;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Repository
public class ArchivePollingRepository {

    private final JdbcTemplate jdbcTemplate;

    public ArchivePollingRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional
    public List<ArchivePollClaim> claimDue(int limit, int leaseSeconds) {
        if (limit < 1 || limit > 500) {
            throw new IllegalArgumentException(
                    "Archive poll limit must be between 1 and 500"
            );
        }

        if (leaseSeconds < 1 || leaseSeconds > 3600) {
            throw new IllegalArgumentException(
                    "Archive poll lease must be between 1 and 3600 seconds"
            );
        }

        String sql = """
                WITH candidates AS (
                    SELECT id
                    FROM search_job
                    WHERE state IN ('SUBMITTED', 'PROCESSING')
                      AND provider_search_id IS NOT NULL
                      AND (
                          next_poll_at IS NULL
                          OR next_poll_at <= CURRENT_TIMESTAMP
                      )
                      AND (
                          poll_claimed_until IS NULL
                          OR poll_claimed_until <= CURRENT_TIMESTAMP
                      )
                    ORDER BY
                        COALESCE(next_poll_at, updated_at),
                        updated_at
                    LIMIT ?
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE search_job AS job
                SET
                    poll_claimed_until =
                        CURRENT_TIMESTAMP + (? * INTERVAL '1 second'),
                    poll_attempts = poll_attempts + 1,
                    updated_at = CURRENT_TIMESTAMP
                FROM candidates
                WHERE job.id = candidates.id
                RETURNING
                    job.id,
                    job.provider_search_id,
                    job.poll_claimed_until,
                    job.poll_attempts
                """;

        return jdbcTemplate.query(
                sql,
                (rs, rowNum) -> new ArchivePollClaim(
                        rs.getObject("id", UUID.class),
                        rs.getString("provider_search_id"),
                        rs.getTimestamp("poll_claimed_until").toInstant(),
                        rs.getInt("poll_attempts")
                ),
                limit,
                leaseSeconds
        );
    }

    public boolean markNotReady(
            UUID jobId,
            Instant claimedUntil,
            int delaySeconds
    ) {
        if (delaySeconds < 1 || delaySeconds > 3600) {
            throw new IllegalArgumentException(
                    "Next poll delay must be between 1 and 3600 seconds"
            );
        }

        String sql = """
                UPDATE search_job
                SET
                    poll_claimed_until = NULL,
                    next_poll_at =
                        CURRENT_TIMESTAMP + (? * INTERVAL '1 second'),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND state IN ('SUBMITTED', 'PROCESSING')
                  AND poll_claimed_until = ?
                """;

        return jdbcTemplate.update(
                sql,
                delaySeconds,
                jobId,
                Timestamp.from(claimedUntil)
        ) == 1;
    }

    public boolean markReady(
            UUID jobId,
            Instant claimedUntil,
            String providerResultJson
    ) {
        if (providerResultJson == null || providerResultJson.isBlank()) {
            throw new IllegalArgumentException(
                    "Provider result JSON must not be blank"
            );
        }

        String sql = """
                UPDATE search_job
                SET
                    state = 'RESULT_READY',
                    provider_result = ?::jsonb,
                    provider_result_received_at = CURRENT_TIMESTAMP,
                    poll_claimed_until = NULL,
                    next_poll_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND state IN ('SUBMITTED', 'PROCESSING')
                  AND poll_claimed_until = ?
                """;

        return jdbcTemplate.update(
                sql,
                providerResultJson,
                jobId,
                Timestamp.from(claimedUntil)
        ) == 1;
    }

    public record ArchivePollClaim(
            UUID jobId,
            String providerSearchId,
            Instant claimedUntil,
            int pollAttempt
    ) {}
}