package in.setusync.relay.protocol;

import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.Objects;

public final class MetadataPolicy {

    public static final String VERSION = "v1-conservative";
    public static final String RISK_UNKNOWN = "unknown";
    public static final boolean REVIEWED = false;

    private static final String MICRO_TEMPLATE =
            "Results were acquired from SerpApi and have not been independently reviewed by SetuSync.";

    private MetadataPolicy() {
    }

    public static void apply(ObjectNode meta, String language) {
        Objects.requireNonNull(meta, "meta must not be null");

        if (language == null || language.isBlank()) {
            throw new IllegalArgumentException("language must not be blank");
        }

        meta.put("risk", RISK_UNKNOWN);
        meta.put("reviewed", REVIEWED);
        meta.put("lang", language);
        meta.put("micro", MICRO_TEMPLATE);
        meta.put("meta_policy", VERSION);
    }
}
