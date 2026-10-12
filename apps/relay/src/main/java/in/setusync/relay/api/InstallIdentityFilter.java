
package in.setusync.relay.api;

import com.fasterxml.jackson.databind.ObjectMapper;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;

@Component
public class InstallIdentityFilter extends OncePerRequestFilter {

    public static final String HEADER_NAME =
            "X-SetuSync-Install-Id";

    public static final String ATTRIBUTE_NAME =
            "setusync.installId";

    private final ObjectMapper objectMapper;

    public InstallIdentityFilter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/v1/");
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            filterChain.doFilter(request, response);
            return;
        }

        String installIdHeader = request.getHeader(HEADER_NAME);

        if (installIdHeader == null || installIdHeader.isBlank()) {
            writeBadRequest(
                    response,
                    "INSTALL_ID_REQUIRED",
                    "Missing required X-SetuSync-Install-Id header."
            );
            return;
        }

        UUID installId;

        try {
            installId = UUID.fromString(installIdHeader);
        } catch (IllegalArgumentException exception) {
            writeBadRequest(
                    response,
                    "INSTALL_ID_INVALID",
                    "X-SetuSync-Install-Id must contain a valid UUID v4."
            );
            return;
        }

        if (installId.version() != 4 || installId.variant() != 2) {
            writeBadRequest(
                    response,
                    "INSTALL_ID_INVALID",
                    "X-SetuSync-Install-Id must contain a valid UUID v4."
            );
            return;
        }

        request.setAttribute(ATTRIBUTE_NAME, installId);

        filterChain.doFilter(request, response);
    }

    private void writeBadRequest(
            HttpServletResponse response,
            String errorCode,
            String message
    ) throws IOException {

        response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");

        objectMapper.writeValue(
                response.getOutputStream(),
                Map.of(
                        "error", errorCode,
                        "message", message
                )
        );
    }
}
