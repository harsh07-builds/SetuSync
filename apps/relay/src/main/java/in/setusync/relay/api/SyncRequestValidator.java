package in.setusync.relay.api;

import in.setusync.relay.sync.SyncRequest;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
public class SyncRequestValidator {

    public void validate(
            SyncRequest request,
            UUID authenticatedInstallId
    ) {
        if (request == null) {
            throw new IllegalArgumentException(
                    "Sync request must not be null"
            );
        }

        if (authenticatedInstallId == null) {
            throw new IllegalArgumentException(
                    "Authenticated install ID is required"
            );
        }

        if (request.install() == null
                || request.install().isBlank()) {
            throw new IllegalArgumentException(
                    "Sync install is required"
            );
        }

        UUID requestedInstall;

        try {
            requestedInstall =
                    UUID.fromString(request.install());
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException(
                    "Sync install must be a valid UUID"
            );
        }

        if (!authenticatedInstallId.equals(requestedInstall)) {
            throw new IllegalArgumentException(
                    "Sync install does not match authenticated install"
            );
        }

        if (request.outbox() == null) {
            throw new IllegalArgumentException(
                    "Sync outbox must not be null"
            );
        }

        if (request.have() == null) {
            throw new IllegalArgumentException(
                    "Sync have list must not be null"
            );
        }

        if (request.budget() == null) {
            throw new IllegalArgumentException(
                    "Sync budget must not be null"
            );
        }

        if (request.budget().bytesFree() < 0) {
            throw new IllegalArgumentException(
                    "Sync budget bytes_free must not be negative"
            );
        }

        if (request.profile() == null) {
            throw new IllegalArgumentException(
                    "Sync profile must not be null"
            );
        }

        if (request.keysetVersion() < 0) {
            throw new IllegalArgumentException(
                    "Sync keyset_ver must not be negative"
            );
        }

        if (request.clientTime() == null) {
            throw new IllegalArgumentException(
                    "Sync client_time is required"
            );
        }
    }
}