package in.setusync.relay.protocol;

import in.setusync.relay.persistence.KeysetRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * Registers the public half of the signing key on startup.
 *
 * Capsule compilation needs exactly one ACTIVE Ed25519 key in the
 * keyset table plus the matching private key in
 * SETUSYNC_SIGNING_PRIVATE_KEY_PKCS8_B64. Nothing else in the Relay
 * inserts that row, so without this a fresh deployment can accept
 * searches but never produce a Capsule. Set:
 *
 *   SETUSYNC_SIGNING_KID                 e.g. relay-2026-10
 *   SETUSYNC_SIGNING_PUBLIC_KEY_SPKI_B64 from GenerateSetuSyncKey
 *
 * The step is idempotent: if that kid is already ACTIVE nothing changes.
 * If a different kid is ACTIVE it is retired and the configured one
 * becomes ACTIVE (key rotation).
 */
@Component
public class SigningKeyBootstrap implements ApplicationRunner {

    private static final Logger log =
            LoggerFactory.getLogger(SigningKeyBootstrap.class);

    private final KeysetRepository keysetRepository;
    private final String kid;
    private final String publicKeySpkiB64;

    public SigningKeyBootstrap(
            KeysetRepository keysetRepository,
            @Value("${setusync.signing.kid:}") String kid,
            @Value("${setusync.signing.public-key-spki-b64:}")
            String publicKeySpkiB64
    ) {
        this.keysetRepository = keysetRepository;
        this.kid = kid == null ? "" : kid.trim();
        this.publicKeySpkiB64 =
                publicKeySpkiB64 == null ? "" : publicKeySpkiB64.trim();
    }

    @Override
    public void run(ApplicationArguments args) {
        if (kid.isEmpty() || publicKeySpkiB64.isEmpty()) {
            if (keysetRepository.findActive().isEmpty()) {
                log.warn(
                        "No ACTIVE signing key is registered and "
                                + "SETUSYNC_SIGNING_KID / "
                                + "SETUSYNC_SIGNING_PUBLIC_KEY_SPKI_B64 "
                                + "are not set. Searches will be accepted "
                                + "but no Capsule can be signed."
                );
            }
            return;
        }

        var active = keysetRepository.findActive();

        if (active.isPresent()
                && kid.equals(active.get().kid())) {
            log.info("Signing key {} is already ACTIVE", kid);
            return;
        }

        try {
            keysetRepository.activateNewKey(kid, publicKeySpkiB64);
            log.info("Registered signing key {} as ACTIVE", kid);
        } catch (RuntimeException exception) {
            log.error(
                    "Could not register signing key {}. If this kid "
                            + "was used before, choose a new kid.",
                    kid,
                    exception
            );
        }
    }
}
