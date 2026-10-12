import type { Provenance } from "../controller.js";

import type { VolatilityAssessment } from "@setusync/edge-sdk";

export function ProvenanceChip({
  provenance,
}: {
  provenance: Provenance | undefined;
}) {
  if (provenance === undefined) {
    return null;
  }

  const via =
    provenance.origin === "relay"
      ? "from the relay"
      : provenance.origin === "p2p"
        ? "from a nearby phone"
        : provenance.origin === "qr"
        ? "shared by QR code"
        : "shared in a pack";

  const steps = Math.max(0, provenance.hops.length - 1);
  const custody =
    provenance.origin === "relay"
      ? ""
      : ` · passed through ${steps} step${steps === 1 ? "" : "s"}`;

  const detail =
    provenance.hops
      .map((h) => `${h.role}${h.label ? ` (${h.label})` : ""} ${h.at.slice(0, 16)}`)
      .join("  →  ") +
    (provenance.fingerprint ? `\nSigned by key ${provenance.fingerprint}` : "");

  if (provenance.verified === true) {
    return (
      <span className="badge badge-fresh" title={detail}>
        ✓ Verified · {via}
        {custody}
      </span>
    );
  }

  if (provenance.verified === false) {
    return (
      <span className="badge badge-expired" title={detail}>
        ⚠ Signature failed · {via}
      </span>
    );
  }

  return (
    <span className="badge badge-stale" title={detail}>
      Not checked yet · {via}
    </span>
  );
}

export function VolatilityChip({
  volatility,
}: {
  volatility: VolatilityAssessment | undefined;
}) {
  if (volatility === undefined || volatility.verdict === "UNKNOWN") {
    return null;
  }

  return (
    <span
      className={`badge ${
        volatility.verdict === "LIKELY_VALID" ? "badge-fresh" : "badge-stale"
      }`}
      title={volatility.label}
    >
      {volatility.verdict === "LIKELY_VALID"
        ? "Rarely changes"
        : "Changes often"}
    </span>
  );
}
