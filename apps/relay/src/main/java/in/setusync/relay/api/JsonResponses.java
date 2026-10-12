package in.setusync.relay.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import in.setusync.relay.sync.SyncResponse;
import in.setusync.relay.sync.WishlistService;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Writes JSON responses that contain Jackson 2 tree nodes.
 *
 * Spring Boot 4 serializes HTTP bodies with Jackson 3 (tools.jackson).
 * The Relay's capsule documents are Jackson 2
 * (com.fasterxml.jackson.databind.JsonNode) trees. Jackson 3 does not
 * recognise those as JSON and would serialize them as plain beans
 * ("containerNode", "missingNode", "bigDecimal" ...), which breaks every
 * client. Any endpoint that returns a JsonNode must therefore render the
 * body to a String with the Jackson 2 mapper and return it as-is.
 */
@Component
public class JsonResponses {

    private static final MediaType JSON_UTF8 =
            new MediaType(
                    "application",
                    "json",
                    StandardCharsets.UTF_8
            );

    private final ObjectMapper mapper;

    public JsonResponses(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public ObjectNode object() {
        return mapper.createObjectNode();
    }

    public ResponseEntity<String> json(
            HttpStatus status,
            JsonNode body
    ) {
        return ResponseEntity
                .status(status)
                .contentType(JSON_UTF8)
                .body(body.toString());
    }

    public ResponseEntity<String> json(JsonNode body) {
        return json(HttpStatus.OK, body);
    }

    public ObjectNode syncBody(SyncResponse response) {
        ObjectNode root = mapper.createObjectNode();

        addAll(root.putArray("ready_capsules"), response.readyCapsules());
        addStatuses(root.putArray("ticket_statuses"), response);
        addAll(root.putArray("revocations"), response.revocations());
        addAll(root.putArray("key_updates"), response.keyUpdates());
        addWishlist(root.putArray("wishlist"), response.wishlist());

        if (response.serverTime() == null) {
            root.putNull("server_time");
        } else {
            root.put("server_time", response.serverTime().toString());
        }

        return root;
    }

    private void addAll(ArrayNode target, List<JsonNode> nodes) {
        if (nodes == null) {
            return;
        }

        for (JsonNode node : nodes) {
            if (node != null) {
                target.add(node);
            }
        }
    }

    private void addStatuses(
            ArrayNode target,
            SyncResponse response
    ) {
        if (response.ticketStatuses() == null) {
            return;
        }

        for (SyncResponse.TicketStatus status
                : response.ticketStatuses()) {
            ObjectNode item = target.addObject();
            item.put("ticketId", status.ticketId());
            item.put("state", status.state());
        }
    }

    private void addWishlist(
            ArrayNode target,
            List<WishlistService.WishlistItem> items
    ) {
        if (items == null) {
            return;
        }

        for (WishlistService.WishlistItem entry : items) {
            ObjectNode item = target.addObject();
            item.put("id", entry.id());
            item.put("sizeBytes", entry.sizeBytes());
            item.put("priority", entry.priority());
        }
    }
}
