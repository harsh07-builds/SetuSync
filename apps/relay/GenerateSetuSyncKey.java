import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Base64;

public class GenerateSetuSyncKey {
    public static void main(String[] args) throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("Ed25519");
        KeyPair pair = generator.generateKeyPair();

        System.out.println("PRIVATE_PKCS8_B64=" +
                Base64.getEncoder().encodeToString(
                        pair.getPrivate().getEncoded()));

        System.out.println("PUBLIC_SPKI_B64=" +
                Base64.getEncoder().encodeToString(
                        pair.getPublic().getEncoded()));
    }
}
