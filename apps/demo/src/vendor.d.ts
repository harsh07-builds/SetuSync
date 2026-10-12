// Minimal typings for the two small QR libraries (loaded lazily).
declare module "qrcode" {
  interface QrOptions {
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    margin?: number;
    width?: number;
  }

  export function toCanvas(
    canvas: HTMLCanvasElement,
    text: string,
    options?: QrOptions,
  ): Promise<void>;

  const QR: { toCanvas: typeof toCanvas };
  export default QR;
}

declare module "jsqr" {
  export interface QRCode {
    data: string;
  }

  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "both" },
  ): QRCode | null;
}
