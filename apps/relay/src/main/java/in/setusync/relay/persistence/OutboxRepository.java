
package in.setusync.relay.persistence;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Repository
public class OutboxRepository {

    private final JdbcTemplate jdbcTemplate;

    public OutboxRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional
    public UUID append(
            String aggregateType,
            String aggregateId,
            String eventType,
            String payloadJson
    ) {
        requireText(aggregateType, "aggregateType");
        requireText(aggregateId, "aggregateId");
        requireText(eventType, "eventType");
        requireText(payloadJson, "payloadJson");

        UUID eventId = UUID.randomUUID();

        jdbcTemplate.update(
                """
                INSERT INTO outbox_event (
                    id,
                    aggregate_type,
                    aggregate_id,
                    event_type,
                    payload,
                    published_at
                )
                VALUES (?, ?, ?, ?, CAST(? AS JSONB), NULL)
                """,
                eventId,
                aggregateType,
                aggregateId,
                eventType,
                payloadJson
        );

        return eventId;
    }

    @Transactional
    public List<OutboxEvent> claimPending(
            int limit,
            int leaseSeconds
    ) {
        if (limit < 1 || limit > 1000) {
            throw new IllegalArgumentException(
                    "limit must be between 1 and 1000"
            );
        }

        if (leaseSeconds < 1 || leaseSeconds > 3600) {
            throw new IllegalArgumentException(
                    "leaseSeconds must be between 1 and 3600"
            );
        }

        UUID claimToken = UUID.randomUUID();

        return jdbcTemplate.query(
                """
                WITH candidates AS (
                    SELECT id
                    FROM outbox_event
                    WHERE published_at IS NULL
                      AND next_attempt_at <= CURRENT_TIMESTAMP
                      AND (
                          claimed_at IS NULL
                          OR claimed_at < CURRENT_TIMESTAMP
                              - make_interval(secs => ?)
                      )
                    ORDER BY created_at, id
                    FOR UPDATE SKIP LOCKED
                    LIMIT ?
                )
                UPDATE outbox_event AS event
                SET claimed_at = CURRENT_TIMESTAMP,
                    claim_token = ?,
                    attempts = event.attempts + 1
                FROM candidates
                WHERE event.id = candidates.id
                RETURNING
                    event.id,
                    event.aggregate_type,
                    event.aggregate_id,
                    event.event_type,
                    event.payload::text AS payload_json,
                    event.claim_token
                """,
                (resultSet, rowNumber) -> new OutboxEvent(
                        resultSet.getObject("id", UUID.class),
                        resultSet.getString("aggregate_type"),
                        resultSet.getString("aggregate_id"),
                        resultSet.getString("event_type"),
                        resultSet.getString("payload_json"),
                        resultSet.getObject("claim_token", UUID.class)
                ),
                leaseSeconds,
                limit,
                claimToken
        );
    }

    @Transactional
    public boolean markPublished(
            UUID eventId,
            UUID claimToken
    ) {
        requireId(eventId, "eventId");
        requireId(claimToken, "claimToken");

        int updated = jdbcTemplate.update(
                """
                UPDATE outbox_event
                SET published_at = CURRENT_TIMESTAMP,
                    claimed_at = NULL,
                    claim_token = NULL,
                    last_error = NULL
                WHERE id = ?
                  AND claim_token = ?
                  AND published_at IS NULL
                """,
                eventId,
                claimToken
        );

        return updated == 1;
    }

    @Transactional
    public boolean releaseForRetry(
            UUID eventId,
            UUID claimToken,
            int retryDelaySeconds,
            String errorMessage
    ) {
        requireId(eventId, "eventId");
        requireId(claimToken, "claimToken");

        if (retryDelaySeconds < 1 || retryDelaySeconds > 86400) {
            throw new IllegalArgumentException(
                    "retryDelaySeconds must be between 1 and 86400"
            );
        }

        String safeError = errorMessage == null
                ? "Unknown dispatch error"
                : errorMessage;

        if (safeError.length() > 2000) {
            safeError = safeError.substring(0, 2000);
        }

        int updated = jdbcTemplate.update(
                """
                UPDATE outbox_event
                SET claimed_at = NULL,
                    claim_token = NULL,
                    next_attempt_at = CURRENT_TIMESTAMP
                        + make_interval(secs => ?),
                    last_error = ?
                WHERE id = ?
                  AND claim_token = ?
                  AND published_at IS NULL
                """,
                retryDelaySeconds,
                safeError,
                eventId,
                claimToken
        );

        return updated == 1;
    }

    private static void requireText(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(
                    fieldName + " is required"
            );
        }
    }

    private static void requireId(UUID value, String fieldName) {
        if (value == null) {
            throw new IllegalArgumentException(
                    fieldName + " is required"
            );
        }
    }

    public record OutboxEvent(
            UUID id,
            String aggregateType,
            String aggregateId,
            String eventType,
            String payloadJson,
            UUID claimToken
    ) {
    }
}
