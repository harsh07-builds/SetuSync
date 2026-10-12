import { useMemo, useRef, useState } from "react";

import type {
  ControllerState,
  ImportOutcome,
  SetuSyncController,
} from "../controller.js";
import { QrScanner, QrSender } from "./QrTransfer.js";

function download(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function SharePanel({
  controller,
  state,
}: {
  controller: SetuSyncController;
  state: ControllerState;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [frames, setFrames] = useState<string[] | undefined>();
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const shareable = useMemo(
    () => state.capsules.filter((c) => c.provenance?.verified === true),
    [state.capsules],
  );

  const chosen = shareable.filter((c) => !excluded.has(c.id)).map((c) => c.id);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setMessage(undefined);

    try {
      await work();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const share = (): Promise<void> =>
    run(async () => {
      const pack = await controller.exportPack(chosen);
      const file = new File([pack.bytes as BlobPart], pack.filename, {
        type: "application/octet-stream",
      });

      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: "SetuSync results",
            text: `${pack.count} verified search${pack.count === 1 ? "" : "es"} from SetuSync`,
          });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return; // user closed the share sheet
          }
        }
      }

      download(pack.bytes, pack.filename);
      setMessage(
        `Saved ${pack.filename}. Send it through WhatsApp, Bluetooth, or a USB drive.`,
      );
    });

  const saveFile = (): Promise<void> =>
    run(async () => {
      const pack = await controller.exportPack(chosen);
      download(pack.bytes, pack.filename);
      setMessage(`Saved ${pack.filename} (${pack.bytes.length} bytes).`);
    });

  const shareUpdate = (): Promise<void> =>
    run(async () => {
      const update = await controller.exportDeltaPack(chosen);
      const saved = Math.max(0, Math.round((1 - update.bytes.length / update.fullBytes) * 100));
      download(update.bytes, update.filename);
      setMessage(
        `Update saved: ${update.bytes.length} bytes instead of ${update.fullBytes} (${saved}% smaller). ` +
          "It only works on phones that already have the earlier version of these searches.",
      );
    });

  const showQr = (): Promise<void> =>
    run(async () => {
      const qr = await controller.prepareQr(chosen);
      setFrames(qr.frames);
    });

  const importFile = (file: File | undefined): Promise<void> =>
    run(async () => {
      if (file === undefined) return;

      const bytes = new Uint8Array(await file.arrayBuffer());
      report(await controller.importPack(bytes, "pack"));
    });

  const report = (outcome: ImportOutcome): void => {
    if (outcome.status === "IMPORTED") setMessage(outcome.message);
    if (outcome.status === "REJECTED") setMessage(outcome.message);
  };

  return (
    <section className="card">
      <h3>Share results, no internet needed</h3>
      <p className="muted small">
        Every saved search is cryptographically signed by the relay. Send
        results by WhatsApp, Bluetooth, USB or QR code. The receiving phone
        checks the signature, so nobody can alter them on the way.
      </p>

      {shareable.length === 0 ? (
        <p className="muted">
          Nothing to share yet. Fetch a search while online, and it becomes
          shareable once its signature is verified.
        </p>
      ) : (
        <>
          <ul className="list pick">
            {shareable.map((c) => (
              <li key={c.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={!excluded.has(c.id)}
                    onChange={(e) => {
                      const next = new Set(excluded);
                      if (e.target.checked) next.delete(c.id);
                      else next.add(c.id);
                      setExcluded(next);
                    }}
                  />{" "}
                  <strong>{c.query}</strong>{" "}
                  <span className="muted small">({c.resultCount} results)</span>
                </label>
              </li>
            ))}
          </ul>

          <div className="button-row">
            <button
              type="button"
              className="primary"
              disabled={busy || chosen.length === 0}
              onClick={() => void share()}
            >
              Share…
            </button>
            <button
              type="button"
              disabled={busy || chosen.length === 0}
              onClick={() => void saveFile()}
            >
              Save as file
            </button>
            <button
              type="button"
              title="Sends only what changed since the version the other phone already has"
              disabled={busy || chosen.length === 0}
              onClick={() => void shareUpdate()}
            >
              Share only changes
            </button>
            <button
              type="button"
              disabled={busy || chosen.length === 0}
              onClick={() => void showQr()}
            >
              Show as QR
            </button>
          </div>
        </>
      )}

      <h4>Receive</h4>
      <div className="button-row">
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          Import file
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setScanning(true)}
        >
          Scan QR
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".setupack,application/octet-stream,application/gzip"
          hidden
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {message && <p className="notice notice-info">{message}</p>}

      {state.keys.length > 0 && (
        <details className="keys">
          <summary>Keys this device trusts ({state.keys.length})</summary>
          <ul className="list">
            {state.keys.map((k) => (
              <li key={k.kid}>
                <span>
                  <strong>{k.kid}</strong>{" "}
                  <span className="muted small">
                    {k.source === "relay" ? "from the relay" : "approved by you"}
                  </span>
                </span>
                <code>{k.fingerprint}</code>
              </li>
            ))}
          </ul>
          <p className="muted small">
            Compare this fingerprint with the sender's before approving a pack
            from someone new.
          </p>
        </details>
      )}

      {frames && <QrSender frames={frames} onClose={() => setFrames(undefined)} />}

      {scanning && (
        <QrScanner
          controller={controller}
          onClose={() => setScanning(false)}
          onDone={(outcome) => {
            setScanning(false);
            report(outcome);
          }}
        />
      )}

      {state.pendingTrust && (
        <div className="modal" role="dialog" aria-label="Trust sender">
          <div className="modal-body">
            <h3>Trust this sender?</h3>
            <p>
              These results are signed with a key this device has not seen
              before. Only continue if the fingerprint matches what the sender
              shows you (Share, then “Keys this device trusts”).
            </p>
            <ul className="list">
              {state.pendingTrust.map((k) => (
                <li key={k.kid}>
                  <strong>{k.kid}</strong>
                  <code>{k.fingerprint}</code>
                </li>
              ))}
            </ul>
            <div className="button-row">
              <button
                type="button"
                className="primary"
                onClick={() =>
                  void controller.confirmPendingImport(true).then(report)
                }
              >
                Trust and import
              </button>
              <button
                type="button"
                onClick={() =>
                  void controller.confirmPendingImport(false).then(report)
                }
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
