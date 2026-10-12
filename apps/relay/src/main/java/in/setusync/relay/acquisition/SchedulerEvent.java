package in.setusync.relay.acquisition;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;

public record SchedulerEvent(
        String source,
        String detailType,
        Instant time,
        Detail detail
) {
    public record Detail(
            @JsonProperty("task")
            String task
    ) {
    }
}
