
package in.setusync.relay.api;

import in.setusync.relay.persistence.RequestTicketRepository.IdempotencyConflictException;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(IdempotencyConflictException.class)
    public ResponseEntity<ApiError> handleIdempotencyConflict(
            IdempotencyConflictException exception
    ) {
        return ResponseEntity
                .status(HttpStatus.CONFLICT)
                .body(
                        new ApiError(
                                "IDEMPOTENCY_CONFLICT",
                                exception.getMessage(),
                                Instant.now()
                        )
                );
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiError> handleIllegalArgument(
            IllegalArgumentException exception
    ) {
        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(
                        new ApiError(
                                "BAD_REQUEST",
                                exception.getMessage() == null
                                        ? "Invalid request"
                                        : exception.getMessage(),
                                Instant.now()
                        )
                );
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ApiError> handleResponseStatus(
            ResponseStatusException exception
    ) {
        HttpStatus status = HttpStatus.valueOf(
                exception.getStatusCode().value()
        );

        String errorCode = switch (status) {
            case BAD_REQUEST -> "BAD_REQUEST";
            case NOT_FOUND -> "NOT_FOUND";
            case CONFLICT -> "CONFLICT";
            case TOO_MANY_REQUESTS -> "RATE_LIMITED";
            default -> "REQUEST_FAILED";
        };

        return ResponseEntity
                .status(status)
                .body(
                        new ApiError(
                                errorCode,
                                exception.getReason() == null
                                        ? "Request failed"
                                        : exception.getReason(),
                                Instant.now()
                        )
                );
    }

    public record ApiError(
            String code,
            String message,
            Instant timestamp
    ) {
    }
}
