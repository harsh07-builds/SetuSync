package in.setusync.relay.acquisition;

import in.setusync.relay.persistence.LedgerRepository;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class LedgerService {

    private final LedgerRepository repository;

    public LedgerService(LedgerRepository repository) {
        this.repository = repository;
    }

    public UUID recordAcquisitionOutcome(
            UUID jobId,
            String kind,
            int credits,
            int savedCredits,
            long bytesRaw,
            long bytesCapsule
    ) {
        if (jobId == null) {
            throw new IllegalArgumentException(
                    "Acquisition job ID must not be null"
            );
        }

        if (kind == null || kind.isBlank()) {
            throw new IllegalArgumentException(
                    "Ledger kind must not be blank"
            );
        }

        String note =
                "job_id=" + jobId;

        return repository.appendOnce(
                kind,
                credits,
                savedCredits,
                bytesRaw,
                bytesCapsule,
                note
        );
    }

    public UUID recordAcquisitionDeferred(
            UUID jobId,
            String reason
    ) {
        if (jobId == null) {
            throw new IllegalArgumentException(
                    "Acquisition job ID must not be null"
            );
        }

        String safeReason =
                reason == null || reason.isBlank()
                        ? "unspecified"
                        : reason
                                .replace('\n', ' ')
                                .replace('\r', ' ')
                                .trim();

        return repository.append(
                "ACQUISITION_DEFERRED",
                0,
                0,
                0,
                0,
                "job_id=" + jobId +
                        ";reason=" +
                        safeReason
        );
    }

    public UUID recordCacheHit(
            String cacheKey,
            long bytesRaw,
            long bytesCapsule
    ) {
        if (cacheKey == null || cacheKey.isBlank()) {
            throw new IllegalArgumentException(
                    "Cache key must not be blank"
            );
        }

        return repository.append(
                "CACHE_HIT",
                0,
                1,
                bytesRaw,
                bytesCapsule,
                "cache_key=" + cacheKey
        );
    }
}