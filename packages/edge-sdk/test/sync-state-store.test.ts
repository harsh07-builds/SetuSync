import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { SetuSyncDatabase } from "../src/storage/database.js";
import { IndexedDbSyncStateStore } from "../src/storage/sync-state-store.js";
import type { SyncStateRecord } from "../src/storage/types.js";

const databaseNames: string[] = [];

function createStore(): IndexedDbSyncStateStore {
  const databaseName = `SetuSyncSyncStateTest-${crypto.randomUUID()}`;
  databaseNames.push(databaseName);

  return new IndexedDbSyncStateStore(
    new SetuSyncDatabase(databaseName),
  );
}

afterEach(() => {
  for (const databaseName of databaseNames.splice(0)) {
    indexedDB.deleteDatabase(databaseName);
  }
});

describe("IndexedDbSyncStateStore", () => {
  it("returns undefined when no sync state exists", async () => {
    const store = createStore();

    await expect(store.get()).resolves.toBeUndefined();
  });

  it("stores and retrieves sync state", async () => {
    const store = createStore();

    const record: SyncStateRecord = {
      id: "default",
      lastStartedAt: "2026-10-04T09:00:00Z",
      lastCompletedAt: "2026-10-04T09:01:00Z",
      lastSuccessfulAt: "2026-10-04T09:01:00Z",
      consecutiveFailures: 0,
    };

    await store.put(record);

    await expect(store.get()).resolves.toEqual(record);
  });

  it("overwrites the existing sync state", async () => {
    const store = createStore();

    const first: SyncStateRecord = {
      id: "default",
      consecutiveFailures: 1,
    };

    const second: SyncStateRecord = {
      id: "default",
      lastStartedAt: "2026-10-04T10:00:00Z",
      lastCompletedAt: "2026-10-04T10:02:00Z",
      lastSuccessfulAt: "2026-10-04T10:02:00Z",
      consecutiveFailures: 0,
    };

    await store.put(first);
    await store.put(second);

    await expect(store.get()).resolves.toEqual(second);
  });
});