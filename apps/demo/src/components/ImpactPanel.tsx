import type { ControllerState, SetuSyncController } from "../controller.js";

function kb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Stat({
  value,
  label,
  hint,
}: {
  value: string | number;
  label: string;
  hint?: string;
}) {
  return (
    <div className="stat" title={hint}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function ImpactPanel({
  controller,
  state,
}: {
  controller: SetuSyncController;
  state: ControllerState;
}) {
  const s = state.savings;

  return (
    <section className="card">
      <h3>Impact on this device</h3>
      <p className="muted small">
        Every request answered without a live provider search is a SerpApi
        credit saved. These numbers are measured on this device.
      </p>

      <div className="stats">
        <Stat
          value={s.creditsAvoided}
          label="credits avoided"
          hint="Fresh results reused, equivalent searches recognised, and results received from other people"
        />
        <Stat
          value={`${Math.round(s.reuseRate * 100)}%`}
          label="requests needing no credit"
        />
        <Stat value={s.liveFetches} label="live searches" />
        <Stat value={s.offlineAnswers} label="answered offline" />
        <Stat
          value={s.peerCapsules}
          label="received from people"
          hint={`${kb(s.peerBytes)} that never touched the relay`}
        />
        <Stat
          value={`${s.deliveredFromOutbox}/${s.queuedWhileOffline}`}
          label="offline requests delivered"
        />
        <Stat value={s.equivalentHits} label="rephrasings recognised" />
        <Stat value={kb(s.relayBytes)} label="downloaded from relay" />
        <Stat
          value={s.p2pCapsules}
          label="from a nearby phone (WebRTC)"
          hint="Received directly over WebRTC, with no server and no credits"
        />
        <Stat
          value={kb(s.deltaBytesSaved)}
          label="saved by sending only changes"
          hint={`${s.deltaCapsules} update${s.deltaCapsules === 1 ? "" : "s"} sent as deltas instead of full results`}
        />
        <Stat
          value={s.backgroundSyncs}
          label="finished in the background"
          hint="Queued searches completed by Background Sync while the app was closed"
        />
        <Stat
          value={s.semanticAnswers}
          label="found by meaning (on-device AI)"
          hint="Related results found by smart search with no network"
        />
      </div>

      <div className="button-row">
        <button type="button" onClick={() => controller.resetImpact()}>
          Reset numbers
        </button>
      </div>
    </section>
  );
}
