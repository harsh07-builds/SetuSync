import { useEffect, useRef, useState } from "react";

import { FrameAssembler, P2PExchange, P2PSession, makeQrFrames } from "@setusync/edge-sdk";

import type { SetuSyncController } from "../controller.js";
import { QrSender } from "./QrTransfer.js";

/** Reads animated QR codes and returns the reassembled bytes (not tied to packs). */
function BytesScanner({
  onBytes,
  onClose,
  title,
}: {
  onBytes: (bytes: Uint8Array) => void;
  onClose: () => void;
  title: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [progress, setProgress] = useState({ received: 0, total: 0 });
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let stream: MediaStream | undefined;
    let raf = 0;
    let stopped = false;
    const assembler = new FrameAssembler();

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera access needs HTTPS (or localhost).");
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch {
        setError("The camera is blocked or unavailable. Allow camera access and try again.");
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
      let last = 0;

      const tick = (): void => {
        if (stopped || context === null) return;
        raf = requestAnimationFrame(tick);
        const now = performance.now();
        if (now - last < 120 || video.readyState < 2) return;
        last = now;

        const width = 640;
        const height = Math.round((video.videoHeight * width) / video.videoWidth) || 480;
        canvas.width = width;
        canvas.height = height;
        context.drawImage(video, 0, 0, width, height);
        const code = jsQR(context.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: "dontInvert" });

        if (code?.data) {
          const p = assembler.add(code.data);
          setProgress({ received: p.received, total: p.total });

          if (p.complete) {
            stopped = true;
            void assembler.finish().then(onBytes, () => {
              assembler.reset();
              stopped = false;
              raf = requestAnimationFrame(tick);
            });
          }
        }
      };

      tick();
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // Callbacks are stable for the life of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal" role="dialog" aria-label={title}>
      <div className="modal-body">
        <h3>{title}</h3>
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

type Step = "idle" | "offer" | "scan-answer" | "scan-offer" | "answer" | "syncing" | "done" | "error";

export function P2PPanel({ controller }: { controller: SetuSyncController }) {
  const session = useRef<P2PSession | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [frames, setFrames] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const supported = typeof RTCPeerConnection !== "undefined";

  useEffect(() => () => session.current?.close(), []);

  const fail = (error: unknown): void => {
    setStatus(error instanceof Error ? error.message : "Something went wrong.");
    setStep("error");
    session.current?.close();
  };

  const exchange = async (): Promise<void> => {
    const current = session.current;
    if (current === null) return;

    try {
      const channel = await current.channel(120_000);
      setStep("syncing");
      setStatus("Connected to the nearby phone…");

      const result = await new P2PExchange(
        channel,
        {
          manifest: () => controller.p2pManifest(),
          build: (peer) => controller.p2pBuild(peer),
          receive: (bytes) => controller.p2pReceive(bytes),
        },
        setStatus,
      ).run();

      setStatus(`Done. Sent ${result.sent}, received ${result.received} verified search${result.received === 1 ? "" : "es"}. No internet and no credits used.`);
      setStep("done");
      current.close();
    } catch (error) {
      if (session.current === current) fail(error);
    }
  };

  const startHost = async (): Promise<void> => {
    try {
      session.current?.close();
      session.current = new P2PSession();
      setStatus("Preparing the connection code…");
      setFrames(await makeQrFrames(await session.current.createOffer()));
      setStep("offer");
    } catch (error) {
      fail(error);
    }
  };

  const hostGotAnswer = async (bytes: Uint8Array): Promise<void> => {
    try {
      await session.current?.acceptAnswer(bytes);
      setStep("syncing");
      setStatus("Connecting…");
      void exchange();
    } catch (error) {
      fail(error);
    }
  };

  const startGuest = (): void => {
    session.current?.close();
    session.current = new P2PSession();
    setStep("scan-offer");
  };

  const guestGotOffer = async (bytes: Uint8Array): Promise<void> => {
    try {
      const answer = await session.current!.acceptOffer(bytes);
      setFrames(await makeQrFrames(answer));
      setStep("answer");
      void exchange(); // moves on by itself as soon as the host scans our reply
    } catch (error) {
      fail(error);
    }
  };

  const reset = (): void => {
    session.current?.close();
    setStep("idle");
    setStatus("");
  };

  return (
    <section className="card">
      <h3>Nearby phone to phone (WebRTC)</h3>
      <p className="muted small">
        Two phones on the same Wi-Fi or hotspot swap saved searches directly. No server and no internet:
        the connection is set up by scanning two QR codes. Everything received is signature-checked, and
        a phone that already has an earlier version only receives what changed.
      </p>

      {!supported && <p className="notice notice-error">This browser does not support WebRTC.</p>}

      {(step === "idle" || step === "done" || step === "error") && supported && (
        <div className="button-row">
          <button type="button" className="primary" onClick={() => void startHost()}>
            Start a transfer (show my code)
          </button>
          <button type="button" onClick={startGuest}>
            Join a transfer (scan their code)
          </button>
        </div>
      )}

      {step === "syncing" && <p className="muted">{status || "Working…"}</p>}
      {(step === "done" || step === "error") && (
        <p className={step === "error" ? "notice notice-error" : "notice notice-success"} role="status">
          {status}
        </p>
      )}

      {step === "offer" && (
        <QrSender frames={frames} onClose={() => setStep("scan-answer")} />
      )}
      {step === "scan-answer" && (
        <BytesScanner title="Scan the other phone's reply code" onBytes={(b) => void hostGotAnswer(b)} onClose={reset} />
      )}
      {step === "scan-offer" && (
        <BytesScanner title="Scan the other phone's connection code" onBytes={(b) => void guestGotOffer(b)} onClose={reset} />
      )}
      {step === "answer" && <QrSender frames={frames} onClose={reset} />}
    </section>
  );
}
