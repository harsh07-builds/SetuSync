package in.setusync.relay.sync;

import com.fasterxml.jackson.databind.JsonNode;
import in.setusync.relay.protocol.CapsuleRetrievalService;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class SyncService {

    private final Optional<CapsuleRetrievalService> capsuleRetrievalService;
    private final WishlistService wishlistService;

    public SyncService(
            Optional<CapsuleRetrievalService> capsuleRetrievalService,
            WishlistService wishlistService
    ) {
        this.capsuleRetrievalService =
                capsuleRetrievalService;
        this.wishlistService =
                wishlistService;
    }

    public SyncResponse synchronize(
            UUID installId,
            SyncRequest request
    ) {
        if (installId == null) {
            throw new IllegalArgumentException(
                    "Install ID is required"
            );
        }

        if (request == null) {
            throw new IllegalArgumentException(
                    "Sync request is required"
            );
        }

        List<JsonNode> readyCapsules =
                new ArrayList<>();

        if (request.have() != null &&
                capsuleRetrievalService.isPresent()) {

            CapsuleRetrievalService retrievalService =
                    capsuleRetrievalService.get();

            for (SyncRequest.HeldCapsule have :
                    request.have()) {

                if (have == null ||
                        have.capsuleId() == null ||
                        have.capsuleId().isBlank()) {
                    continue;
                }

                Optional<CapsuleRetrievalService.RetrievedCapsule>
                        retrieved =
                        retrievalService.getByCapsuleId(
                                have.capsuleId()
                        );

                if (retrieved.isPresent()) {
                    readyCapsules.add(
                            retrieved.get().document()
                    );
                }
            }
        }

        List<SyncResponse.TicketStatus>
                ticketStatuses =
                new ArrayList<>();

        List<WishlistService.WishlistItem>
                wishlist =
                wishlistService.select(
                        request
                );

        return new SyncResponse(
                readyCapsules,
                ticketStatuses,
                List.of(),
                List.of(),
                wishlist,
                Instant.now()
        );
    }
}