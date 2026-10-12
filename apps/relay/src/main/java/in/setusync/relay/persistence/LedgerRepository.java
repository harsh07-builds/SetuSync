package in.setusync.relay.persistence;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Repository
public class LedgerRepository {

    private final JdbcTemplate jdbcTemplate;

    public LedgerRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional
    public UUID append(
            String kind,
            int credits,
            int savedCredits,
            long bytesRaw,
            long bytesCapsule,
            String note
    ) {
        validate(
                kind,
                credits,
                savedCredits,
                bytesRaw,
                bytesCapsule
        );

        UUID id = UUID.randomUUID();

        jdbcTemplate.update(
                """
                INSERT INTO ledger (
                    id,
                    ts,
                    kind,
                    credits,
                    saved_credits,
                    bytes_raw,
                    bytes_capsule,
                    note
                )
                VALUES (
                    ?,
                    CURRENT_TIMESTAMP,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?
                )
                """,
                id,
                kind,
                credits,
                savedCredits,
                bytesRaw,
                bytesCapsule,
                note
        );

        return id;
    }

    @Transactional
    public UUID appendOnce(
            String kind,
            int credits,
            int savedCredits,
            long bytesRaw,
            long bytesCapsule,
            String note
    ) {
        validate(
                kind,
                credits,
                savedCredits,
                bytesRaw,
                bytesCapsule
        );

        UUID id = UUID.randomUUID();

        try {
            int inserted = jdbcTemplate.update(
                    """
                    INSERT INTO ledger (
                        id,
                        ts,
                        kind,
                        credits,
                        saved_credits,
                        bytes_raw,
                        bytes_capsule,
                        note
                    )
                    VALUES (
                        ?,
                        CURRENT_TIMESTAMP,
                        ?,
                        ?,
                        ?,
                        ?,
                        ?,
                        ?
                    )
                    ON CONFLICT (kind, note)
                    WHERE kind IN (
                        'ACQUISITION_CACHE_HIT',
                        'ACQUISITION_PROVIDER'
                    )
                    DO NOTHING
                    """,
                    id,
                    kind,
                    credits,
                    savedCredits,
                    bytesRaw,
                    bytesCapsule,
                    note
            );

            return inserted == 1 ? id : null;

        } catch (DuplicateKeyException duplicate) {
            return null;
        }
    }

    private void validate(
            String kind,
            int credits,
            int savedCredits,
            long bytesRaw,
            long bytesCapsule
    ) {
        if (kind == null || kind.isBlank()) {
            throw new IllegalArgumentException(
                    "Ledger kind must not be blank"
            );
        }

        if (credits < 0) {
            throw new IllegalArgumentException(
                    "Ledger credits must not be negative"
            );
        }

        if (savedCredits < 0) {
            throw new IllegalArgumentException(
                    "Ledger saved credits must not be negative"
            );
        }

        if (bytesRaw < 0 || bytesCapsule < 0) {
            throw new IllegalArgumentException(
                    "Ledger byte counts must not be negative"
            );
        }
    }
}