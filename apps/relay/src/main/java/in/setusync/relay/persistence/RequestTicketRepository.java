package in.setusync.relay.persistence;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

@Repository
public class RequestTicketRepository {

    private final JdbcTemplate jdbcTemplate;

    public RequestTicketRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional
    public RequestTicket createOrGet(
            UUID installId,
            String idempotencyKey,
            String cacheKey
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

        UUID proposedId = UUID.randomUUID();
        Timestamp now = Timestamp.from(Instant.now());

        RequestTicket ticket = jdbcTemplate.queryForObject(
                """
                INSERT INTO request_ticket (
                    id,
                    install_id,
                    idempotency_key,
                    cache_key,
                    state,
                    created_at
                )
                VALUES (?, ?, ?, ?, 'PROCESSING', ?)
                ON CONFLICT (install_id, idempotency_key)
                DO UPDATE SET
                    idempotency_key = EXCLUDED.idempotency_key
                RETURNING
                    id,
                    install_id,
                    idempotency_key,
                    cache_key,
                    state,
                    created_at,
                    search_job_id
                """,
                (rs, rowNum) -> mapTicket(rs),
                proposedId,
                installId,
                idempotencyKey,
                cacheKey,
                now
        );

        if (!ticket.cacheKey().equals(cacheKey)) {
            throw new IdempotencyConflictException(
                    "Idempotency key was already used for a different search"
            );
        }

        return ticket;
    }

    @Transactional
    public UUID associateSearchJob(
            UUID ticketId,
            UUID proposedJobId
    ) {
        if (ticketId == null || proposedJobId == null) {
            throw new IllegalArgumentException(
                    "Ticket ID and job ID are required"
            );
        }

        jdbcTemplate.update(
                """
                UPDATE request_ticket
                SET search_job_id = COALESCE(search_job_id, ?)
                WHERE id = ?
                """,
                proposedJobId,
                ticketId
        );

        UUID associatedJobId = jdbcTemplate.queryForObject(
                """
                SELECT search_job_id
                FROM request_ticket
                WHERE id = ?
                """,
                UUID.class,
                ticketId
        );

        if (associatedJobId == null) {
            throw new IllegalStateException(
                    "Request ticket has no associated acquisition job"
            );
        }

        return associatedJobId;
    }

    public Optional<RequestTicket> findById(UUID ticketId) {
        if (ticketId == null) {
            throw new IllegalArgumentException(
                    "Ticket ID must not be null"
            );
        }

        return jdbcTemplate.query(
                """
                SELECT
                    id,
                    install_id,
                    idempotency_key,
                    cache_key,
                    state,
                    created_at,
                    search_job_id
                FROM request_ticket
                WHERE id = ?
                """,
                (rs, rowNum) -> mapTicket(rs),
                ticketId
        ).stream().findFirst();
    }

    public Optional<RequestTicket> findByIdAndInstallId(
            UUID ticketId,
            UUID installId
    ) {
        if (ticketId == null || installId == null) {
            throw new IllegalArgumentException(
                    "Ticket ID and install ID are required"
            );
        }

        return jdbcTemplate.query(
                """
                SELECT
                    id,
                    install_id,
                    idempotency_key,
                    cache_key,
                    state,
                    created_at,
                    search_job_id
                FROM request_ticket
                WHERE id = ?
                  AND install_id = ?
                """,
                (rs, rowNum) -> mapTicket(rs),
                ticketId,
                installId
        ).stream().findFirst();
    }

    @Transactional
    public void updateState(UUID ticketId, String state) {
        if (ticketId == null) {
            throw new IllegalArgumentException(
                    "Ticket ID must not be null"
            );
        }

        validateState(state);

        int updated = jdbcTemplate.update(
                """
                UPDATE request_ticket
                SET state = ?
                WHERE id = ?
                """,
                state,
                ticketId
        );

        if (updated != 1) {
            throw new IllegalStateException(
                    "Request ticket was not found"
            );
        }
    }

    public Optional<UUID> findInstallIdForSearchJob(UUID jobId) {
        if (jobId == null) {
            throw new IllegalArgumentException(
                    "Search job ID must not be null"
            );
        }

        return jdbcTemplate.query(
                """
                SELECT install_id
                FROM request_ticket
                WHERE search_job_id = ?
                  AND install_id IS NOT NULL
                ORDER BY created_at ASC
                LIMIT 1
                """,
                (rs, rowNum) -> rs.getObject("install_id", UUID.class),
                jobId
        ).stream().findFirst();
    }

    @Transactional
    public int updateStateForSearchJob(
            UUID jobId,
            String state
    ) {
        if (jobId == null) {
            throw new IllegalArgumentException(
                    "Search job ID must not be null"
            );
        }

        validateState(state);

        return jdbcTemplate.update(
                """
                UPDATE request_ticket
                SET state = ?
                WHERE search_job_id = ?
                """,
                state,
                jobId
        );
    }

    /**
     * Marks every ticket attached to the job as FAILED and records a
     * human-readable reason that clients can show to the user.
     */
    @Transactional
    public int failTicketsForSearchJob(
            UUID jobId,
            String reason
    ) {
        if (jobId == null) {
            throw new IllegalArgumentException(
                    "Search job ID must not be null"
            );
        }

        String storedReason = reason;

        if (storedReason != null && storedReason.length() > 500) {
            storedReason = storedReason.substring(0, 500);
        }

        return jdbcTemplate.update(
                """
                UPDATE request_ticket
                SET state = 'FAILED',
                    failure_reason = ?
                WHERE search_job_id = ?
                """,
                storedReason,
                jobId
        );
    }

    public Optional<String> findFailureReason(UUID ticketId) {
        if (ticketId == null) {
            throw new IllegalArgumentException(
                    "Ticket ID must not be null"
            );
        }

        return jdbcTemplate.query(
                """
                SELECT failure_reason
                FROM request_ticket
                WHERE id = ?
                """,
                (rs, rowNum) -> rs.getString("failure_reason"),
                ticketId
        ).stream().filter(Objects::nonNull).findFirst();
    }

    private void validateState(String state) {
        if (state == null) {
            throw new IllegalArgumentException(
                    "Ticket state must not be null"
            );
        }

        switch (state) {
            case "READY", "PROCESSING", "FAILED", "EXPIRED" -> {
                // Valid ticket state.
            }
            default -> throw new IllegalArgumentException(
                    "Invalid ticket state: " + state
            );
        }
    }

    private RequestTicket mapTicket(ResultSet rs)
            throws SQLException {

        return new RequestTicket(
                rs.getObject("id", UUID.class),
                rs.getObject("install_id", UUID.class),
                rs.getString("idempotency_key"),
                rs.getString("cache_key"),
                rs.getString("state"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getObject("search_job_id", UUID.class)
        );
    }

    public record RequestTicket(
            UUID id,
            UUID installId,
            String idempotencyKey,
            String cacheKey,
            String state,
            Instant createdAt,
            UUID searchJobId
    ) {
    }

    public static class IdempotencyConflictException
            extends RuntimeException {

        public IdempotencyConflictException(String message) {
            super(message);
        }
    }
}