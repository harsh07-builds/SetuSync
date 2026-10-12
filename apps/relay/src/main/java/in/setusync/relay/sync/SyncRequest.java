package in.setusync.relay.sync;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record SyncRequest(
        String install,
        List<OutboxItem> outbox,
        List<HeldCapsule> have,
        Budget budget,
        Profile profile,

        @JsonProperty("keyset_ver")
        long keysetVersion,

        @JsonProperty("client_time")
        Instant clientTime
) {

    public record OutboxItem(
            @JsonProperty("ikey")
            String idempotencyKey,

            Map<String, String> params,

            @JsonProperty("max_age_s")
            long maxAgeSeconds
    ) {
    }

    public record HeldCapsule(
            String key,

            @JsonProperty("capsule_id")
            String capsuleId,

            @JsonProperty("valid_until")
            Instant validUntil
    ) {
    }

    public record Budget(
            @JsonProperty("bytes_free")
            long bytesFree,

            @JsonProperty("good_link")
            boolean goodLink
    ) {
    }

    public record Profile(
            String district,
            String lang,
            String role
    ) {
    }
}