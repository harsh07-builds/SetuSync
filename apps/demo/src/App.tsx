import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  formatAge,
  SetuSyncController,
  type HitView,
} from "./controller.js";
import { appConfig } from "./config.js";
import { ProvenanceChip, VolatilityChip } from "./components/Chips.js";
import { ImpactPanel } from "./components/ImpactPanel.js";
import { NetworkLab } from "./components/NetworkLab.js";
import { P2PPanel } from "./components/P2PPanel.js";
import { SharePanel } from "./components/SharePanel.js";

type Tab = "saved" | "share" | "impact" | "lab";

interface NetworkInformation extends EventTarget {
  effectiveType?: string;
}

function FreshnessBadge({ hit }: { hit: HitView }) {
  const f = hit.freshness;

  if (!f) {
    return null;
  }

  const label =
    f.state === "FRESH"
      ? `Fresh · ${formatAge(f.ageSeconds)} old`
      : f.state === "STALE"
        ? `Out of date · ${formatAge(f.ageSeconds)} old`
        : `Expired · ${formatAge(f.ageSeconds)} old`;

  return (
    <span className={`badge badge-${f.state.toLowerCase()}`}>{label}</span>
  );
}

function progressText(
  phase: string | undefined,
  state: string | undefined,
): string {
  switch (phase) {
    case "SUBMITTING":
      return "Sending request to the relay…";
    case "WAITING":
      return state === "PROCESSING"
        ? "The relay is fetching fresh results…"
        : `Relay status: ${state ?? "working"}…`;
    case "COLLECTING":
      return "Downloading results…";
    default:
      return "Syncing…";
  }
}

export default function App() {
  const controller = useMemo(
    () => new SetuSyncController({ relayUrl: appConfig.relayUrl }),
    [],
  );

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("saved");

  useEffect(() => {
    void controller.init();

    const goOnline = () => controller.setBrowserOnline(true);
    const goOffline = () => controller.setBrowserOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    // Network Information API (Chromium): sync queued work as soon as the
    // link gets better, instead of waiting for the retry timer.
    const connection = (
      navigator as Navigator & { connection?: NetworkInformation }
    ).connection;

    const onLink = () => controller.setLinkQuality(connection?.effectiveType);

    if (connection) {
      controller.setLinkQuality(connection.effectiveType);
      connection.addEventListener("change", onLink);
    }

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      connection?.removeEventListener("change", onLink);
      controller.dispose();
    };
  }, [controller]);

  const view = useMemo(
    () => controller.searchLocal(query),
    // capsules/outbox change => index may have changed.
    [controller, query, state.capsules],
  );

  // Smart search: results related in meaning (on-device AI), shown under the exact matches.
  const [semHits, setSemHits] = useState<HitView[]>([]);

  useEffect(() => {
    const text = query.trim();

    if (state.semantic.status !== "ready" || text.length < 3) {
      setSemHits([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      const have = new Set(view.hits.map((h) => h.id));
      void controller.searchSemantic(text, have).then((hits) => {
        if (!cancelled) setSemHits(hits);
      });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [controller, query, view, state.semantic.status, state.capsules]);

  const busy = state.syncing;
  const trimmed = query.trim();

  const submit = () => {
    void controller.requestLive(trimmed);
  };

  return (
    <main className="app-shell">
      <div className="app-container">
        <header className="app-header">
          <div>
            <h1>SetuSync</h1>
            <p>Search that keeps working when the network doesn't</p>
          </div>

          <div className="pills" aria-live="polite">
            <span
              className={`pill ${state.online ? "pill-on" : "pill-off"}`}
            >
              {state.online ? "Online" : "Offline"}
              {state.online && state.linkQuality
                ? ` · ${state.linkQuality}`
                : ""}
            </span>
            <span className="pill">
              {state.capsules.length} saved search
              {state.capsules.length === 1 ? "" : "es"}
            </span>
            {state.outbox.length > 0 && (
              <span className="pill pill-warn">
                {state.outbox.length} waiting to sync
              </span>
            )}
            {state.networkProfile !== "PERFECT" && (
              <span className="pill pill-warn">Network lab on</span>
            )}
          </div>
        </header>

        <section className="card">
          <div className="search-row">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="Search saved results, or press Enter to fetch fresh ones"
              aria-label="Search"
              autoFocus
            />
            <button
              type="button"
              className="primary"
              onClick={submit}
              disabled={trimmed === "" || state.restoring}
            >
              {state.online ? "Search live" : "Save for later"}
            </button>
          </div>

          <label className="toggle">
            <input
              type="checkbox"
              checked={state.simulatedOffline}
              onChange={(e) =>
                controller.setSimulatedOffline(e.target.checked)
              }
            />
            <span>
              Simulate no connectivity
              {!state.browserOnline && " (your device is offline)"}
            </span>
          </label>

          {state.storageError && (
            <div className="notice notice-error" role="alert">
              {state.storageError}
            </div>
          )}

          {busy && (
            <div className="notice notice-info" role="status">
              <span className="spinner" aria-hidden="true" />
              {progressText(
                state.progress?.phase,
                state.progress?.ticketState,
              )}
              {state.progress && (
                <span className="muted">
                  {" "}
                  {Math.round(state.progress.elapsedMs / 1000)}s
                </span>
              )}
            </div>
          )}

          {state.notice && !busy && (
            <div
              className={`notice notice-${state.notice.kind}`}
              role={state.notice.kind === "error" ? "alert" : "status"}
            >
              <span>{state.notice.text}</span>
              {state.notice.text.includes("already fresh") && (
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    void controller.requestLive(trimmed, { force: true })
                  }
                >
                  Refresh anyway
                </button>
              )}
              <button
                type="button"
                className="link"
                onClick={() => controller.dismissNotice()}
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="smart-search small muted" style={{ margin: "8px 0" }}>
            {state.semantic.status === "off" && (
              <>
                <button type="button" className="link" onClick={() => void controller.enableSemantic()}>
                  Turn on smart search
                </button>{" "}
                (understands meaning, works offline after a one-time ~25 MB download)
              </>
            )}
            {state.semantic.status === "loading" && <>Smart search: downloading the model… {state.semantic.progress}%</>}
            {state.semantic.status === "indexing" && <>Smart search: reading saved results… {state.semantic.progress}%</>}
            {state.semantic.status === "ready" && (
              <>
                Smart search on ({state.semantic.docs} results understood){" "}
                <button type="button" className="link" onClick={() => controller.disableSemantic()}>
                  Turn off
                </button>
              </>
            )}
            {state.semantic.status === "error" && (
              <>
                {state.semantic.message}{" "}
                <button type="button" className="link" onClick={() => void controller.enableSemantic()}>
                  Try again
                </button>
              </>
            )}
          </div>

          {trimmed !== "" && (
            <div className="results" aria-label="Search results">
              {view.hits.length === 0 ? (
                <p className="muted empty">
                  Nothing saved on this device matches “{trimmed}”.{" "}
                  {state.online
                    ? "Press Search live to fetch it, or import results from a friend in the Share tab."
                    : "Press Save for later and it will be fetched when you're back online, or import results from a friend in the Share tab."}
                </p>
              ) : (
                view.hits.map((hit) => (
                  <article
                    key={`${hit.capsuleId}-${hit.id}`}
                    className="result"
                  >
                    <h2>{hit.title || hit.link}</h2>
                    {hit.snippet && <p>{hit.snippet}</p>}
                    <div className="result-meta">
                      {hit.link && (
                        <a
                          href={hit.link}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {hit.displayedLink || hit.link}
                        </a>
                      )}
                      <FreshnessBadge hit={hit} />
                      <VolatilityChip volatility={hit.volatility} />
                      <ProvenanceChip provenance={hit.provenance} />
                    </div>
                  </article>
                ))
              )}
            </div>
          )}

          {trimmed !== "" && semHits.length > 0 && (
            <div className="results" aria-label="Related by meaning">
              <h3 className="muted">Related by meaning (on-device AI)</h3>
              {semHits.map((hit) => (
                <article key={`sem-${hit.id}`} className="result">
                  <h2>{hit.title || hit.link}</h2>
                  {hit.snippet && <p>{hit.snippet}</p>}
                  <div className="result-meta">
                    {hit.link && (
                      <a href={hit.link} target="_blank" rel="noreferrer noopener">
                        {hit.displayedLink || hit.link}
                      </a>
                    )}
                    <FreshnessBadge hit={hit} />
                    <ProvenanceChip provenance={hit.provenance} />
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <nav className="tabs" role="tablist" aria-label="Sections">
          {(
            [
              ["saved", "Saved & queue"],
              ["share", "Share & receive"],
              ["impact", "Impact"],
              ["lab", "Network lab"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`tab ${tab === id ? "tab-on" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
              {id === "share" && state.pendingTrust ? " •" : ""}
            </button>
          ))}
        </nav>

        {tab === "saved" && (
          <div className="grid">
            <section className="card">
              <h3>Waiting to sync</h3>
              {state.outbox.length === 0 ? (
                <p className="muted">
                  Nothing queued. Requests made while offline appear here and
                  are sent automatically.
                </p>
              ) : (
                <ul className="list">
                  {state.outbox.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.query}</strong>
                        <div className="muted small">
                          {item.status === "FAILED"
                            ? (item.lastError ?? "Failed")
                            : item.status === "SENDING"
                              ? "Sending…"
                              : "Queued"}
                        </div>
                      </div>
                      <div className="actions">
                        {item.status === "FAILED" && state.online && (
                          <button
                            type="button"
                            className="link"
                            onClick={() => void controller.retry(item.id)}
                          >
                            Retry
                          </button>
                        )}
                        <button
                          type="button"
                          className="link"
                          onClick={() => void controller.dismiss(item.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <h3>Saved on this device</h3>
              {state.capsules.length === 0 ? (
                <p className="muted">
                  {state.restoring
                    ? "Loading…"
                    : "No saved searches yet. Fetch one while online, or import one from a friend."}
                </p>
              ) : (
                <ul className="list">
                  {state.capsules.map((c) => (
                    <li key={c.id}>
                      <div>
                        <strong>{c.query}</strong>
                        <div className="muted small">
                          {c.resultCount} results
                        </div>
                        <div className="chip-row">
                          <ProvenanceChip provenance={c.provenance} />
                          <VolatilityChip volatility={c.volatility} />
                        </div>
                      </div>
                      {c.freshness && (
                        <span
                          className={`badge badge-${c.freshness.state.toLowerCase()}`}
                        >
                          {c.freshness.state === "FRESH"
                            ? "Fresh"
                            : c.freshness.state === "STALE"
                              ? "Out of date"
                              : "Expired"}{" "}
                          · {formatAge(c.freshness.ageSeconds)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {tab === "share" && (
          <>
            <SharePanel controller={controller} state={state} />
            <P2PPanel controller={controller} />
          </>
        )}
        {tab === "impact" && (
          <ImpactPanel controller={controller} state={state} />
        )}
        {tab === "lab" && (
          <NetworkLab controller={controller} state={state} query={query} />
        )}

        {state.log.length > 0 && (
          <details className="card activity">
            <summary>Activity</summary>
            <ul className="log">
              {state.log.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className={entry.kind}>
                  <time>{new Date(entry.at).toLocaleTimeString()}</time>{" "}
                  {entry.text}
                </li>
              ))}
            </ul>
          </details>
        )}

        <footer className="footer muted small">
          Relay: {appConfig.relayUrl || "same origin"}
          {state.relayReachable === false && " · unreachable"}
          {state.lastSyncAt &&
            ` · last sync ${new Date(state.lastSyncAt).toLocaleTimeString()}`}
        </footer>
      </div>
    </main>
  );
}
