/**
 * Animated-QR transport for small packs.
 *
 * A pack is cut into numbered frames. The sender loops through them;
 * the receiver collects whatever it sees, in any order, and is done
 * when every index has been seen. No pairing, no network. Each frame
 * carries a short hash of the whole payload so frames from two different
 * transfers can never be mixed, and the result is re-checked at the end.
 *
 *   SP1.<transferId>.<index>.<total>.<base64url chunk>
 */

const PREFIX = "SP1";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array | undefined {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  } catch {
    return undefined;
  }
}

async function transferId(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes as BufferSource),
  );

  return Array.from(digest.subarray(0, 5), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Default is small enough for reliable scanning on cheap phone cameras. */
export const DEFAULT_QR_CHUNK_BYTES = 220;
export const MAX_QR_FRAMES = 60;

export class QrTransferTooLargeError extends Error {
  public readonly frames: number;

  public constructor(frames: number) {
    super(
      `This pack needs ${frames} QR codes (limit ${MAX_QR_FRAMES}). ` +
        "Share it as a file instead, or pick fewer searches.",
    );
    this.name = "QrTransferTooLargeError";
    this.frames = frames;
  }
}

export async function makeQrFrames(
  bytes: Uint8Array,
  chunkBytes: number = DEFAULT_QR_CHUNK_BYTES,
): Promise<string[]> {
  const total = Math.max(1, Math.ceil(bytes.length / chunkBytes));

  if (total > MAX_QR_FRAMES) {
    throw new QrTransferTooLargeError(total);
  }

  const id = await transferId(bytes);
  const frames: string[] = [];

  for (let index = 0; index < total; index += 1) {
    const chunk = bytes.subarray(index * chunkBytes, (index + 1) * chunkBytes);
    frames.push(`${PREFIX}.${id}.${index}.${total}.${toBase64Url(chunk)}`);
  }

  return frames;
}

export interface FrameProgress {
  accepted: boolean;
  received: number;
  total: number;
  complete: boolean;
  /** Set when the frame belongs to a different transfer or is invalid. */
  ignored?: "NOT_SETUSYNC" | "OTHER_TRANSFER" | "MALFORMED";
}

export class FrameAssembler {
  private id: string | undefined;
  private total = 0;
  private readonly chunks = new Map<number, Uint8Array>();

  public add(text: string): FrameProgress {
    const parts = text.split(".");

    if (parts.length !== 5 || parts[0] !== PREFIX) {
      return this.progress(false, "NOT_SETUSYNC");
    }

    const [, id, indexText, totalText, payload] = parts as [
      string, string, string, string, string,
    ];
    const index = Number(indexText);
    const total = Number(totalText);
    const chunk = fromBase64Url(payload);

    if (
      !/^[0-9a-f]{10}$/u.test(id) ||
      !Number.isInteger(index) ||
      !Number.isInteger(total) ||
      total < 1 ||
      total > MAX_QR_FRAMES ||
      index < 0 ||
      index >= total ||
      chunk === undefined
    ) {
      return this.progress(false, "MALFORMED");
    }

    if (this.id === undefined) {
      this.id = id;
      this.total = total;
    } else if (this.id !== id || this.total !== total) {
      return this.progress(false, "OTHER_TRANSFER");
    }

    this.chunks.set(index, chunk);
    return this.progress(true);
  }

  public get received(): number {
    return this.chunks.size;
  }

  public get isComplete(): boolean {
    return this.total > 0 && this.chunks.size === this.total;
  }

  public reset(): void {
    this.id = undefined;
    this.total = 0;
    this.chunks.clear();
  }

  /** Reassembles and re-checks the hash. Throws if damaged. */
  public async finish(): Promise<Uint8Array> {
    if (!this.isComplete || this.id === undefined) {
      throw new Error("The transfer is not complete yet.");
    }

    let length = 0;

    for (let i = 0; i < this.total; i += 1) {
      length += this.chunks.get(i)?.length ?? 0;
    }

    const out = new Uint8Array(length);
    let offset = 0;

    for (let i = 0; i < this.total; i += 1) {
      const chunk = this.chunks.get(i);

      if (chunk === undefined) {
        throw new Error("The transfer is missing a frame.");
      }

      out.set(chunk, offset);
      offset += chunk.length;
    }

    if ((await transferId(out)) !== this.id) {
      this.reset();
      throw new Error("The received data is damaged. Please scan again.");
    }

    return out;
  }

  private progress(
    accepted: boolean,
    ignored?: FrameProgress["ignored"],
  ): FrameProgress {
    return {
      accepted,
      received: this.chunks.size,
      total: this.total,
      complete: this.isComplete,
      ...(ignored === undefined ? {} : { ignored }),
    };
  }
}
