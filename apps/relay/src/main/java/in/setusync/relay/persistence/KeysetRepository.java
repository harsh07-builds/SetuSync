package in.setusync.relay.persistence;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Repository
public class KeysetRepository {

    private final JdbcTemplate jdbcTemplate;

    public KeysetRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional
    public void activateNewKey(
            String kid,
            String publicKeySpkiB64
    ) {
        if (kid == null || kid.isBlank()) {
            throw new IllegalArgumentException("kid is required");
        }

        if (publicKeySpkiB64 == null || publicKeySpkiB64.isBlank()) {
            throw new IllegalArgumentException(
                    "publicKeySpkiB64 is required"
            );
        }

        jdbcTemplate.update(
                """
                UPDATE keyset
                SET status = 'RETIRED',
                    retired_at = CURRENT_TIMESTAMP
                WHERE status = 'ACTIVE'
                """
        );

        jdbcTemplate.update(
                """
                INSERT INTO keyset (
                    kid,
                    algorithm,
                    public_key_spki_b64,
                    status,
                    created_at,
                    activated_at
                )
                VALUES (?, 'Ed25519', ?, 'ACTIVE',
                        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """,
                kid,
                publicKeySpkiB64
        );
    }

    public Optional<SigningPublicKey> findActive() {
        List<SigningPublicKey> keys = jdbcTemplate.query(
                """
                SELECT kid, algorithm, public_key_spki_b64, status,
                       created_at, activated_at, retired_at
                FROM keyset
                WHERE status = 'ACTIVE'
                """,
                (rs, rowNum) -> new SigningPublicKey(
                        rs.getString("kid"),
                        rs.getString("algorithm"),
                        rs.getString("public_key_spki_b64"),
                        rs.getString("status"),
                        rs.getTimestamp("created_at").toInstant(),
                        rs.getTimestamp("activated_at") == null
                                ? null
                                : rs.getTimestamp("activated_at").toInstant(),
                        rs.getTimestamp("retired_at") == null
                                ? null
                                : rs.getTimestamp("retired_at").toInstant()
                )
        );

        return keys.stream().findFirst();
    }

    /**
     * Keys a client may use to verify capsules: the ACTIVE key and any
     * RETIRED ones (capsules signed before a rotation stay valid).
     * REVOKED keys are never published.
     */
    public List<SigningPublicKey> findPublishable() {
        return jdbcTemplate.query(
                """
                SELECT kid, algorithm, public_key_spki_b64, status,
                       created_at, activated_at, retired_at
                FROM keyset
                WHERE status IN ('ACTIVE', 'RETIRED')
                ORDER BY created_at DESC
                """,
                (rs, rowNum) -> new SigningPublicKey(
                        rs.getString("kid"),
                        rs.getString("algorithm"),
                        rs.getString("public_key_spki_b64"),
                        rs.getString("status"),
                        rs.getTimestamp("created_at").toInstant(),
                        rs.getTimestamp("activated_at") == null
                                ? null
                                : rs.getTimestamp("activated_at").toInstant(),
                        rs.getTimestamp("retired_at") == null
                                ? null
                                : rs.getTimestamp("retired_at").toInstant()
                )
        );
    }

    public Optional<SigningPublicKey> findByKid(String kid) {
        List<SigningPublicKey> keys = jdbcTemplate.query(
                """
                SELECT kid, algorithm, public_key_spki_b64, status,
                       created_at, activated_at, retired_at
                FROM keyset
                WHERE kid = ?
                """,
                (rs, rowNum) -> new SigningPublicKey(
                        rs.getString("kid"),
                        rs.getString("algorithm"),
                        rs.getString("public_key_spki_b64"),
                        rs.getString("status"),
                        rs.getTimestamp("created_at").toInstant(),
                        rs.getTimestamp("activated_at") == null
                                ? null
                                : rs.getTimestamp("activated_at").toInstant(),
                        rs.getTimestamp("retired_at") == null
                                ? null
                                : rs.getTimestamp("retired_at").toInstant()
                ),
                kid
        );

        return keys.stream().findFirst();
    }

    public record SigningPublicKey(
            String kid,
            String algorithm,
            String publicKeySpkiB64,
            String status,
            java.time.Instant createdAt,
            java.time.Instant activatedAt,
            java.time.Instant retiredAt
    ) {
    }
}
