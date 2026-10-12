import type { CapsulePublicKeyResolver } from "../verification/capsule-verifier.js";

/** Minimal storage contract (localStorage satisfies it). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  public removeItem(key: string): void {
    this.data.delete(key);
  }
}

/** localStorage when it works (it can throw in private mode), else memory. */
export function safeLocalStorage(): KeyValueStorage {
  try {
    const probe = "__setusync_probe__";
    globalThis.localStorage.setItem(probe, "1");
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    return new MemoryStorage();
  }
}

export interface PublicKeyInfo {
  kid: string;
  alg: "Ed25519";
  publicKeySpkiB64: string;
  status?: string;
}

export interface TrustedKey extends PublicKeyInfo {
  fingerprint: string;
  trustedAt: string;
  source: "relay" | "user";
}

export type TrustResult =
  | { ok: true; key: TrustedKey; alreadyTrusted: boolean }
  | { ok: false; reason: "INVALID_KEY" | "KEY_CONFLICT" };

// DER prefix of an Ed25519 SubjectPublicKeyInfo (12 bytes) + 32-byte key.
const SPKI_PREFIX = "302a300506032b6570032100";

function fromBase64(value: string): Uint8Array | undefined {
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  } catch {
    return undefined;
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Raw 32-byte Ed25519 key from an SPKI blob, or undefined if malformed. */
export function spkiToRawKey(spkiB64: string): Uint8Array | undefined {
  const bytes = fromBase64(spkiB64);

  if (bytes === undefined || bytes.length !== 44) {
    return undefined;
  }

  if (toHex(bytes.subarray(0, 12)) !== SPKI_PREFIX) {
    return undefined;
  }

  return bytes.slice(12);
}

/** Human-comparable fingerprint, e.g. "9f2c-81aa-03de-b417". */
export async function keyFingerprint(spkiB64: string): Promise<string> {
  const bytes = fromBase64(spkiB64) ?? new Uint8Array();
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes as BufferSource),
  );

  return (toHex(digest).slice(0, 16).match(/.{4}/gu) ?? []).join("-");
}

/**
 * Keys this device trusts to sign capsules.
 *
 * Trust comes from two places: keys fetched directly from the Relay
 * (trust on first use, protected by HTTPS) and keys the user explicitly
 * approves after comparing the fingerprint when importing a pack from a
 * stranger. A kid can never be re-bound to a different key.
 */
export class Keyring {
  private readonly storage: KeyValueStorage;
  private readonly storageKey: string;
  private keys: Map<string, TrustedKey>;

  public constructor(
    storage: KeyValueStorage,
    storageKey = "setusync.keyring.v1",
  ) {
    this.storage = storage;
    this.storageKey = storageKey;
    this.keys = new Map();

    try {
      const raw = storage.getItem(storageKey);
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);

      if (Array.isArray(parsed)) {
        for (const entry of parsed as TrustedKey[]) {
          if (entry && typeof entry.kid === "string") {
            this.keys.set(entry.kid, entry);
          }
        }
      }
    } catch {
      this.keys = new Map();
    }
  }

  public list(): TrustedKey[] {
    return [...this.keys.values()];
  }

  public has(kid: string): boolean {
    return this.keys.has(kid);
  }

  public get(kid: string): TrustedKey | undefined {
    return this.keys.get(kid);
  }

  public async trust(
    info: PublicKeyInfo,
    source: "relay" | "user",
    now: () => Date = () => new Date(),
  ): Promise<TrustResult> {
    if (info.alg !== "Ed25519" || spkiToRawKey(info.publicKeySpkiB64) === undefined) {
      return { ok: false, reason: "INVALID_KEY" };
    }

    const existing = this.keys.get(info.kid);

    if (existing !== undefined) {
      return existing.publicKeySpkiB64 === info.publicKeySpkiB64
        ? { ok: true, key: existing, alreadyTrusted: true }
        : { ok: false, reason: "KEY_CONFLICT" };
    }

    const key: TrustedKey = {
      kid: info.kid,
      alg: "Ed25519",
      publicKeySpkiB64: info.publicKeySpkiB64,
      fingerprint: await keyFingerprint(info.publicKeySpkiB64),
      trustedAt: now().toISOString(),
      source,
    };

    this.keys.set(key.kid, key);
    this.persist();

    return { ok: true, key, alreadyTrusted: false };
  }

  public readonly resolver: CapsulePublicKeyResolver = (kid) => {
    const key = this.keys.get(kid);
    return key === undefined ? undefined : spkiToRawKey(key.publicKeySpkiB64);
  };

  private persist(): void {
    try {
      this.storage.setItem(
        this.storageKey,
        JSON.stringify([...this.keys.values()]),
      );
    } catch {
      // Keys stay valid for this session even if they can't be saved.
    }
  }
}

/** Fetches the Relay's public keys (GET /v1/keys). */
export async function fetchRelayKeys(
  baseUrl: string,
  installId: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  signal?: AbortSignal,
): Promise<PublicKeyInfo[]> {
  const response = await fetchImpl(
    `${baseUrl.replace(/\/+$/, "")}/v1/keys`,
    {
      headers: { "X-SetuSync-Install-Id": installId },
      ...(signal === undefined ? {} : { signal }),
    },
  );

  if (!response.ok) {
    throw new Error(`Relay answered HTTP ${response.status} for /v1/keys`);
  }

  const body = (await response.json()) as { keys?: unknown };

  if (!Array.isArray(body.keys)) {
    throw new Error("Relay key list is malformed");
  }

  return (body.keys as PublicKeyInfo[]).filter(
    (k) =>
      typeof k?.kid === "string" &&
      k.alg === "Ed25519" &&
      typeof k.publicKeySpkiB64 === "string",
  );
}
