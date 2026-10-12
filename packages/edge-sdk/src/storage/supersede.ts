import type { Capsule } from "@setusync/protocol";

import type { CapsuleRecord } from "./types.js";

export interface CapsuleReplacementPlan {
  /** False when a strictly newer capsule for the same key already exists. */
  store: boolean;
  /** Older capsules for the same key that the incoming capsule replaces. */
  remove: Capsule[];
}

function fetchedAtMs(capsule: Capsule): number {
  return Date.parse(capsule.body.fetched_at);
}

/**
 * A request key should have one current capsule. Given the capsules already
 * stored for the incoming capsule's key, decide whether to keep the incoming
 * one and which older ones it replaces. Capsules with the same id, an
 * unparseable fetched_at, or an identical fetched_at are left alone.
 */
export function planCapsuleReplacement(
  incoming: Capsule,
  existing: readonly CapsuleRecord[],
): CapsuleReplacementPlan {
  const incomingMs = fetchedAtMs(incoming);

  if (!Number.isFinite(incomingMs)) {
    return { store: true, remove: [] };
  }

  let store = true;
  const remove: Capsule[] = [];

  for (const { capsule } of existing) {
    if (
      capsule.body.id === incoming.body.id ||
      capsule.body.key !== incoming.body.key
    ) {
      continue;
    }

    const existingMs = fetchedAtMs(capsule);

    if (!Number.isFinite(existingMs)) {
      continue;
    }

    if (existingMs > incomingMs) {
      store = false;
    } else if (existingMs < incomingMs) {
      remove.push(capsule);
    }
  }

  return { store, remove };
}
