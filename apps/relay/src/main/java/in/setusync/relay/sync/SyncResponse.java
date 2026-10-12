package in.setusync.relay.sync;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.List;

public record SyncResponse(
        @JsonProperty("ready_capsules")
        List<JsonNode> readyCapsules,

        @JsonProperty("ticket_statuses")
        List<TicketStatus> ticketStatuses,

        List<JsonNode> revocations,

        @JsonProperty("key_updates")
        List<JsonNode> keyUpdates,

        List<WishlistService.WishlistItem> wishlist,

        @JsonProperty("server_time")
        Instant serverTime
) {

    public record TicketStatus(
            String ticketId,
            String state
    ) {
    }
}