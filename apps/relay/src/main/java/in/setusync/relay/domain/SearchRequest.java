package in.setusync.relay.domain;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

public record SearchRequest(
        String engine,
        Map<String, String> params,

        @JsonProperty("max_age_s")
        long maxAgeS,

        @JsonProperty("wait_ms")
        long waitMs,

        Accept accept
) {
    public record Accept(
            boolean lite,
            boolean full
    ) {
    }
}