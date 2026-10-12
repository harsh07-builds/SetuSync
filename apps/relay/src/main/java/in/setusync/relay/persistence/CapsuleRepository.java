package in.setusync.relay.persistence;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Repository
public class CapsuleRepository {

    private final JdbcTemplate jdbcTemplate;

    public CapsuleRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional
    public void save(
            String id,
            String cacheKey,
            String chash,
            Instant fetchedAt,
            Instant expiresAt,
            String risk,
            String kid,
            String objectKey
    ) {
        save(
                id,
                cacheKey,
                chash,
                fetchedAt,
                expiresAt,
                risk,
                kid,
                objectKey,
                0L
        );
    }

    @Transactional
    public void save(
            String id,
            String cacheKey,
            String chash,
            Instant fetchedAt,
            Instant expiresAt,
            String risk,
            String kid,
            String objectKey,
            long bytesCapsule
    ) {
        validate(
                id,
                cacheKey,
                chash,
                fetchedAt,
                expiresAt,
                risk,
                kid,
                objectKey,
                bytesCapsule
        );

        int inserted = jdbcTemplate.update(
                """
                INSERT INTO capsule (
                    id,
                    cache_key,
                    chash,
                    fetched_at,
                    expires_at,
                    risk,
                    kid,
                    object_key,
                    bytes_capsule
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (id) DO NOTHING
                """,
                id,
                cacheKey,
                chash,
                Timestamp.from(fetchedAt),
                Timestamp.from(expiresAt),
                risk,
                kid,
                objectKey,
                bytesCapsule
        );

        if (inserted == 0) {
            List<CapsuleMetadata> existing =
                    findMetadata(id);

            if (existing.isEmpty()) {
                throw new IllegalStateException(
                        "Capsule conflict occurred but existing record was not found"
                );
            }

            CapsuleMetadata stored =
                    existing.get(0);

            if (!stored.cacheKey().equals(cacheKey)
                    || !stored.chash().equals(chash)
                    || !stored.objectKey().equals(objectKey)) {
                throw new IllegalStateException(
                        "Capsule ID already exists with different metadata: "
                                + id
                );
            }

            if (stored.bytesCapsule() == 0
                    && bytesCapsule > 0) {
                updateBytes(
                        id,
                        bytesCapsule
                );
            }
        }
    }

    @Transactional
    public void updateBytes(
            String id,
            long bytesCapsule
    ) {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException(
                    "Capsule ID is required"
            );
        }

        if (bytesCapsule < 0) {
            throw new IllegalArgumentException(
                    "Capsule size must not be negative"
            );
        }

        jdbcTemplate.update(
                """
                UPDATE capsule
                SET bytes_capsule = ?
                WHERE id = ?
                """,
                bytesCapsule,
                id
        );
    }

    public Optional<CapsuleMetadata> findById(
            String id
    ) {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException(
                    "Capsule ID is required"
            );
        }

        return findMetadata(id)
                .stream()
                .findFirst();
    }

    public Optional<CapsuleMetadata> findValidByCacheKey(
            String cacheKey,
            Instant now
    ) {
        if (cacheKey == null || cacheKey.isBlank()) {
            throw new IllegalArgumentException(
                    "Cache key is required"
            );
        }

        if (now == null) {
            throw new IllegalArgumentException(
                    "Current time is required"
            );
        }

        List<CapsuleMetadata> results =
                jdbcTemplate.query(
                        """
                        SELECT
                            id,
                            cache_key,
                            chash,
                            object_key,
                            bytes_capsule,
                            fetched_at,
                            expires_at,
                            risk,
                            kid
                        FROM capsule
                        WHERE cache_key = ?
                          AND expires_at > ?
                        ORDER BY fetched_at DESC
                        LIMIT 1
                        """,
                        (rs, rowNum) ->
                                new CapsuleMetadata(
                                        rs.getString("id"),
                                        rs.getString("cache_key"),
                                        rs.getString("chash"),
                                        rs.getString("object_key"),
                                        rs.getLong("bytes_capsule"),
                                        rs.getTimestamp(
                                                "fetched_at"
                                        ).toInstant(),
                                        rs.getTimestamp(
                                                "expires_at"
                                        ).toInstant(),
                                        rs.getString("risk"),
                                        rs.getString("kid")
                                ),
                        cacheKey,
                        Timestamp.from(now)
                );

        return results.stream()
                .findFirst();
    }

    public List<CapsuleMetadata> findWishlistCandidates(
            Instant now,
            int limit
    ) {
        if (now == null) {
            throw new IllegalArgumentException(
                    "Current time is required"
            );
        }

        if (limit <= 0) {
            throw new IllegalArgumentException(
                    "Wishlist limit must be positive"
            );
        }

        return jdbcTemplate.query(
                """
                SELECT
                    id,
                    cache_key,
                    chash,
                    object_key,
                    bytes_capsule,
                    fetched_at,
                    expires_at,
                    risk,
                    kid
                FROM capsule
                WHERE expires_at > ?
                ORDER BY
                    CASE
                        WHEN risk = 'blocked' THEN 1
                        WHEN risk = 'live_required' THEN 2
                        WHEN risk = 'review' THEN 3
                        ELSE 0
                    END ASC,
                    expires_at ASC,
                    fetched_at DESC
                LIMIT ?
                """,
                (rs, rowNum) ->
                        new CapsuleMetadata(
                                rs.getString("id"),
                                rs.getString("cache_key"),
                                rs.getString("chash"),
                                rs.getString("object_key"),
                                rs.getLong("bytes_capsule"),
                                rs.getTimestamp(
                                        "fetched_at"
                                ).toInstant(),
                                rs.getTimestamp(
                                        "expires_at"
                                ).toInstant(),
                                rs.getString("risk"),
                                rs.getString("kid")
                        ),
                Timestamp.from(now),
                limit
        );
    }

    private List<CapsuleMetadata> findMetadata(
            String id
    ) {
        return jdbcTemplate.query(
                """
                SELECT
                    id,
                    cache_key,
                    chash,
                    object_key,
                    bytes_capsule,
                    fetched_at,
                    expires_at,
                    risk,
                    kid
                FROM capsule
                WHERE id = ?
                """,
                (rs, rowNum) ->
                        new CapsuleMetadata(
                                rs.getString("id"),
                                rs.getString("cache_key"),
                                rs.getString("chash"),
                                rs.getString("object_key"),
                                rs.getLong("bytes_capsule"),
                                rs.getTimestamp(
                                        "fetched_at"
                                ).toInstant(),
                                rs.getTimestamp(
                                        "expires_at"
                                ).toInstant(),
                                rs.getString("risk"),
                                rs.getString("kid")
                        ),
                id
        );
    }

    private void validate(
            String id,
            String cacheKey,
            String chash,
            Instant fetchedAt,
            Instant expiresAt,
            String risk,
            String kid,
            String objectKey,
            long bytesCapsule
    ) {
        if (id == null || id.isBlank()
                || cacheKey == null || cacheKey.isBlank()
                || chash == null || chash.isBlank()
                || fetchedAt == null
                || expiresAt == null
                || risk == null || risk.isBlank()
                || kid == null || kid.isBlank()
                || objectKey == null || objectKey.isBlank()) {
            throw new IllegalArgumentException(
                    "All Capsule metadata fields are required"
            );
        }

        if (!expiresAt.isAfter(fetchedAt)) {
            throw new IllegalArgumentException(
                    "Capsule expiry must be after its fetch time"
            );
        }

        if (bytesCapsule < 0) {
            throw new IllegalArgumentException(
                    "Capsule size must not be negative"
            );
        }
    }

    public record CapsuleMetadata(
            String id,
            String cacheKey,
            String chash,
            String objectKey,
            long bytesCapsule,
            Instant fetchedAt,
            Instant expiresAt,
            String risk,
            String kid
    ) {
    }
}