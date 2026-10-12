package in.setusync.relay.protocol;

import in.setusync.relay.persistence.KeysetRepository;
import in.setusync.relay.persistence.KeysetRepository.SigningPublicKey;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

@Component
public class CapsuleSigningService {

    private static final String PRIVATE_KEY_ENV =
            "SETUSYNC_SIGNING_PRIVATE_KEY_PKCS8_B64";

    private final KeysetRepository keysetRepository;

    public CapsuleSigningService(
            KeysetRepository keysetRepository
    ) {
        this.keysetRepository = keysetRepository;
    }

    public SignedCapsuleSignature signCanonicalBody(
            String canonicalBody
    ) {
        if (canonicalBody == null || canonicalBody.isBlank()) {
            throw new IllegalArgumentException(
                    "Canonical Capsule body must not be blank"
            );
        }

        SigningPublicKey activeKey = keysetRepository.findActive()
                .orElseThrow(() -> new IllegalStateException(
                        "No ACTIVE Ed25519 public key is registered"
                ));

        if (!"Ed25519".equals(activeKey.algorithm())
                || !"ACTIVE".equals(activeKey.status())) {
            throw new IllegalStateException(
                    "The registered signing key is not an active Ed25519 key"
            );
        }

        String encodedPrivateKey =
                System.getenv(PRIVATE_KEY_ENV);

        if (encodedPrivateKey == null
                || encodedPrivateKey.isBlank()) {
            throw new IllegalStateException(
                    "Required signing secret is not configured: "
                            + PRIVATE_KEY_ENV
            );
        }

        try {
            KeyFactory keyFactory =
                    KeyFactory.getInstance("Ed25519");

            byte[] privateKeyBytes =
                    Base64.getDecoder().decode(encodedPrivateKey.strip());

            PrivateKey privateKey = keyFactory.generatePrivate(
                    new PKCS8EncodedKeySpec(privateKeyBytes)
            );

            byte[] publicKeyBytes = Base64.getDecoder().decode(
                    activeKey.publicKeySpkiB64()
            );

            PublicKey publicKey = keyFactory.generatePublic(
                    new X509EncodedKeySpec(publicKeyBytes)
            );

            byte[] message =
                    canonicalBody.getBytes(StandardCharsets.UTF_8);

            Signature signer = Signature.getInstance("Ed25519");
            signer.initSign(privateKey);
            signer.update(message);

            byte[] signatureBytes = signer.sign();

            // Verify the signature against the public key registered
            // for the active key ID before returning it.
            Signature verifier = Signature.getInstance("Ed25519");
            verifier.initVerify(publicKey);
            verifier.update(message);

            if (!verifier.verify(signatureBytes)) {
                throw new IllegalStateException(
                        "Signing private key does not match the ACTIVE "
                                + "public key registered for kid: "
                                + activeKey.kid()
                );
            }

            String signatureBase64Url =
                    Base64.getUrlEncoder()
                            .withoutPadding()
                            .encodeToString(signatureBytes);

            return new SignedCapsuleSignature(
                    activeKey.kid(),
                    "Ed25519",
                    signatureBase64Url
            );

        } catch (IllegalStateException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalStateException(
                    "Could not sign Capsule using Ed25519",
                    exception
            );
        }
    }

    public record SignedCapsuleSignature(
            String kid,
            String algorithm,
            String signature
    ) {
    }
}