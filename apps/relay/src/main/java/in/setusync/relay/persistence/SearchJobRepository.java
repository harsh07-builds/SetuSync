package in.setusync.relay.persistence;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import in.setusync.relay.domain.SearchRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class SearchJobRepository {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public SearchJobRepository(
            JdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    public SearchJob createOrGetActive(String cacheKey) {
        return createOrGetActive(cacheKey, null);
    }

    public SearchJob createOrGetActive(
            String cacheKey,
            SearchRequest request
    ) {
        if (cacheKey == null || cacheKey.isBlank()) {
            throw new IllegalArgumentException(
                    "Cache key must not be blank"
            );
        }

        String requestPayload = serializeRequest(request);
        UUID proposedId = UUID.randomUUID();

        String sql = """
                INSERT INTO search_job (
                    id,
                    cache_key,
                    request_payload,
                    state,
                    attempts,
                    credits,
                    created_at,
                    updated_at
                )
                VALUES (
                    ?,
                    ?,
                    ?::jsonb,
                    'QUEUED',
                    0,
                    0,
                    CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP
                )
                ON CONFLICT (cache_key)
                WHERE state IN (
                    'QUEUED',
                    'SUBMITTING',
                    'SUBMITTED',
                    'PROCESSING',
                    'RESULT_READY'
                )
                DO UPDATE SET
                    request_payload = COALESCE(
                        search_job.request_payload,
                        EXCLUDED.request_payload
                    ),
                    updated_at = CURRENT_TIMESTAMP
                RETURNING
                    id,
                    cache_key,
                    request_payload::text AS request_payload,
                    provider_search_id,
                    state,
                    attempts,
                    credits,
                    created_at,
                    updated_at
                """;

        return jdbcTemplate.queryForObject(
                sql,
                this::mapRow,
                proposedId,
                cacheKey,
                requestPayload
        );
    }

    @Transactional
    public boolean markAcquisitionEventCreated(UUID jobId) {
        if (jobId == null) {
            throw new IllegalArgumentException(
                    "Job ID must not be null"
            );
        }

        String sql = """
                UPDATE search_job
                SET
                    acquisition_event_created_at =
                        CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND state = 'QUEUED'
                  AND acquisition_event_created_at IS NULL
                """;

        return jdbcTemplate.update(sql, jobId) == 1;
    }

    public Optional<SearchJob> claimForSubmission(UUID jobId) {
        if (jobId == null) {
            throw new IllegalArgumentException(
                    "Job ID must not be null"
            );
        }

        String sql = """
                UPDATE search_job
                SET
                    state = 'SUBMITTING',
                    submission_started_at = CURRENT_TIMESTAMP,
                    attempts = attempts + 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND state = 'QUEUED'
                  AND provider_search_id IS NULL
                RETURNING
                    id,
                    cache_key,
                    request_payload::text AS request_payload,
                    provider_search_id,
                    state,
                    attempts,
                    credits,
                    created_at,
                    updated_at
                """;

        List<SearchJob> claimed = jdbcTemplate.query(
                sql,
                this::mapRow,
                jobId
        );

        return claimed.stream().findFirst();
    }

    public boolean markSubmitted(
            UUID jobId,
            String providerSearchId,
            boolean providerAlreadyCompleted
    ) {
        if (jobId == null) {
            throw new IllegalArgumentException(
                    "Job ID must not be null"
            );
        }

        if (providerSearchId == null || providerSearchId.isBlank()) {
            throw new IllegalArgumentException(
                    "Provider search ID must not be blank"
            );
        }

        String nextState = providerAlreadyCompleted
                ? "PROCESSING"
                : "SUBMITTED";

        String sql = """
                UPDATE search_job
                SET
                    provider_search_id = ?,
                    state = ?,
                    next_poll_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND state = 'SUBMITTING'
                  AND provider_search_id IS NULL
                """;

        return jdbcTemplate.update(
                sql,
                providerSearchId,
                nextState,
                jobId
        ) == 1;
    }

    /**
     * Recovers a SUBMITTING job only when the provider search ID
     * is already persisted.
     *
     * This operation never contacts the provider and never submits
     * a new search. It only makes the already-known provider search
     * available to the archive polling worker again.
     */
    @Transactional
    public boolean recoverSubmittingWithProviderId(
            UUID jobId
    ) {
        if (jobId == null) {
            throw new IllegalArgumentException(
                    "Job ID must not be null"
            );
        }

        String sql = """
                UPDATE search_job
                SET
                    state = 'SUBMITTED',
                    next_poll_at = CURRENT_TIMESTAMP,
                    submission_started_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND state = 'SUBMITTING'
                  AND provider_search_id IS NOT NULL
                  AND provider_search_id <> ''
                """;

        return jdbcTemplate.update(sql, jobId) == 1;
    }

    /**
     * Returns stale SUBMITTING jobs for recovery inspection.
     *
     * No state is changed by this method.
     */
    public List<SubmissionRecoveryJob> findStaleSubmitting(
            int limit,
            long staleAfterSeconds
    ) {
        if (limit < 1 || limit > 500) {
            throw new IllegalArgumentException(
                    "Submission recovery batch limit must be between 1 and 500"
            );
        }

        if (staleAfterSeconds < 1 || staleAfterSeconds > 86400) {
            throw new IllegalArgumentException(
                    "Submission stale threshold must be between 1 and 86400 seconds"
            );
        }

        String sql = """
                SELECT
                    id,
                    cache_key,
                    provider_search_id,
                    submission_started_at,
                    attempts
                FROM search_job
                WHERE state = 'SUBMITTING'
                  AND submission_started_at IS NOT NULL
                  AND submission_started_at <=
                      CURRENT_TIMESTAMP
                      - (? * INTERVAL '1 second')
                ORDER BY submission_started_at ASC
                LIMIT ?
                """;

        return jdbcTemplate.query(
                sql,
                (rs, rowNum) -> new SubmissionRecoveryJob(
                        rs.getObject("id", UUID.class),
                        rs.getString("cache_key"),
                        rs.getString("provider_search_id"),
                        rs.getTimestamp(
                                "submission_started_at"
                        ).toInstant(),
                        rs.getInt("attempts")
                ),
                staleAfterSeconds,
                limit
        );
    }

    @Transactional
    public boolean markSubmissionFailed(UUID jobId) {
        if (jobId == null) {
            throw new IllegalArgumentException("Job ID must not be null");
        }

        return jdbcTemplate.update(
                """
                UPDATE search_job
                SET
                    state = 'FAILED',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND state = 'SUBMITTING'
                """,
                jobId
        ) > 0;
    }

    /**
     * Fails a job that never reached the provider (for example because
     * the governor refused it). No provider credit was spent, so this is
     * safe to do immediately.
     */
    @Transactional
    public boolean markQueuedFailed(UUID jobId) {
        if (jobId == null) {
            throw new IllegalArgumentException("Job ID must not be null");
        }

        return jdbcTemplate.update(
                """
                UPDATE search_job
                SET
                    state = 'FAILED',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND state = 'QUEUED'
                """,
                jobId
        ) > 0;
    }

    public boolean markProcessing(UUID jobId) {
        if (jobId == null) {
            throw new IllegalArgumentException(
                    "Job ID must not be null"
            );
        }

        String sql = """
                UPDATE search_job
                SET
                    state = 'PROCESSING',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND state = 'SUBMITTED'
                  AND provider_search_id IS NOT NULL
                """;

        return jdbcTemplate.update(sql, jobId) == 1;
    }

    @Transactional
    public List<ArchivePollClaim> claimDueArchivePolls(
            int limit,
            long leaseSeconds
    ) {
        if (limit < 1 || limit > 500) {
            throw new IllegalArgumentException(
                    "Archive poll batch limit must be between 1 and 500"
            );
        }

        if (leaseSeconds < 1 || leaseSeconds > 3600) {
            throw new IllegalArgumentException(
                    "Poll lease must be between 1 and 3600 seconds"
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
                        COALESCE(next_poll_at, updated_at) ASC,
                        updated_at ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT ?
                )
                UPDATE search_job AS job
                SET
                    poll_claimed_until =
                        CURRENT_TIMESTAMP
                        + (? * INTERVAL '1 second'),
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
                        rs.getTimestamp(
                                "poll_claimed_until"
                        ).toInstant(),
                        rs.getInt("poll_attempts")
                ),
                limit,
                leaseSeconds
        );
    }

    @Transactional
    public boolean scheduleNextArchivePoll(
            UUID jobId,
            long delaySeconds
    ) {
        if (jobId == null) {
            throw new IllegalArgumentException(
                    "Job ID must not be null"
            );
        }

        if (delaySeconds < 1 || delaySeconds > 86400) {
            throw new IllegalArgumentException(
                    "Archive poll delay must be between 1 and 86400 seconds"
            );
        }

        String sql = """
                UPDATE search_job
                SET
                    poll_attempts = poll_attempts + 1,
                    next_poll_at =
                        CURRENT_TIMESTAMP
                        + (? * INTERVAL '1 second'),
                    poll_claimed_until = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND state IN ('SUBMITTED', 'PROCESSING')
                  AND provider_search_id IS NOT NULL
                """;

        return jdbcTemplate.update(
                sql,
                delaySeconds,
                jobId
        ) == 1;
    }

    @Transactional
    public boolean releaseArchivePollClaim(UUID jobId) {
        if (jobId == null) {
            throw new IllegalArgumentException(
                    "Job ID must not be null"
            );
        }

        String sql = """
                UPDATE search_job
                SET
                    poll_claimed_until = NULL,
                    next_poll_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND state IN ('SUBMITTED', 'PROCESSING')
                  AND provider_search_id IS NOT NULL
                """;

        return jdbcTemplate.update(sql, jobId) == 1;
    }

    @Transactional
    public boolean storeProviderResult(
            UUID jobId,
            String rawJson
    ) {
        if (jobId == null) {
            throw new IllegalArgumentException(
                    "Job ID must not be null"
            );
        }

        if (rawJson == null || rawJson.isBlank()) {
            throw new IllegalArgumentException(
                    "Provider result JSON must not be blank"
            );
        }

        String sql = """
                UPDATE search_job
                SET
                    provider_result = ?::jsonb,
                    provider_result_received_at =
                        CURRENT_TIMESTAMP,
                    state = 'RESULT_READY',
                    poll_claimed_until = NULL,
                    next_poll_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND state IN ('SUBMITTED', 'PROCESSING')
                  AND provider_search_id IS NOT NULL
                  AND provider_result IS NULL
                """;

        return jdbcTemplate.update(
                sql,
                rawJson,
                jobId
        ) == 1;
    }

    public List<ResultReadyJob> findResultReady(int limit) {
        if (limit < 1 || limit > 500) {
            throw new IllegalArgumentException(
                    "Result batch limit must be between 1 and 500"
            );
        }

        String sql = """
                SELECT
                    id,
                    cache_key,
                    provider_search_id,
                    provider_result::text AS provider_result,
                    provider_result_received_at
                FROM search_job
                WHERE state = 'RESULT_READY'
                  AND provider_result IS NOT NULL
                ORDER BY provider_result_received_at ASC
                LIMIT ?
                """;

        return jdbcTemplate.query(
                sql,
                (rs, rowNum) -> new ResultReadyJob(
                        rs.getObject("id", UUID.class),
                        rs.getString("cache_key"),
                        rs.getString("provider_search_id"),
                        rs.getString("provider_result"),
                        rs.getTimestamp(
                                "provider_result_received_at"
                        ).toInstant()
                ),
                limit
        );
    }

    public List<SearchJob> findAwaitingArchive(int limit) {
        if (limit < 1 || limit > 500) {
            throw new IllegalArgumentException(
                    "Archive batch limit must be between 1 and 500"
            );
        }

        String sql = """
                SELECT
                    id,
                    cache_key,
                    request_payload::text AS request_payload,
                    provider_search_id,
                    state,
                    attempts,
                    credits,
                    created_at,
                    updated_at
                FROM search_job
                WHERE state IN ('SUBMITTED', 'PROCESSING')
                  AND provider_search_id IS NOT NULL
                ORDER BY updated_at ASC
                LIMIT ?
                """;

        return jdbcTemplate.query(
                sql,
                this::mapRow,
                limit
        );
    }

    public Optional<SearchJob> findById(UUID jobId) {
        if (jobId == null) {
            throw new IllegalArgumentException(
                    "Job ID must not be null"
            );
        }

        String sql = """
                SELECT
                    id,
                    cache_key,
                    request_payload::text AS request_payload,
                    provider_search_id,
                    state,
                    attempts,
                    credits,
                    created_at,
                    updated_at
                FROM search_job
                WHERE id = ?
                """;

        List<SearchJob> results = jdbcTemplate.query(
                sql,
                this::mapRow,
                jobId
        );

        return results.stream().findFirst();
    }

    private String serializeRequest(SearchRequest request) {
        if (request == null) {
            return null;
        }

        try {
            return objectMapper.writeValueAsString(request);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(
                    "Could not serialize acquisition request",
                    exception
            );
        }
    }

    private SearchJob mapRow(
            ResultSet rs,
            int rowNum
    ) throws SQLException {

        return new SearchJob(
                rs.getObject("id", UUID.class),
                rs.getString("cache_key"),
                rs.getString("request_payload"),
                rs.getString("provider_search_id"),
                rs.getString("state"),
                rs.getInt("attempts"),
                rs.getInt("credits"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant()
        );
    }

    public record ArchivePollClaim(
            UUID jobId,
            String providerSearchId,
            Instant claimedUntil,
            int pollAttempts
    ) {
    }

    public record ResultReadyJob(
            UUID jobId,
            String cacheKey,
            String providerSearchId,
            String providerResultJson,
            Instant receivedAt
    ) {
    }

    public record SubmissionRecoveryJob(
            UUID jobId,
            String cacheKey,
            String providerSearchId,
            Instant submissionStartedAt,
            int attempts
    ) {
    }

    public record SearchJob(
            UUID id,
            String cacheKey,
            String requestPayload,
            String providerSearchId,
            String state,
            int attempts,
            int credits,
            Instant createdAt,
            Instant updatedAt
    ) {
    }
}
