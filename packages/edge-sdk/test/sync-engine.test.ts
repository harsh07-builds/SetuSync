import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeRequestKey,
  type Capsule,
  type CapsuleRequest,
} from "@setusync/protocol";
import { MockCapsuleTransport } from "../src/testing/mock-transport.js";
import { SetuSyncDatabase } from "../src/storage/database.js";
import { IndexedDbCapsuleStore } from "../src/storage/capsule-store.js";
import { IndexedDbMetadataStore } from "../src/storage/metadata-store.js";
import { IndexedDbOutboxStore } from "../src/storage/outbox-store.js";
import { IndexedDbSyncStateStore } from "../src/storage/sync-state-store.js";
import type { OutboxRecord } from "../src/storage/types.js";
import {
  SyncEngine,
  type SyncEngineStores,
} from "../src/sync/sync-engine.js";
import { CapsuleVerifier } from "../src/verification/capsule-verifier.js";
import { getMockCapsule } from "../src/testing/mock-capsule.js";

const databaseNames: string[] = [];

function createStores(): SyncEngineStores {
  const databaseName =
    `SetuSyncSyncEngineTest-${crypto.randomUUID()}`;

  databaseNames.push(databaseName);

  const database = new SetuSyncDatabase(databaseName);

  return {
    outbox: new IndexedDbOutboxStore(database),
    capsules: new IndexedDbCapsuleStore(database),
    metadata: new IndexedDbMetadataStore(database),
    syncState: new IndexedDbSyncStateStore(database),
  };
}

function createOutboxRecord(
  request: CapsuleRequest,
  id = "outbox-1",
): OutboxRecord {
  return {
    id,
    request,
    status: "PENDING",
    attempts: 0,
    createdAt: "2026-10-04T12:00:00.000Z",
    updatedAt: "2026-10-04T12:00:00.000Z",
    requestState: "PENDING",
  };
}

afterEach(() => {
  for (const databaseName of databaseNames.splice(0)) {
    indexedDB.deleteDatabase(databaseName);
  }
});

describe("SyncEngine", () => {
  const request: CapsuleRequest = {
    engine: "google",
    query: "government hospital",
    params: {
      gl: "in",
      hl: "en",
    },
  };

  it("processes a pending request successfully", async () => {
    const stores = createStores();

    const engine = new SyncEngine(
      new MockCapsuleTransport(),
      stores,
      {
        now: () =>
          new Date("2026-10-04T12:10:00.000Z"),
      },
    );

    await stores.outbox.put(
      createOutboxRecord(request),
    );

    const result = await engine.sync();

    expect(result).toEqual({
      processed: 1,
      succeeded: 1,
      failed: 0,
      startedAt: "2026-10-04T12:10:00.000Z",
      completedAt: "2026-10-04T12:10:00.000Z",
    });

    await expect(
      stores.outbox.get("outbox-1"),
    ).resolves.toBeUndefined();

    const requestKey = computeRequestKey(request);

    const capsules =
      await stores.capsules.findByKey(requestKey);

    expect(capsules).toHaveLength(1);
  });

  it("stores metadata for a successfully fetched capsule", async () => {
    const stores = createStores();

    const engine = new SyncEngine(
      new MockCapsuleTransport(),
      stores,
      {
        now: () =>
          new Date("2026-10-04T12:20:00.000Z"),
      },
    );

    await stores.outbox.put(
      createOutboxRecord(request),
    );

    await engine.sync();

    const requestKey = computeRequestKey(request);

    const capsules =
      await stores.capsules.findByKey(requestKey);

    expect(capsules).toHaveLength(1);

    const capsule = capsules[0]?.capsule;

    expect(capsule).toBeDefined();

    if (capsule === undefined) {
      throw new Error("Expected capsule to be stored");
    }

    const metadata =
      await stores.metadata.get(capsule.body.id);

    expect(metadata).toEqual({
      capsuleId: capsule.body.id,
      key: capsule.body.key,
      fetchedAt: capsule.body.fetched_at,
      ttlSeconds: capsule.body.ttl_s,
      storedAt: "2026-10-04T12:20:00.000Z",
    });
  });

  it("marks a request as FAILED when transport fails", async () => {
    const stores = createStores();

    const failingTransport = {
      async fetchCapsule(): Promise<Capsule> {
        throw new Error("network unavailable");
      },
    };

    const engine = new SyncEngine(
      failingTransport,
      stores,
      {
        now: () =>
          new Date("2026-10-04T12:30:00.000Z"),
      },
    );

    await stores.outbox.put(
      createOutboxRecord(request),
    );

    const result = await engine.sync();

    expect(result).toEqual({
      processed: 1,
      succeeded: 0,
      failed: 1,
      startedAt: "2026-10-04T12:30:00.000Z",
      completedAt: "2026-10-04T12:30:00.000Z",
    });

    const failedRecord =
      await stores.outbox.get("outbox-1");

    expect(failedRecord).toEqual({
      id: "outbox-1",
      request,
      status: "FAILED",
      attempts: 1,
      createdAt: "2026-10-04T12:00:00.000Z",
      updatedAt: "2026-10-04T12:30:00.000Z",
      requestState: "FAILED",
      lastError: "network unavailable",
    });

    expect(
      await stores.capsules.findByKey(
        computeRequestKey(request),
      ),
    ).toEqual([]);
  });

  it("increments consecutive failures when sync has failures", async () => {
    const stores = createStores();

    const failingTransport = {
      async fetchCapsule(): Promise<Capsule> {
        throw new Error("offline");
      },
    };

    const engine = new SyncEngine(
      failingTransport,
      stores,
      {
        now: () =>
          new Date("2026-10-04T12:40:00.000Z"),
      },
    );

    await stores.outbox.put(
      createOutboxRecord(request),
    );

    await engine.sync();

    const state =
      await stores.syncState.get();

    expect(state).toEqual({
      id: "default",
      lastStartedAt: "2026-10-04T12:40:00.000Z",
      lastCompletedAt: "2026-10-04T12:40:00.000Z",
      consecutiveFailures: 1,
    });
  });

  it("records a successful sync when there are no pending records", async () => {
    const stores = createStores();

    const engine = new SyncEngine(
      new MockCapsuleTransport(),
      stores,
      {
        now: () =>
          new Date("2026-10-04T12:50:00.000Z"),
      },
    );

    const result = await engine.sync();

    expect(result).toEqual({
      processed: 0,
      succeeded: 0,
      failed: 0,
      startedAt: "2026-10-04T12:50:00.000Z",
      completedAt: "2026-10-04T12:50:00.000Z",
    });

    const state =
      await stores.syncState.get();

    expect(state).toEqual({
      id: "default",
      lastStartedAt: "2026-10-04T12:50:00.000Z",
      lastCompletedAt: "2026-10-04T12:50:00.000Z",
      lastSuccessfulAt: "2026-10-04T12:50:00.000Z",
      consecutiveFailures: 0,
    });
  });

  it("rejects and does not store a capsule that fails verification", async () => {
    const stores = createStores();

    // The mock capsule has a valid id/chash but a placeholder signature
    // and a key id that no trusted key matches.
    const verifier = new CapsuleVerifier(() => undefined);

    const engine = new SyncEngine(
      new MockCapsuleTransport(),
      stores,
      {
        verifier,
        now: () =>
          new Date("2026-10-04T13:00:00.000Z"),
      },
    );

    await stores.outbox.put(
      createOutboxRecord(request),
    );

    const result = await engine.sync();

    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);

    const record = await stores.outbox.get("outbox-1");

    expect(record?.status).toBe("FAILED");
    expect(record?.requestState).toBe("FAILED");
    expect(record?.lastError).toBe(
      "Capsule rejected: Unknown capsule key ID",
    );

    await expect(
      stores.capsules.listAll(),
    ).resolves.toEqual([]);

    await expect(
      stores.metadata.findByKey(computeRequestKey(request)),
    ).resolves.toEqual([]);
  });

  it("stores a capsule that passes verification", async () => {
    const stores = createStores();

    const engine = new SyncEngine(
      new MockCapsuleTransport(),
      stores,
      {
        verifier: {
          async verify() {
            return {
              valid: true,
              signatureValid: true,
              idValid: true,
              contentHashValid: true,
            };
          },
        },
      },
    );

    await stores.outbox.put(
      createOutboxRecord(request),
    );

    const result = await engine.sync();

    expect(result.succeeded).toBe(1);

    await expect(
      stores.capsules.findByKey(computeRequestKey(request)),
    ).resolves.toHaveLength(1);
  });

  it("retries a FAILED record on the next sync", async () => {
    const stores = createStores();

    let calls = 0;

    const flakyTransport = {
      async fetchCapsule(): Promise<Capsule> {
        calls += 1;

        if (calls === 1) {
          throw new Error("network unavailable");
        }

        return getMockCapsule();
      },
    };

    const engine = new SyncEngine(flakyTransport, stores);

    await stores.outbox.put(
      createOutboxRecord(request),
    );

    const first = await engine.sync();

    expect(first.failed).toBe(1);

    await expect(
      stores.outbox.get("outbox-1"),
    ).resolves.toMatchObject({
      status: "FAILED",
      attempts: 1,
    });

    const second = await engine.sync();

    expect(second.processed).toBe(1);
    expect(second.succeeded).toBe(1);

    await expect(
      stores.outbox.get("outbox-1"),
    ).resolves.toBeUndefined();

    await expect(
      stores.capsules.findByKey(computeRequestKey(request)),
    ).resolves.toHaveLength(1);

    await expect(stores.syncState.get()).resolves.toMatchObject({
      consecutiveFailures: 0,
    });
  });

  it("picks up a record left in SENDING by an interrupted sync", async () => {
    const stores = createStores();

    const engine = new SyncEngine(
      new MockCapsuleTransport(),
      stores,
    );

    await stores.outbox.put({
      ...createOutboxRecord(request),
      status: "SENDING",
      attempts: 1,
      requestState: "PROCESSING",
    });

    const result = await engine.sync();

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);

    await expect(
      stores.outbox.get("outbox-1"),
    ).resolves.toBeUndefined();
  });

  it("shares one pass between overlapping sync calls", async () => {
    const stores = createStores();

    let calls = 0;

    const slowTransport = {
      async fetchCapsule(): Promise<Capsule> {
        calls += 1;

        await new Promise((resolve) =>
          setTimeout(resolve, 20),
        );

        return getMockCapsule();
      },
    };

    const engine = new SyncEngine(slowTransport, stores);

    await stores.outbox.put(
      createOutboxRecord(request),
    );

    const [first, second] = await Promise.all([
      engine.sync(),
      engine.sync(),
    ]);

    expect(calls).toBe(1);
    expect(second).toBe(first);

    // A later call starts a fresh pass.
    const third = await engine.sync();

    expect(third).not.toBe(first);
    expect(third.processed).toBe(0);
  });

  it("replaces an older stored capsule for the same key", async () => {
    const stores = createStores();

    const base = getMockCapsule();

    const older: Capsule = {
      ...base,
      body: {
        ...base.body,
        id: "older-capsule",
        fetched_at: "2026-10-01T00:00:00Z",
      },
    };

    const newer: Capsule = {
      ...base,
      body: {
        ...base.body,
        id: "newer-capsule",
        fetched_at: "2026-10-04T00:00:00Z",
      },
    };

    await stores.capsules.put({
      capsule: older,
      storedAt: "2026-10-01T00:00:01Z",
    });

    await stores.metadata.put({
      capsuleId: "older-capsule",
      key: older.body.key,
      fetchedAt: older.body.fetched_at,
      ttlSeconds: older.body.ttl_s,
      storedAt: "2026-10-01T00:00:01Z",
    });

    const engine = new SyncEngine(
      {
        async fetchCapsule() {
          return newer;
        },
      },
      stores,
    );

    await stores.outbox.put(createOutboxRecord(request));
    await engine.sync();

    const remaining = await stores.capsules.findByKey(
      computeRequestKey(request),
    );

    expect(
      remaining.map((item) => item.capsule.body.id),
    ).toEqual(["newer-capsule"]);

    await expect(
      stores.metadata.get("older-capsule"),
    ).resolves.toBeUndefined();

    await expect(
      stores.metadata.get("newer-capsule"),
    ).resolves.toBeDefined();
  });

  it("keeps a newer stored capsule and still clears the request", async () => {
    const stores = createStores();

    const base = getMockCapsule();

    const newer: Capsule = {
      ...base,
      body: {
        ...base.body,
        id: "newer-capsule",
        fetched_at: "2026-10-04T00:00:00Z",
      },
    };

    const older: Capsule = {
      ...base,
      body: {
        ...base.body,
        id: "older-capsule",
        fetched_at: "2026-10-01T00:00:00Z",
      },
    };

    await stores.capsules.put({
      capsule: newer,
      storedAt: "2026-10-04T00:00:01Z",
    });

    const engine = new SyncEngine(
      {
        async fetchCapsule() {
          return older;
        },
      },
      stores,
    );

    await stores.outbox.put(createOutboxRecord(request));

    const result = await engine.sync();

    expect(result.succeeded).toBe(1);

    expect(
      (await stores.capsules.listAll()).map(
        (item) => item.capsule.body.id,
      ),
    ).toEqual(["newer-capsule"]);

    await expect(
      stores.outbox.get("outbox-1"),
    ).resolves.toBeUndefined();
  });
});
