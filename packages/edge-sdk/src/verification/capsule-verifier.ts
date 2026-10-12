import type { Capsule, CapsuleBody } from "@setusync/protocol";
import {
  canonicalizeJson,
  computeCapsuleId,
  computeContentHash,
} from "@setusync/protocol";

export type CapsulePublicKey = Uint8Array;

export type CapsulePublicKeyResolver = (
  kid: string,
) =>
  | CapsulePublicKey
  | undefined
  | Promise<CapsulePublicKey | undefined>;

export interface CapsuleVerificationResult {
  valid: boolean;
  signatureValid: boolean;
  idValid: boolean;
  contentHashValid: boolean;
  reason?: string;
}

function base64UrlToBytes(
  value: string,
): Uint8Array | undefined {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padding =
    "=".repeat((4 - (normalized.length % 4)) % 4);

  let binary: string;

  try {
    binary = atob(normalized + padding);
  } catch {
    return undefined;
  }

  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function bytesToArrayBuffer(
  bytes: Uint8Array,
): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function bodyWithoutId(
  body: CapsuleBody,
): Omit<CapsuleBody, "id"> {
  const { id: _id, ...rest } = body;
  return rest;
}

export class CapsuleVerifier {
  private readonly keyResolver: CapsulePublicKeyResolver;

  public constructor(
    keyResolver: CapsulePublicKeyResolver,
  ) {
    this.keyResolver = keyResolver;
  }

  public async verify(
    capsule: Capsule,
  ): Promise<CapsuleVerificationResult> {
    if (capsule.v !== 1) {
      return {
        valid: false,
        signatureValid: false,
        idValid: false,
        contentHashValid: false,
        reason: "Unsupported capsule version",
      };
    }

    if (capsule.alg !== "Ed25519") {
      return {
        valid: false,
        signatureValid: false,
        idValid: false,
        contentHashValid: false,
        reason: "Unsupported capsule signature algorithm",
      };
    }

    const expectedContentHash =
      computeContentHash(capsule.body);

    const contentHashValid =
      expectedContentHash === capsule.body.chash;

    if (!contentHashValid) {
      return {
        valid: false,
        signatureValid: false,
        idValid: false,
        contentHashValid,
        reason: "Capsule content hash mismatch",
      };
    }

    const expectedId = computeCapsuleId(
      bodyWithoutId(capsule.body),
    );

    const idValid =
      expectedId === capsule.body.id;

    if (!idValid) {
      return {
        valid: false,
        signatureValid: false,
        idValid,
        contentHashValid,
        reason: "Capsule ID mismatch",
      };
    }

    const publicKey =
      await this.keyResolver(capsule.kid);

    if (publicKey === undefined) {
      return {
        valid: false,
        signatureValid: false,
        idValid,
        contentHashValid,
        reason: "Unknown capsule key ID",
      };
    }

    if (publicKey.byteLength !== 32) {
      return {
        valid: false,
        signatureValid: false,
        idValid,
        contentHashValid,
        reason: "Invalid Ed25519 public key length",
      };
    }

    const publicKeyBuffer =
      bytesToArrayBuffer(publicKey);

    const signature =
      base64UrlToBytes(capsule.sig);

    if (signature === undefined) {
      return {
        valid: false,
        signatureValid: false,
        idValid,
        contentHashValid,
        reason: "Malformed capsule signature encoding",
      };
    }

    if (signature.byteLength !== 64) {
      return {
        valid: false,
        signatureValid: false,
        idValid,
        contentHashValid,
        reason: "Invalid Ed25519 signature length",
      };
    }

    const canonicalBody =
      canonicalizeJson(capsule.body);

    const message =
      new TextEncoder().encode(canonicalBody);

    const cryptoKey =
      await crypto.subtle.importKey(
        "raw",
        publicKeyBuffer,
        {
          name: "Ed25519",
        },
        false,
        ["verify"],
      );

    const signatureValid =
      await crypto.subtle.verify(
        {
          name: "Ed25519",
        },
        cryptoKey,
        bytesToArrayBuffer(signature),
        bytesToArrayBuffer(message),
      );

    return {
      valid:
        signatureValid &&
        idValid &&
        contentHashValid,
      signatureValid,
      idValid,
      contentHashValid,
      ...(signatureValid
        ? {}
        : {
            reason: "Invalid capsule signature",
          }),
    };
  }
}