import { gunzip, gzip } from "../pack/pack.js";

/**
 * WebRTC "signalling without a server": the offer and the answer are small text blobs.
 * They are compressed and shown as animated QR codes, so two phones can connect with
 * nothing but their cameras. (No STUN/TURN: it works on the same Wi-Fi or hotspot.)
 */
export type SignalKind = "offer" | "answer";

export async function encodeSignal(kind: SignalKind, sdp: string): Promise<Uint8Array> {
  return gzip(new TextEncoder().encode(JSON.stringify({ v: 1, k: kind, sdp })));
}

export async function decodeSignal(bytes: Uint8Array): Promise<{ kind: SignalKind; sdp: string }> {
  let parsed: { v?: unknown; k?: unknown; sdp?: unknown };
  try {
    parsed = JSON.parse(new TextDecoder().decode(await gunzip(bytes, 64 * 1024)));
  } catch {
    throw new Error("That QR code is not a SetuSync connection code.");
  }
  if (parsed.v !== 1 || (parsed.k !== "offer" && parsed.k !== "answer") || typeof parsed.sdp !== "string" || parsed.sdp.length > 20_000) {
    throw new Error("That QR code is not a SetuSync connection code.");
  }
  return { kind: parsed.k, sdp: parsed.sdp };
}
