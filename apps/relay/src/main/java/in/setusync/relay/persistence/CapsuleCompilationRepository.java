package in.setusync.relay.persistence;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Repository
public class CapsuleCompilationRepository {

    private final JdbcTemplate jdbcTemplate;

    public CapsuleCompilationRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<CapsuleCompilationClaim> claimReady(
            int limit,
            int leaseSeconds
    ) {
        if (limit < 1) {
            throw new IllegalArgumentException("limit must be at least 1");
        }

        if (leaseSeconds < 1) {
            throw new IllegalArgumentException(
                    "leaseSeconds must be at least 1"
            );
        }

        UUID claimToken = UUID.randomUUID();

        String sql = """
                WITH candidates AS (
                    SELECT id
                    FROM search_job
                    WHERE state = 'RESULT_READY'
                      AND provider_result IS NOT NULL
                      AND request_payload IS NOT NULL
                      AND (
                          capsule_claimed_until IS NULL
                          OR capsule_claimed_until <= CURRENT_TIMESTAMP
                      )
                    ORDER BY updated_at ASC
                    LIMIT ?
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE search_job job
                SET capsule_claimed_until =
                        CURRENT_TIMESTAMP + (? * INTERVAL '1 second'),
                    capsule_claim_token = ?,
                    capsule_attempts = capsule_attempts + 1,
                    capsule_last_error = NULL,
                    updated_at = CURRENT_TIMESTAMP
                FROM candidates
                WHERE job.id = candidates.id
                RETURNING
                    job.id,
                    job.cache_key,
                    job.provider_search_id,
                    job.request_payload::text,
                    job.provider_result::text,
                    job.provider_result_received_at,
                    job.capsule_attempts,
                    job.capsule_claim_token
                """;

        return jdbcTemplate.query(
                sql,
                (rs, rowNum) -> {
                    Timestamp receivedAt =
                            rs.getTimestamp("provider_result_received_at");

                    return new CapsuleCompilationClaim(
                            rs.getObject("id", UUID.class),
                            rs.getString("cache_key"),
                            rs.getString("provider_search_id"),
                            rs.getString("request_payload"),
                            rs.getString("provider_result"),
                            receivedAt == null
                                    ? null
                                    : receivedAt.toInstant(),
                            rs.getInt("capsule_attempts"),
                            rs.getObject("capsule_claim_token", UUID.class)
                    );
                },
                limit,
                leaseSeconds,
                claimToken
        );
    }

    public boolean releaseClaim(
            UUID jobId,
            UUID claimToken,
            String errorMessage
    ) {
        if (jobId == null || claimToken == null) {
            throw new IllegalArgumentException(
                    "jobId and claimToken are required"
            );
        }

        String sql = """
                UPDATE search_job
                SET capsule_claimed_until = NULL,
                    capsule_claim_token = NULL,
                    capsule_last_error = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND state = 'RESULT_READY'
                  AND capsule_claim_token = ?
                """;

        return jdbcTemplate.update(
                sql,
                errorMessage,
                jobId,
                claimToken
        ) == 1;
    }

    public record CapsuleCompilationClaim(
            UUID jobId,
            String cacheKey,
            String providerSearchId,
            String requestPayloadJson,
            String providerResultJson,
            Instant providerResultReceivedAt,
            int attempt,
            UUID claimToken
    ) {
    }
}