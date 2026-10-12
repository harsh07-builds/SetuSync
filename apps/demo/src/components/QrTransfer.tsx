import { useEffect, useRef, useState } from "react";

import type { ImportOutcome, SetuSyncController } from "../controller.js";

/** Shows a looping series of QR codes; the other phone scans them. */
export function QrSender({
  frames,
  onClose,
}: {
  frames: string[];
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (frames.length < 2) return undefined;

    const timer = setInterval(
      () => setIndex((i) => (i + 1) % frames.length),
      700,
    );

    return () => clearInterval(timer);
  }, [frames.length]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const mod = await import("qrcode");
        const QR = mod.default ?? mod;
        const canvas = canvasRef.current;

        if (cancelled || canvas === null) return;

        await QR.toCanvas(canvas, frames[index] ?? "", {
          errorCorrectionLevel: "L",
          margin: 2,
          width: 320,
        });
      } catch {
        setError("Could not draw the QR code on this device.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [index, frames]);

  return (
    <div className="modal" role="dialog" aria-label="Send by QR code">
      <div className="modal-body">
        <h3>Send by QR code</h3>
        <p className="muted small">
          Hold the other phone steady in front of this screen. It can start
          at any code; they repeat until it has them all.
        </p>
        {error ? (
          <p className="notice notice-error">{error}</p>
        ) : (
          <canvas ref={canvasRef} className="qr-canvas" />
        )}
        <p className="muted">
          Code {index + 1} of {frames.length}
        </p>
        <button type="button" className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

/** Reads the other phone's animated QR codes with the camera. */
export function QrScanner({
  controller,
  onDone,
  onClose,
}: {
  controller: SetuSyncController;
  onDone: (outcome: ImportOutcome) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [progress, setProgress] = useState({ received: 0, total: 0 });
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let stream: MediaStream | undefined;
    let raf = 0;
    let stopped = false;
    let busy = false;
    let last = 0;

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "Camera access needs HTTPS (or localhost). Use “Import file” instead.",
        );
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch {
        setError(
          "The camera is blocked or unavailable. Allow camera access, or " +
            "use “Import file” instead.",
        );
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (stopped || video === null || canvas === null) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      video.srcObject = stream;
      await video.play();

      const jsQR = (await import("jsqr")).default;
      const context = canvas.getContext("2d", { willReadFrequently: true });

      controller.resetQr();

      const tick = (): void => {
        if (stopped || context === null) return;

        raf = requestAnimationFrame(tick);

        const now = performance.now();

        if (busy || now - last < 120 || video.readyState < 2) return;

        last = now;

        const width = 640;
        const height =
          Math.round((video.videoHeight * width) / video.videoWidth) || 480;

        canvas.width = width;
        canvas.height = height;
        context.drawImage(video, 0, 0, width, height);

        const image = context.getImageData(0, 0, width, height);
        const code = jsQR(image.data, width, height, {
          inversionAttempts: "dontInvert",
        });

        if (code?.data) {
          busy = true;

          void controller
            .qrScan(code.data)
            .then((result) => {
              setProgress({
                received: result.progress.received,
                total: result.progress.total,
              });

              if (result.outcome) {
                stopped = true;
                onDone(result.outcome);
              }
            })
            .finally(() => {
              busy = false;
            });
        }
      };

      tick();
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // The controller and callbacks are stable for the life of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal" role="dialog" aria-label="Scan QR codes">
      <div className="modal-body">
        <h3>Scan QR codes</h3>
        {error ? (
          <p className="notice notice-error">{error}</p>
        ) : (
          <>
            <video ref={videoRef} className="qr-video" playsInline muted />
            <canvas ref={canvasRef} hidden />
            <p className="muted">
              {progress.total === 0
                ? "Point the camera at the other phone's screen…"
                : `Received ${progress.received} of ${progress.total} codes`}
            </p>
          </>
        )}
        <button type="button" className="primary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
