import { describe, expect, it } from "vitest";
import {
  P2PExchange, P2PSession, decodeSignal, encodeSignal, makeQrFrames, FrameAssembler,
  type ChannelLike, type ExchangeProvider, type ManifestItem, type PeerConnectionLike,
} from "../src/index.js";

/** Two in-memory channel ends wired together (like an open WebRTC data channel). */
function channelPair(): [ChannelLike, ChannelLike] {
  const mk = (): ChannelLike => ({ readyState: "open", bufferedAmount: 0, send: () => undefined, onmessage: null, onopen: null, onclose: null });
  const a = mk(); const b = mk();
  a.send = (d) => { queueMicrotask(() => b.onmessage?.({ data: d })); };
  b.send = (d) => { queueMicrotask(() => a.onmessage?.({ data: d })); };
  return [a, b];
}

function provider(have: ManifestItem[], payload: Uint8Array | undefined, log: Uint8Array[]): ExchangeProvider {
  return {
    manifest: async () => have,
    build: async (peer) => (payload && peer.length === 0 ? [{ bytes: payload, count: 2 }] : []),
    receive: async (bytes) => { log.push(bytes); return { imported: 2, message: "Imported 2" }; },
  };
}

describe("WebRTC signalling over QR", () => {
  it("survives compression and the animated QR frame stream", async () => {
    const sdp = "v=0\r\n" + "a=candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host\r\n".repeat(6);
    const bytes = await encodeSignal("offer", sdp);
    const frames = await makeQrFrames(bytes);
    const asm = new FrameAssembler();
    for (const f of [...frames].reverse()) asm.add(f);
    expect(await decodeSignal(await asm.finish())).toEqual({ kind: "offer", sdp });
    expect(frames.length).toBeLessThanOrEqual(8);
  });

  it("rejects garbage codes", async () => {
    await expect(decodeSignal(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a SetuSync/);
  });
});

describe("peer exchange protocol", () => {
  it("sends a large pack in chunks to a peer that lacks it and finishes both ways", async () => {
    const big = new Uint8Array(100_000).map((_, i) => (i * 31) % 251);
    const [x, y] = channelPair();
    const gotY: Uint8Array[] = []; const gotX: Uint8Array[] = [];
    const a = new P2PExchange(x, provider([{ key: "k", id: "i", fetchedAt: "t" }], big, gotX));
    const b = new P2PExchange(y, provider([], undefined, gotY));
    const [ra, rb] = await Promise.all([a.run(), b.run()]);
    expect(ra.sent).toBe(2);
    expect(rb.received).toBe(2);
    expect(gotY).toHaveLength(1);
    expect(Buffer.compare(Buffer.from(gotY[0]!), Buffer.from(big))).toBe(0);
    expect(ra.received).toBe(0);
  });

  it("fails cleanly if the peer sends junk", async () => {
    const [x, y] = channelPair();
    const ex = new P2PExchange(x, provider([], undefined, []), () => undefined, 2000);
    const done = ex.run();
    y.send("not json");
    await expect(done).rejects.toThrow(/unexpected/);
  });

  it("fails if the connection closes early", async () => {
    const [x] = channelPair();
    const ex = new P2PExchange(x, provider([], undefined, []), () => undefined, 2000);
    const done = ex.run();
    queueMicrotask(() => x.onclose?.());
    await expect(done).rejects.toThrow(/closed/);
  });
});

/** Minimal fake of RTCPeerConnection: offer/answer carry an id that links the two ends. */
let registry = new Map<string, FakePc>();
class FakePc implements PeerConnectionLike {
  public iceGatheringState = "complete";
  public localDescription: { type: string; sdp: string } | null = null;
  public ondatachannel: ((e: { channel: ChannelLike }) => void) | null = null;
  private ch?: ChannelLike;
  private peer?: FakePc;
  private readonly id = Math.random().toString(36).slice(2);
  public createDataChannel(): ChannelLike { const [a, b] = channelPair(); a.readyState = "connecting"; this.ch = a; (this as unknown as { remote: ChannelLike }).remote = b; return a; }
  public async createOffer() { registry.set(this.id, this); return { type: "offer", sdp: `offer:${this.id}` }; }
  public async createAnswer() { return { type: "answer", sdp: `answer:${this.id}` }; }
  public async setLocalDescription(d: { type: string; sdp?: string }) { this.localDescription = { type: d.type, sdp: d.sdp ?? "" }; }
  public async setRemoteDescription(d: { type: string; sdp: string }) {
    if (d.type === "offer") { this.peer = registry.get(d.sdp.split(":")[1]!); }
    else { const guest = this; const host = guest; void host; }
  }
  public addEventListener(): void { /* ice already complete */ }
  public close(): void { /* nothing */ }
  public static link(host: FakePc, guest: FakePc): void {
    const remote = (host as unknown as { remote: ChannelLike }).remote;
    const local = host.ch!;
    local.readyState = "open"; local.onopen?.();
    guest.ondatachannel?.({ channel: remote });
  }
}

describe("P2PSession handshake (fake RTCPeerConnection)", () => {
  it("host offer -> guest answer -> host accepts -> both get an open channel", async () => {
    registry = new Map();
    const pcs: FakePc[] = [];
    const make = () => { const p = new FakePc(); pcs.push(p); return p; };
    const host = new P2PSession(make); const guest = new P2PSession(make);
    const offer = await host.createOffer();
    const answer = await guest.acceptOffer(offer);
    await host.acceptAnswer(answer);
    FakePc.link(pcs[0]!, pcs[1]!);
    const [hc, gc] = await Promise.all([host.channel(500), guest.channel(500)]);
    expect(hc.readyState).toBe("open");
    expect(gc.readyState).toBe("open");
  });

  it("refuses the wrong kind of code", async () => {
    registry = new Map();
    const guest = new P2PSession(() => new FakePc());
    await expect(guest.acceptOffer(await encodeSignal("answer", "x"))).rejects.toThrow(/reply code/);
  });
});
