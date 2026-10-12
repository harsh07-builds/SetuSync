import type { Capsule } from "@setusync/protocol";

import {
  CapsuleVerifier,
  type CapsuleVerificationResult,
} from "../verification/capsule-verifier.js";
import {
  Keyring,
  spkiToRawKey,
  type PublicKeyInfo,
} from "../keys/keyring.js";

export const PACK_FORMAT = "setusync-pack";
export const PACK_VERSION = 1;
export const PACK_FILE_EXTENSION = ".setupack";

/** Hard limits so a hostile file cannot exhaust a phone. */
export const PACK_LIMITS = {
  maxCapsules: 200,
  maxDecompressedBytes: 20 * 1024 * 1024,
} as const;

export interface CustodyHop {
  role: "origin" | "exporter" | "importer";
  at: string;
  label?: string;
}

export interface CapsulePack {
  format: typeof PACK_FORMAT;
  version: typeof PACK_VERSION;
  createdAt: string;
  capsules: Capsule[];
  /** Public keys the capsules were signed with. Untrusted until approved. */
  keys: PublicKeyInfo[];
  /** Informational chain of custody, keyed by capsule id (NOT signed). */
  custody: Record<string, CustodyHop[]>;
}

export class PackError extends Error {
  public readonly code:
    | "NOT_A_PACK"
    | "UNSUPPORTED_VERSION"
    | "TOO_LARGE"
    | "MALFORMED";

  public constructor(code: PackError["code"], message: string) {
    super(message);
    this.name = "PackError";
    this.code = code;
  }
}

export function buildPack(input: {
  capsules: readonly Capsule[];
  keys: readonly PublicKeyInfo[];
  custody?: Record<string, CustodyHop[]>;
  now?: Date;
}): CapsulePack {
  const kids = new Set(input.capsules.map((c) => c.kid));

  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    createdAt: (input.now ?? new Date()).toISOString(),
    capsules: [...input.capsules],
    keys: input.keys.filter((k) => kids.has(k.kid)),
    custody: input.custody ?? {},
  };
}

async function pipeThrough(
  bytes: Uint8Array,
  stream: GenericTransformStream,
  limit: number,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();

  // If the reader fails or cancels (corrupt data, size limit), the write
  // side rejects too. The reader already reports the real error, so these
  // must be swallowed or they surface as unhandled rejections.
  writer
    .write(bytes as BufferSource)
    .then(() => writer.close())
    .catch(() => undefined);
  writer.closed.catch(() => undefined);

  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > limit) {
      await reader.cancel();
      throw new PackError("TOO_LARGE", "Pack is larger than allowed.");
    }

    chunks.push(value as Uint8Array);
  }

  const out = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return out;
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(bytes, new CompressionStream("gzip"), Number.MAX_SAFE_INTEGER);
}

export async function gunzip(
  bytes: Uint8Array,
  limit: number = PACK_LIMITS.maxDecompressedBytes,
): Promise<Uint8Array> {
  return pipeThrough(bytes, new DecompressionStream("gzip"), limit);
}

/** gzip-compressed JSON. Typical lite packs shrink 3-5x. */
export async function encodePack(pack: CapsulePack): Promise<Uint8Array> {
  return gzip(new TextEncoder().encode(JSON.stringify(pack)));
}

export async function decodePack(bytes: Uint8Array): Promise<CapsulePack> {
  let json: Uint8Array;

  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      json = await gunzip(bytes);
    } catch (error) {
      if (error instanceof PackError) {
        throw error;
      }

      throw new PackError("NOT_A_PACK", "The file is damaged or not a SetuSync pack.");
    }
  } else {
    if (bytes.length > PACK_LIMITS.maxDecompressedBytes) {
      throw new PackError("TOO_LARGE", "Pack is larger than allowed.");
    }

    json = bytes;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new PackError("NOT_A_PACK", "The file is not a SetuSync pack.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { format?: unknown }).format !== PACK_FORMAT
  ) {
    throw new PackError("NOT_A_PACK", "The file is not a SetuSync pack.");
  }

  const pack = parsed as Partial<CapsulePack>;

  if (pack.version !== PACK_VERSION) {
    throw new PackError(
      "UNSUPPORTED_VERSION",
      "This pack was made by a newer version of SetuSync.",
    );
  }

  if (!Array.isArray(pack.capsules) || !Array.isArray(pack.keys)) {
    throw new PackError("MALFORMED", "The pack is missing its contents.");
  }

  if (pack.capsules.length > PACK_LIMITS.maxCapsules) {
    throw new PackError("TOO_LARGE", "The pack contains too many searches.");
  }

  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    createdAt: typeof pack.createdAt === "string" ? pack.createdAt : "",
    capsules: pack.capsules,
    keys: pack.keys,
    custody:
      typeof pack.custody === "object" && pack.custody !== null
        ? pack.custody
        : {},
  };
}

export interface PackCapsuleCheck {
  capsule: Capsule;
  verification: CapsuleVerificationResult;
}

export interface PackInspection {
  /** Capsules whose signature verified against a trusted key. */
  valid: PackCapsuleCheck[];
  /** Capsules that failed verification (tampered, bad key, wrong format). */
  invalid: PackCapsuleCheck[];
  /** Untrusted keys the user may approve (offered by the pack itself). */
  needsTrust: PublicKeyInfo[];
}

/**
 * Verifies every capsule in a pack against the device keyring.
 * Capsules signed by an unknown key are reported (never silently
 * accepted): `needsTrust` lists the keys the user could approve.
 */
export async function inspectPack(
  pack: CapsulePack,
  keyring: Keyring,
): Promise<PackInspection> {
  const verifier = new CapsuleVerifier(keyring.resolver);
  const valid: PackCapsuleCheck[] = [];
  const invalid: PackCapsuleCheck[] = [];
  const needsTrust = new Map<string, PublicKeyInfo>();

  for (const capsule of pack.capsules) {
    let verification: CapsuleVerificationResult;

    try {
      verification = await verifier.verify(capsule);
    } catch {
      verification = {
        valid: false,
        signatureValid: false,
        idValid: false,
        contentHashValid: false,
        reason: "Capsule could not be verified",
      };
    }

    if (verification.valid) {
      valid.push({ capsule, verification });
      continue;
    }

    invalid.push({ capsule, verification });

    if (
      verification.reason === "Unknown capsule key ID" &&
      typeof capsule?.kid === "string"
    ) {
      const offered = pack.keys.find((k) => k.kid === capsule.kid);

      if (
        offered !== undefined &&
        spkiToRawKey(offered.publicKeySpkiB64) !== undefined
      ) {
        needsTrust.set(offered.kid, offered);
      }
    }
  }

  return { valid, invalid, needsTrust: [...needsTrust.values()] };
}
