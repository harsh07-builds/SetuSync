import { canonicalizeJson, type Capsule } from "@setusync/protocol";
import { gunzip, gzip, PackError, type CapsulePack, type CustodyHop, PACK_FORMAT, PACK_VERSION } from "../pack/pack.js";
import type { PublicKeyInfo } from "../keys/keyring.js";

/**
 * Delta capsules: send only what changed between two signed capsules of the same
 * search. The receiver rebuilds the full new capsule from the copy it already
 * holds, and the normal verification (content hash, id, Ed25519 signature) then
 * proves the rebuilt capsule is exactly what the Relay signed. A wrong or
 * tampered delta can therefore never be imported.
 */
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type Patch =
  | { t: "set"; v: Json }
  | { t: "obj"; s?: Record<string, Patch>; d?: string[] }
  | { t: "arr"; i: (number | { n: Json })[] };

export class DeltaError extends Error {
  public constructor(public readonly code: "BASE_MISMATCH" | "BAD_PATCH" | "RESULT_MISMATCH", message: string) {
    super(message);
    this.name = "DeltaError";
  }
}

const isObj = (v: unknown): v is { [k: string]: Json } => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: Json, b: Json): boolean => canonicalizeJson(a as never) === canonicalizeJson(b as never);
const size = (p: Patch): number => JSON.stringify(p).length;

function diff(base: Json, next: Json): Patch | undefined {
  if (same(base, next)) return undefined;
  const whole: Patch = { t: "set", v: next };

  if (isObj(base) && isObj(next)) {
    const s: Record<string, Patch> = {};
    for (const k of Object.keys(next)) {
      if (!(k in base)) s[k] = { t: "set", v: next[k] as Json };
      else {
        const p = diff(base[k] as Json, next[k] as Json);
        if (p) s[k] = p;
      }
    }
    const d = Object.keys(base).filter((k) => !(k in next));
    const patch: Patch = { t: "obj", ...(Object.keys(s).length ? { s } : {}), ...(d.length ? { d } : {}) };
    return size(patch) < size(whole) ? patch : whole;
  }

  if (Array.isArray(base) && Array.isArray(next)) {
    const index = new Map<string, number>();
    base.forEach((item, i) => {
      const key = canonicalizeJson(item as never);
      if (!index.has(key)) index.set(key, i);
    });
    const i = next.map((item): number | { n: Json } => index.get(canonicalizeJson(item as never)) ?? { n: item });
    const patch: Patch = { t: "arr", i };
    return size(patch) < size(whole) ? patch : whole;
  }

  return whole;
}

function apply(base: Json | undefined, patch: Patch): Json {
  if (patch.t === "set") return patch.v;

  if (patch.t === "obj") {
    if (!isObj(base)) throw new DeltaError("BAD_PATCH", "Delta expects an object here.");
    const out: { [k: string]: Json } = { ...base };
    for (const k of patch.d ?? []) delete out[k];
    for (const [k, p] of Object.entries(patch.s ?? {})) out[k] = apply(out[k], p);
    return out;
  }

  if (!Array.isArray(base)) throw new DeltaError("BAD_PATCH", "Delta expects a list here.");
  return patch.i.map((entry) => {
    if (typeof entry === "number") {
      if (!Number.isInteger(entry) || entry < 0 || entry >= base.length) throw new DeltaError("BAD_PATCH", "Delta points outside the saved list.");
      return base[entry] as Json;
    }
    return entry.n;
  });
}

export interface CapsuleDelta {
  v: 1;
  baseId: string;
  nextId: string;
  /** Everything in the signed envelope except the body (kid, alg, signature...). */
  envelope: Record<string, unknown>;
  patch: Patch;
}

/** undefined when the two capsules answer different searches. */
export function createDelta(base: Capsule, next: Capsule): CapsuleDelta | undefined {
  if (base.body.key !== next.body.key || base.body.id === next.body.id) return undefined;
  const { body, ...envelope } = next as unknown as { body: Json } & Record<string, unknown>;
  const patch = diff(base.body as unknown as Json, body) ?? { t: "set", v: body };
  return { v: 1, baseId: base.body.id, nextId: next.body.id, envelope, patch };
}

export function applyDelta(base: Capsule, delta: CapsuleDelta): Capsule {
  if (delta.v !== 1 || base.body.id !== delta.baseId) {
    throw new DeltaError("BASE_MISMATCH", "This update was made for a different earlier version.");
  }
  const body = apply(base.body as unknown as Json, delta.patch);
  const capsule = { ...delta.envelope, body } as unknown as Capsule;
  if (capsule.body.id !== delta.nextId) throw new DeltaError("RESULT_MISMATCH", "The rebuilt result does not match the update.");
  return capsule;
}

export const DELTA_PACK_FORMAT = "setusync-delta-pack";

export interface DeltaPack {
  format: typeof DELTA_PACK_FORMAT;
  version: 1;
  createdAt: string;
  deltas: CapsuleDelta[];
  keys: PublicKeyInfo[];
  /** Informational custody, keyed by the NEW capsule id. */
  custody: Record<string, CustodyHop[]>;
}

export async function encodeDeltaPack(pack: DeltaPack): Promise<Uint8Array> {
  return gzip(new TextEncoder().encode(JSON.stringify(pack)));
}

/** undefined when the bytes are not a delta pack (so the caller can try a normal pack). */
export async function decodeDeltaPack(bytes: Uint8Array): Promise<DeltaPack | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(await gunzip(bytes, 20 * 1024 * 1024)));
  } catch {
    return undefined;
  }
  if (!isObj(parsed as Json) || (parsed as { format?: unknown }).format !== DELTA_PACK_FORMAT) return undefined;
  const p = parsed as DeltaPack;
  if (p.version !== 1 || !Array.isArray(p.deltas) || !Array.isArray(p.keys)) {
    throw new PackError("MALFORMED", "This update file is damaged.");
  }
  return { ...p, custody: p.custody ?? {} };
}

export interface RebuildResult {
  pack: CapsulePack;
  rebuilt: number;
  missingBase: number;
  failed: number;
}

/** Turns a delta pack into an ordinary full pack that the normal import path verifies. */
export async function rebuildFullPack(
  dp: DeltaPack,
  findBase: (id: string) => Promise<Capsule | undefined>,
): Promise<RebuildResult> {
  const capsules: Capsule[] = [];
  let missingBase = 0;
  let failed = 0;
  for (const delta of dp.deltas) {
    const base = await findBase(delta.baseId);
    if (!base) { missingBase += 1; continue; }
    try { capsules.push(applyDelta(base, delta)); } catch { failed += 1; }
  }
  return {
    pack: { format: PACK_FORMAT, version: PACK_VERSION, createdAt: dp.createdAt, capsules, keys: dp.keys, custody: dp.custody },
    rebuilt: capsules.length,
    missingBase,
    failed,
  };
}
