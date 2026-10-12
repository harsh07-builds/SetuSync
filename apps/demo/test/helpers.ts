import { generateKeyPairSync, sign } from "node:crypto";

import {
  canonicalizeJson,
  computeCapsuleId,
  computeContentHash,
  computeRequestKey,
} from "@setusync/protocol";
import {
  MemoryStorage,
  type Capsule,
  type CapsuleMetadataRecord,
  type CapsuleRecord,
  type CapsuleStore,
  type MetadataStore,
  type OutboxRecord,
  type OutboxStatus,
  type OutboxStore,
  type PublicKeyInfo,
  type SyncStateRecord,
  type SyncStateStore,
} from "@setusync/edge-sdk";

import {
  SetuSyncController,
  type ControllerDeps,
} from "../src/controller.js";

export function memoryCapsules(): CapsuleStore {
  const m = new Map<string, CapsuleRecord>();

  return {
    put: async (r) => void m.set(r.capsule.body.id, r),
    get: async (id) => m.get(id),
    listAll: async () => [...m.values()],
    findByKey: async (k) =>
      [...m.values()].filter((r) => r.capsule.body.key === k),
    delete: async (id) => void m.delete(id),
  };
}

export function memoryMetadata(): MetadataStore {
  const m = new Map<string, CapsuleMetadataRecord>();

  return {
    put: async (r) => void m.set(r.capsuleId, r),
    get: async (id) => m.get(id),
    findByKey: async (k) => [...m.values()].filter((r) => r.key === k),
    delete: async (id) => void m.delete(id),
  };
}

export function memoryOutbox(): OutboxStore {
  const m = new Map<string, OutboxRecord>();

  return {
    put: async (r) => void m.set(r.id, structuredClone(r)),
    get: async (id) => m.get(id),
    listByStatus: async (s: OutboxStatus) =>
      [...m.values()].filter((r) => r.status === s),
    delete: async (id) => void m.delete(id),
  };
}

export function memorySyncState(): SyncStateStore {
  let value: SyncStateRecord | undefined;

  return {
    get: async () => value,
    put: async (r) => void (value = r),
  };
}

export interface Signer {
  kid: string;
  info: PublicKeyInfo;
  signCapsule(query: string, titles: string[]): Capsule;
}

export function makeSigner(kid: string): Signer {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  return {
    kid,
    info: {
      kid,
      alg: "Ed25519",
      publicKeySpkiB64: publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
      status: "ACTIVE",
    },
    signCapsule(query, titles) {
      const results = titles.map((t, i) => ({
        position: i + 1,
        title: t,
        link: `https://example.com/${t.toLowerCase()}`,
        snippet: `${t} for ${query}`,
        displayedLink: "example.com",
      }));
      const params = { q: query };
      const noId = {
        key: computeRequestKey({ engine: "google", query, params }),
        chash: computeContentHash({
          organic_results: results,
          related_questions: [],
        }),
        engine: "google",
        params,
        fetched_at: new Date().toISOString(),
        ttl_s: 3600,
        source: { provider: "serpapi" },
        organic_results: results,
        related_questions: [],
      };
      const body = { id: computeCapsuleId(noId), ...noId };

      return {
        v: 1,
        kid,
        alg: "Ed25519",
        sig: sign(
          null,
          Buffer.from(canonicalizeJson(body)),
          privateKey,
        ).toString("base64url"),
        body,
      } as Capsule;
    },
  };
}

export type RelayMode = "ok" | "down" | "budget";

export interface FakeRelay {
  fetch: typeof fetch;
  signer: Signer;
  mode: RelayMode;
  titles: string[];
  log: string[];
  cache: Map<string, Capsule>;
}

/** A relay that speaks the real wire protocol and signs capsules. */
export function makeRelay(mode: RelayMode = "ok"): FakeRelay {
  const signer = makeSigner("relay-1");
  const tickets = new Map<string, { q: string; polls: number }>();

  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const relay: FakeRelay = {
    signer,
    mode,
    titles: ["Alpha", "Beta"],
    log: [],
    cache: new Map(),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (relay.mode === "down") {
        throw new TypeError("Failed to fetch");
      }

      const path = new URL(String(input), "http://relay").pathname;
      relay.log.push(`${init?.method ?? "GET"} ${path}`);

      if (path === "/v1/keys") {
        return json(200, { keys: [signer.info] });
      }

      if (path === "/v1/search") {
        const q = (
          JSON.parse(String(init?.body)) as { params: { q: string } }
        ).params.q;
        const hit = relay.cache.get(q);

        if (hit) {
          return json(200, { state: "READY", key: "k", capsule: hit });
        }

        const id = `t${tickets.size + 1}`;
        tickets.set(id, { q, polls: 0 });
        return json(202, { ticketId: id, state: "PROCESSING" });
      }

      const match = path.match(/^\/v1\/tickets\/(.+)$/);
      const ticket = match?.[1] ? tickets.get(match[1]) : undefined;

      if (!ticket || !match?.[1]) {
        return json(404, { code: "NOT_FOUND" });
      }

      if (relay.mode === "budget") {
        return json(200, {
          ticketId: match[1],
          state: "FAILED",
          reason: "The relay's monthly provider-credit budget is used up.",
        });
      }

      ticket.polls += 1;

      if (ticket.polls >= 2) {
        relay.cache.set(ticket.q, signer.signCapsule(ticket.q, relay.titles));
        return json(200, { ticketId: match[1], state: "READY" });
      }

      return json(200, { ticketId: match[1], state: "PROCESSING" });
    }) as typeof fetch,
  };

  return relay;
}

export function makeDevice(
  relay: FakeRelay,
  extra: Partial<ControllerDeps> = {},
): SetuSyncController {
  return new SetuSyncController({
    relayUrl: "",
    fetchImpl: relay.fetch,
    installId: crypto.randomUUID(),
    storage: new MemoryStorage(),
    capsules: memoryCapsules(),
    metadata: memoryMetadata(),
    outbox: memoryOutbox(),
    syncState: memorySyncState(),
    browserOnline: true,
    autoRetryMs: 0,
    naivePollMs: 5,
    transportOptions: {
      pollIntervalMs: 5,
      maxWaitMs: 3_000,
      requestTimeoutMs: 800,
    },
    ...extra,
  });
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return false;
}

/** Waits until the device has n saved searches and is idle. */
export async function settled(
  device: SetuSyncController,
  n: number,
): Promise<boolean> {
  return waitFor(
    () =>
      device.getState().capsules.length >= n && !device.getState().syncing,
  );
}
