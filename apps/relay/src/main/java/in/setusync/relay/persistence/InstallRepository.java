
package in.setusync.relay.persistence;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Repository
public class InstallRepository {

    private final JdbcTemplate jdbcTemplate;

    public InstallRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * Registers an installation or updates its last-seen time.
     */
    @Transactional
    public Installation registerOrTouch(UUID installId) {

        if (installId == null) {
            throw new IllegalArgumentException(
                    "Install ID must not be null"
            );
        }

        Timestamp now = Timestamp.from(Instant.now());

        return jdbcTemplate.queryForObject(
                """
                INSERT INTO install (
                    id,
                    created_at,
                    last_seen,
                    quota_used
                )
                VALUES (?, ?, ?, 0)
                ON CONFLICT (id)
                DO UPDATE SET
                    last_seen = EXCLUDED.last_seen
                RETURNING
                    id,
                    created_at,
                    last_seen,
                    quota_used
                """,
                (rs, rowNum) -> mapInstallation(rs),
                installId,
                now,
                now
        );
    }

    /**
     * Retrieves an installation by ID.
     */
    public Optional<Installation> findById(UUID installId) {

        if (installId == null) {
            throw new IllegalArgumentException(
                    "Install ID must not be null"
            );
        }

        return jdbcTemplate.query(
                """
                SELECT
                    id,
                    created_at,
                    last_seen,
                    quota_used
                FROM install
                WHERE id = ?
                """,
                (rs, rowNum) -> mapInstallation(rs),
                installId
        ).stream().findFirst();
    }

    /**
     * Increments the installation's recorded quota usage.
     */
    @Transactional
    public void addQuotaUsage(UUID installId, long amount) {

        if (installId == null) {
            throw new IllegalArgumentException(
                    "Install ID must not be null"
            );
        }

        if (amount <= 0) {
            throw new IllegalArgumentException(
                    "Quota amount must be greater than zero"
            );
        }

        int updated = jdbcTemplate.update(
                """
                UPDATE install
                SET quota_used = quota_used + ?,
                    last_seen = ?
                WHERE id = ?
                """,
                amount,
                Timestamp.from(Instant.now()),
                installId
        );

        if (updated != 1) {
            throw new IllegalStateException(
                    "Installation was not found"
            );
        }
    }

    private Installation mapInstallation(ResultSet rs)
            throws SQLException {

        return new Installation(
                rs.getObject("id", UUID.class),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("last_seen").toInstant(),
                rs.getLong("quota_used")
        );
    }

    public record Installation(
            UUID id,
            Instant createdAt,
            Instant lastSeen,
            long quotaUsed
    ) {
    }
}
