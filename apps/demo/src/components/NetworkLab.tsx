import { CHAOS_PROFILES, type ChaosProfileName } from "@setusync/edge-sdk";

import type { ControllerState, SetuSyncController } from "../controller.js";

const ORDER: ChaosProfileName[] = ["PERFECT", "3G", "2G", "LOSSY", "TUNNEL"];

export function NetworkLab({
  controller,
  state,
  query,
}: {
  controller: SetuSyncController;
  state: ControllerState;
  query: string;
}) {
  const { lab, chaos } = state;
  const canRun = query.trim() !== "" && state.online && !lab.running;

  return (
    <section className="card">
      <h3>Network lab</h3>
      <p className="muted small">
        Make this device's connection bad on purpose, then run the same
        search through a typical app (one attempt, no retries, no saved
        results) and through SetuSync.
      </p>

      <div className="chips" role="radiogroup" aria-label="Network condition">
        {ORDER.map((name) => (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={state.networkProfile === name}
            className={`chip ${state.networkProfile === name ? "chip-on" : ""}`}
            onClick={() => controller.setNetworkProfile(name)}
          >
            {CHAOS_PROFILES[name].label}
          </button>
        ))}
      </div>

      <div className="button-row">
        <button
          type="button"
          className="primary"
          disabled={!canRun}
          onClick={() => void controller.compare(query)}
        >
          {lab.running ? "Running…" : `Compare on “${query.trim() || "…"}”`}
        </button>
        <button type="button" onClick={() => controller.resetLab()}>
          Reset
        </button>
      </div>
      {query.trim() === "" && (
        <p className="muted small">Type a search above first.</p>
      )}

      <div className="versus">
        <div className="versus-side bad">
          <h4>Typical app</h4>
          <div className="stat-value">
            {lab.naive.ok}
            <span className="muted small"> worked</span> · {lab.naive.failed}
            <span className="muted small"> failed</span>
          </div>
          {lab.lastNaive && <p className="muted small">{lab.lastNaive}</p>}
        </div>
        <div className="versus-side good">
          <h4>SetuSync</h4>
          <div className="stat-value">
            {lab.setusync.ok}
            <span className="muted small"> delivered</span> ·{" "}
            {lab.setusync.failed}
            <span className="muted small"> retried</span>
          </div>
          <p className="muted small">
            Failed attempts are kept and retried automatically.
          </p>
        </div>
      </div>

      <p className="muted small">
        Network events: {chaos.requests} requests · {chaos.dropped} dropped ·{" "}
        {chaos.repliesLost} replies lost · {chaos.tunnelDown} tunnel outages
      </p>
    </section>
  );
}
