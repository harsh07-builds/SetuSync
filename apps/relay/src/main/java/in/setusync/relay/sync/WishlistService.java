package in.setusync.relay.sync;

import in.setusync.relay.persistence.CapsuleRepository;
import in.setusync.relay.persistence.CapsuleRepository.CapsuleMetadata;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
public class WishlistService {

    private static final int MAX_CANDIDATES = 200;

    private final CapsuleRepository capsuleRepository;

    public WishlistService(
            CapsuleRepository capsuleRepository
    ) {
        this.capsuleRepository =
                capsuleRepository;
    }

    public List<WishlistItem> select(
            SyncRequest request
    ) {
        if (request == null) {
            throw new IllegalArgumentException(
                    "Sync request is required"
            );
        }

        long budget =
                request.budget() == null
                        ? 0
                        : request.budget().bytesFree();

        if (budget <= 0) {
            return List.of();
        }

        Set<String> heldIds =
                new HashSet<>();

        if (request.have() != null) {
            request.have().forEach(
                    held -> {
                        if (held != null
                                && held.capsuleId() != null) {
                            heldIds.add(
                                    held.capsuleId()
                            );
                        }
                    }
            );
        }

        Instant now =
                Instant.now();

        List<CapsuleMetadata> candidates =
                capsuleRepository
                        .findWishlistCandidates(
                                now,
                                MAX_CANDIDATES
                        );

        return candidates.stream()
                .filter(
                        candidate ->
                                !heldIds.contains(
                                        candidate.id()
                                )
                )
                .filter(
                        candidate ->
                                candidate.bytesCapsule() > 0
                )
                .map(
                        candidate ->
                                score(
                                        candidate,
                                        request,
                                        now
                                )
                )
                .sorted(
                        (left, right) ->
                                Double.compare(
                                        right.priority(),
                                        left.priority()
                                )
                )
                .collect(
                        java.util.stream.Collectors
                                .collectingAndThen(
                                        java.util.stream.Collectors
                                                .toList(),
                                        ranked ->
                                                fitBudget(
                                                        ranked,
                                                        budget
                                                )
                                )
                );
    }

    private WishlistItem score(
            CapsuleMetadata candidate,
            SyncRequest request,
            Instant now
    ) {
        double freshness =
                freshnessScore(
                        candidate,
                        now
                );

        double risk =
                riskScore(
                        candidate.risk()
                );

        /*
         * Profile fields are deliberately coarse. The current Capsule
         * authority schema does not persist a separate audience/profile
         * classification, so we do not fabricate a district/role match.
         *
         * A neutral locality factor keeps the contract deterministic
         * until profile-indexed acquisition plans are introduced.
         */
        double locality = 1.0d;

        double linkFactor =
                request.budget() != null
                        && request.budget().goodLink()
                        ? 1.0d
                        : 0.75d;

        double bytes =
                Math.max(
                        1L,
                        candidate.bytesCapsule()
                );

        double priority =
                (
                        freshness *
                        risk *
                        locality *
                        linkFactor
                ) / bytes;

        return new WishlistItem(
                candidate.id(),
                candidate.bytesCapsule(),
                priority
        );
    }

    private double freshnessScore(
            CapsuleMetadata candidate,
            Instant now
    ) {
        long remaining =
                Duration.between(
                        now,
                        candidate.expiresAt()
                ).getSeconds();

        if (remaining <= 0) {
            return 0.0d;
        }

        /*
         * Prefer capsules that will expire sooner, because they provide
         * more immediate locality value before another acquisition is
         * needed.
         */
        return 1.0d /
                Math.max(
                        1.0d,
                        remaining
                );
    }

    private double riskScore(
            String risk
    ) {
        if (risk == null) {
            return 0.5d;
        }

        return switch (
                risk.toLowerCase()
        ) {
            case "blocked",
                 "live_required" -> 0.0d;

            case "review" -> 0.25d;

            case "unknown" -> 0.75d;

            default -> 1.0d;
        };
    }

    private List<WishlistItem> fitBudget(
            List<WishlistItem> ranked,
            long budget
    ) {
        long used = 0;

        java.util.ArrayList<WishlistItem> result =
                new java.util.ArrayList<>();

        for (WishlistItem item : ranked) {
            long size =
                    item.sizeBytes();

            if (size <= 0) {
                continue;
            }

            if (size > budget - used) {
                continue;
            }

            used += size;
            result.add(item);
        }

        return List.copyOf(result);
    }

    public record WishlistItem(
            String id,

            long sizeBytes,

            double priority
    ) {
    }
}