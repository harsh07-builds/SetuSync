package in.setusync.relay.acquisition;

public record ProviderResult(
        String providerSearchId,
        String rawJson,
        boolean ready
) {
}