package in.setusync.relay.persistence;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

@Repository
public class GovernorRepository {

    private static final String GOVERNOR_LOCK =
            "setusync:provider-credit-governor";

    private final JdbcTemplate jdbcTemplate;

    public GovernorRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional
    public ReservationResult reserveInteractive(
            UUID jobId,
            UUID installId,
            long monthlyBudget,
            long perInstallQuota
    ) {
        if (jobId == null || installId == null) {
            throw new IllegalArgumentException(
                    "Job ID and install ID are required"
            );
        }

        if (monthlyBudget <= 0) {
            return new ReservationResult(
                    false,
                    "BUDGET_NOT_CONFIGURED",
                    0
            );
        }

        if (perInstallQuota <= 0) {
            return new ReservationResult(
                    false,
                    "INSTALL_QUOTA_NOT_CONFIGURED",
                    0
            );
        }

        /*
         * Serialize the budget decision across Relay workers.
         * The reservation itself is persisted on search_job, so a
         * worker crash cannot silently create an unaccounted spend.
         */
        jdbcTemplate.queryForObject(
                "SELECT pg_advisory_xact_lock(hashtext(?))",
                Object.class,
                GOVERNOR_LOCK
        );

        Integer existingReservation =
                jdbcTemplate.queryForObject(
                        """
                        SELECT governor_reserved_credits
                        FROM search_job
                        WHERE id = ?
                        """,
                        Integer.class,
                        jobId
                );

        if (existingReservation == null) {
            throw new IllegalStateException(
                    "Acquisition job does not exist: " + jobId
            );
        }

        if (existingReservation > 0) {
            return new ReservationResult(
                    true,
                    "ALREADY_RESERVED",
                    existingReservation
            );
        }

        Long installUsed =
                jdbcTemplate.queryForObject(
                        """
                        SELECT quota_used
                        FROM install
                        WHERE id = ?
                        """,
                        Long.class,
                        installId
                );

        if (installUsed == null) {
            throw new IllegalStateException(
                    "Installation does not exist: " + installId
            );
        }

        if (installUsed >= perInstallQuota) {
            return new ReservationResult(
                    false,
                    "INSTALL_QUOTA",
                    0
            );
        }

        Instant monthStart =
                Instant.now()
                        .atZone(
                                java.time.ZoneOffset.UTC
                        )
                        .withDayOfMonth(1)
                        .toLocalDate()
                        .atStartOfDay(
                                java.time.ZoneOffset.UTC
                        )
                        .toInstant();

        Long consumed =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COALESCE(SUM(credits), 0)
                        FROM ledger
                        WHERE ts >= ?
                        """,
                        Long.class,
                        java.sql.Timestamp.from(
                                monthStart
                        )
                );

        Long reserved =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COALESCE(
                            SUM(governor_reserved_credits),
                            0
                        )
                        FROM search_job
                        WHERE governor_reserved_credits > 0
                          AND created_at >= ?
                        """,
                        Long.class,
                        java.sql.Timestamp.from(
                                monthStart
                        )
                );

        long used =
                (consumed == null ? 0 : consumed) +
                (reserved == null ? 0 : reserved);

        if (used >= monthlyBudget) {
            return new ReservationResult(
                    false,
                    "BUDGET_EXHAUSTED",
                    0
            );
        }

        jdbcTemplate.update(
                """
                UPDATE search_job
                SET
                    governor_reserved_credits = 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND governor_reserved_credits = 0
                  AND state = 'QUEUED'
                """,
                jobId
        );

        jdbcTemplate.update(
                """
                UPDATE install
                SET
                    quota_used = quota_used + 1,
                    last_seen = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                installId
        );

        return new ReservationResult(
                true,
                "APPROVED",
                1
        );
    }

    @Transactional
    public void settle(
            UUID jobId,
            UUID installId,
            int actualCredits
    ) {
        if (jobId == null || installId == null) {
            throw new IllegalArgumentException(
                    "Job ID and install ID are required"
            );
        }

        if (actualCredits < 0 || actualCredits > 1) {
            throw new IllegalArgumentException(
                    "Actual provider credits must be 0 or 1"
            );
        }

        jdbcTemplate.queryForObject(
                "SELECT pg_advisory_xact_lock(hashtext(?))",
                Object.class,
                GOVERNOR_LOCK
        );

        Integer reserved =
                jdbcTemplate.queryForObject(
                        """
                        SELECT governor_reserved_credits
                        FROM search_job
                        WHERE id = ?
                        """,
                        Integer.class,
                        jobId
                );

        if (reserved == null) {
            throw new IllegalStateException(
                    "Acquisition job does not exist: " + jobId
            );
        }

        if (reserved == 0) {
            return;
        }

        if (actualCredits == 0) {
            jdbcTemplate.update(
                    """
                    UPDATE install
                    SET
                        quota_used =
                            GREATEST(quota_used - 1, 0),
                        last_seen = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    installId
            );
        }

        jdbcTemplate.update(
                """
                UPDATE search_job
                SET
                    governor_reserved_credits = 0,
                    credits = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                actualCredits,
                jobId
        );
    }

    public record ReservationResult(
            boolean approved,
            String reason,
            int reservedCredits
    ) {
    }
}