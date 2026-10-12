/**
 * What two phones say to each other over the WebRTC data channel.
 *
 *   hello  -> my list of searches (key, id, fetched_at)
 *   pack.. -> for each part: "pack", numbered "chunk"s, "end"
 *   done   -> I have nothing more to send
 *
 * The bytes that arrive are handed to `provider.receive`, which runs the normal
 * verified import (signature check, key trust). The channel itself is NOT trusted.
 */
export interface ManifestItem { key: string; id: string; fetchedAt: string }
export interface PackPart { bytes: Uint8Array; count: number }

export interface ChannelLike {
  readyState: string;
  bufferedAmount: number;
  bufferedAmountLowThreshold?: number;
  send(data: string): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror?: ((event: unknown) => void) | null;
}

export interface ExchangeProvider {
  manifest(): Promise<ManifestItem[]>;
  /** What the peer is missing, given what the peer has. May be several packs (full and delta). */
  build(peer: ManifestItem[]): Promise<PackPart[]>;
  receive(bytes: Uint8Array): Promise<{ imported: number; message: string }>;
}

export interface ExchangeResult { sent: number; received: number; messages: string[] }

const CHUNK_BYTES = 9 * 1024; // ~12 KB of text per message, safe for every browser
const MAX_PART_BYTES = 20 * 1024 * 1024;
const MAX_PARTS = 4;
const BUFFER_HIGH = 1024 * 1024;

const toB64 = (b: Uint8Array): string => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (t: string): Uint8Array => { const s = atob(t); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };

export class P2PExchange {
  private sent = 0;
  private received = 0;
  private readonly messages: string[] = [];
  private peerDone = false;
  private sentDone = false;
  private incoming: { n: number; chunks: Uint8Array[] } | undefined = undefined;
  private partsSeen = 0;
  private queue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly channel: ChannelLike,
    private readonly provider: ExchangeProvider,
    private readonly onStatus: (text: string) => void = () => undefined,
    private readonly timeoutMs = 120_000,
  ) {}

  public run(): Promise<ExchangeResult> {
    return new Promise<ExchangeResult>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The other phone stopped responding.")), this.timeoutMs);
      const finish = (): void => {
        if (this.peerDone && this.sentDone) { clearTimeout(timer); resolve({ sent: this.sent, received: this.received, messages: this.messages }); }
      };
      const fail = (error: unknown): void => { clearTimeout(timer); reject(error instanceof Error ? error : new Error("Transfer failed.")); };

      this.channel.onclose = () => { if (!(this.peerDone && this.sentDone)) fail(new Error("The connection closed before the transfer finished.")); };
      this.channel.onmessage = (event) => {
        // Messages are handled strictly one after another.
        this.queue = this.queue.then(() => this.handle(event.data)).then(finish).catch(fail);
      };

      const start = async (): Promise<void> => {
        this.onStatus("Connected. Comparing saved searches...");
        this.channel.send(JSON.stringify({ t: "hello", v: 1, manifest: await this.provider.manifest() }));
      };
      if (this.channel.readyState === "open") void start().catch(fail);
      else this.channel.onopen = () => { void start().catch(fail); };
    });
  }

  private async handle(raw: unknown): Promise<void> {
    if (typeof raw !== "string" || raw.length > 40_000) throw new Error("The other phone sent something unexpected.");
    let m: { t?: string; manifest?: unknown; n?: unknown; i?: unknown; d?: unknown };
    try { m = JSON.parse(raw); } catch { throw new Error("The other phone sent something unexpected."); }

    switch (m.t) {
      case "hello": {
        if (!Array.isArray(m.manifest) || m.manifest.length > 5000) throw new Error("Bad list from the other phone.");
        const peer = (m.manifest as ManifestItem[]).filter((x) => typeof x?.key === "string" && typeof x?.id === "string" && typeof x?.fetchedAt === "string");
        const parts = (await this.provider.build(peer)).slice(0, MAX_PARTS);
        for (const part of parts) await this.sendPart(part);
        this.channel.send(JSON.stringify({ t: "done" }));
        this.sentDone = true;
        return;
      }
      case "pack": {
        if (this.incoming || this.partsSeen >= MAX_PARTS) throw new Error("Unexpected data from the other phone.");
        const n = Number(m.n);
        if (!Number.isInteger(n) || n < 1 || n * CHUNK_BYTES * 1.4 > MAX_PART_BYTES * 1.4) throw new Error("The other phone sent too much data.");
        this.incoming = { n, chunks: [] };
        this.partsSeen += 1;
        return;
      }
      case "chunk": {
        if (!this.incoming || typeof m.d !== "string" || this.incoming.chunks.length >= this.incoming.n) throw new Error("Unexpected data from the other phone.");
        this.incoming.chunks.push(fromB64(m.d));
        return;
      }
      case "end": {
        const part = this.incoming;
        if (!part || part.chunks.length !== part.n) throw new Error("Incomplete data from the other phone.");
        this.incoming = undefined;
        const bytes = new Uint8Array(part.chunks.reduce((a, c) => a + c.length, 0));
        let o = 0; for (const c of part.chunks) { bytes.set(c, o); o += c.length; }
        const result = await this.provider.receive(bytes);
        this.received += result.imported;
        this.messages.push(result.message);
        this.onStatus(result.message);
        return;
      }
      case "done":
        this.peerDone = true;
        return;
      default:
        throw new Error("The other phone sent something unexpected.");
    }
  }

  private async sendPart(part: PackPart): Promise<void> {
    const n = Math.max(1, Math.ceil(part.bytes.length / CHUNK_BYTES));
    this.onStatus(`Sending ${part.count} search${part.count === 1 ? "" : "es"}...`);
    this.channel.send(JSON.stringify({ t: "pack", n }));
    for (let i = 0; i < n; i++) {
      while (this.channel.bufferedAmount > BUFFER_HIGH) await new Promise((r) => setTimeout(r, 25));
      this.channel.send(JSON.stringify({ t: "chunk", i, d: toB64(part.bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)) }));
    }
    this.channel.send(JSON.stringify({ t: "end" }));
    this.sent += part.count;
  }
}
