// Generates the Ed25519 key pair the Relay uses to sign capsules.
// Usage: node scripts/generate-signing-key.mjs [kid]
// Paste the printed lines into .env (private key = secret, never commit).
import { generateKeyPairSync } from "node:crypto";

const kid =
  process.argv[2] ?? `relay-${new Date().toISOString().slice(0, 10)}`;

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const privateB64 = privateKey
  .export({ type: "pkcs8", format: "der" })
  .toString("base64");
const publicB64 = publicKey
  .export({ type: "spki", format: "der" })
  .toString("base64");

console.log(`SETUSYNC_SIGNING_KID=${kid}`);
console.log(`SETUSYNC_SIGNING_PRIVATE_KEY_PKCS8_B64=${privateB64}`);
console.log(`SETUSYNC_SIGNING_PUBLIC_KEY_SPKI_B64=${publicB64}`);
