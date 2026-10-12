package in.setusync.relay.acquisition;

import in.setusync.relay.domain.SearchRequest;

public interface SearchProvider {

    /**
     * Cheap configuration check performed before any credit is reserved.
     * Throws IllegalStateException with a user-presentable message when
     * the provider cannot work (for example a missing API key).
     */
    default void preflight() {
    }

    ProviderSubmission submit(SearchRequest request);

    ProviderResult getArchive(String providerSearchId);
}
