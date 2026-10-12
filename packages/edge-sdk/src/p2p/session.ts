import { decodeSignal, encodeSignal } from "./signal.js";
import type { ChannelLike } from "./exchange.js";

/** The small part of RTCPeerConnection we use (so tests can fake it). */
export interface PeerConnectionLike {
  iceGatheringState: string;
  localDescription: { type: string; sdp: string } | null;
  createDataChannel(label: string): ChannelLike;
  createOffer(): Promise<{ type: string; sdp?: string }>;
  createAnswer(): Promise<{ type: string; sdp?: string }>;
  setLocalDescription(d: { type: string; sdp?: string }): Promise<void>;
  setRemoteDescription(d: { type: string; sdp: string }): Promise<void>;
  addEventListener(type: string, listener: (event: never) => void): void;
  ondatachannel: ((event: { channel: ChannelLike }) => void) | null;
  close(): void;
}

function waitForIce(pc: PeerConnectionLike, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const timer = setTimeout(resolve, timeoutMs); // use whatever candidates exist by then
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") { clearTimeout(timer); resolve(); }
    });
  });
}

/**
 * Two phones on the same Wi-Fi or hotspot: host.createOffer() -> guest.acceptOffer()
 * -> host.acceptAnswer(). Each blob travels as an animated QR code.
 */
export class P2PSession {
  private pc: PeerConnectionLike | undefined = undefined;
  private channelPromise?: Promise<ChannelLike>;

  public constructor(
    private readonly factory: () => PeerConnectionLike = () => new RTCPeerConnection({ iceServers: [] }) as unknown as PeerConnectionLike,
    private readonly iceTimeoutMs = 4000,
  ) {}

  public async createOffer(): Promise<Uint8Array> {
    const pc = (this.pc = this.factory());
    const channel = pc.createDataChannel("setusync");
    this.channelPromise = new Promise((resolve) => {
      if (channel.readyState === "open") resolve(channel);
      else channel.onopen = () => resolve(channel);
    });
    await pc.setLocalDescription(await pc.createOffer());
    await waitForIce(pc, this.iceTimeoutMs);
    return encodeSignal("offer", pc.localDescription?.sdp ?? "");
  }

  public async acceptOffer(bytes: Uint8Array): Promise<Uint8Array> {
    const signal = await decodeSignal(bytes);
    if (signal.kind !== "offer") throw new Error("This is a reply code. Scan the host's first code instead.");
    const pc = (this.pc = this.factory());
    this.channelPromise = new Promise((resolve) => {
      pc.ondatachannel = (event) => resolve(event.channel);
    });
    await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitForIce(pc, this.iceTimeoutMs);
    return encodeSignal("answer", pc.localDescription?.sdp ?? "");
  }

  public async acceptAnswer(bytes: Uint8Array): Promise<void> {
    const signal = await decodeSignal(bytes);
    if (signal.kind !== "answer" || !this.pc) throw new Error("This is not the other phone's reply code.");
    await this.pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
  }

  public channel(timeoutMs = 30_000): Promise<ChannelLike> {
    if (!this.channelPromise) return Promise.reject(new Error("Start the connection first."));
    return Promise.race([
      this.channelPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Could not connect. Make sure both phones are on the same Wi-Fi or hotspot.")), timeoutMs)),
    ]);
  }

  public close(): void { try { this.pc?.close(); } catch { /* already closed */ } this.pc = undefined; }
}
