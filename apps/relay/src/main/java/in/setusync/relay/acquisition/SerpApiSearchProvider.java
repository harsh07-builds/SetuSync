package in.setusync.relay.acquisition;

import in.setusync.relay.domain.SearchRequest;
import org.springframework.stereotype.Component;
import serpapi.SerpApi;
import serpapi.SerpApiException;

import com.google.gson.JsonObject;

import java.util.HashMap;
import java.util.Map;

@Component
public class SerpApiSearchProvider implements SearchProvider {

    @Override
    public void preflight() {
        String apiKey = System.getenv("SERPAPI_KEY");

        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalStateException(
                    "The relay has no SerpApi key configured "
                            + "(set the SERPAPI_KEY environment variable)."
            );
        }
    }

    @Override
    public ProviderSubmission submit(SearchRequest request) {
        SerpApi client = createClient();

        Map<String, String> parameters =
                new HashMap<>(request.params());

        parameters.put("engine", request.engine());
        parameters.put("async", "true");

        try {
            JsonObject response = client.search(parameters);

            JsonObject metadata =
                    response.getAsJsonObject("search_metadata");

            String searchId =
                    metadata.get("id").getAsString();

            String status =
                    metadata.has("status")
                            ? metadata.get("status").getAsString()
                            : "";

            boolean completed =
                    ("Success".equalsIgnoreCase(status)
                            || "Cached".equalsIgnoreCase(status));

            return new ProviderSubmission(
                    searchId,
                    completed
            );

        } catch (SerpApiException e) {
            throw new IllegalStateException(
                    "SerpApi search submission failed: " + e.getMessage(),
                    e
            );
        }
    }

    @Override
    public ProviderResult getArchive(String providerSearchId) {
        SerpApi client = createClient();

        try {
            JsonObject response =
                    client.searchArchive(providerSearchId);

            JsonObject metadata =
                    response.getAsJsonObject("search_metadata");

            String status =
                    metadata.has("status")
                            ? metadata.get("status").getAsString()
                            : "";

            boolean ready =
                    ("Success".equalsIgnoreCase(status)
                            || "Cached".equalsIgnoreCase(status));

            return new ProviderResult(
                    providerSearchId,
                    response.toString(),
                    ready
            );

        } catch (SerpApiException e) {
            throw new IllegalStateException(
                    "SerpApi archive retrieval failed: " + e.getMessage(),
                    e
            );
        }
    }

    private SerpApi createClient() {
        String apiKey =
                System.getenv("SERPAPI_KEY");

        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalStateException(
                    "SERPAPI_KEY is not configured"
            );
        }

        Map<String, String> auth =
                new HashMap<>();

        auth.put("api_key", apiKey);

        return new SerpApi(auth);
    }
}
