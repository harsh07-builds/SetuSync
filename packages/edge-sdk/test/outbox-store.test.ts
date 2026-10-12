import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { IndexedDbOutboxStore } from "../src/storage/outbox-store.js";
import { SetuSyncDatabase } from "../src/storage/database.js";
import { getMockCapsule } from "../src/testing/mock-capsule.js";

const TEST_DATABASE_NAME = "SetuSyncOutboxStore-test";

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);

    request.onsuccess = () => resolve();

    request.onerror = () => {
      reject(
        request.error ??
          new Error(`Failed to delete database: ${name}`),
      );
    };
  });
}

afterEach(async () => {
  await deleteDatabase(TEST_DATABASE_NAME);
});

describe("IndexedDbOutboxStore", () => {
  it("stores and retrieves an outbox record", async () => {
    const database = new SetuSyncDatabase(
      TEST_DATABASE_NAME,
    );

    const store = new IndexedDbOutboxStore(database);
    const capsule = getMockCapsule();

    const record = {
      id: "outbox-001",
      request: {
        engine: capsule.body.engine,
        query: "government hospital",
        params: {
          gl: "in",
          hl: "en",
        },
      },
      status: "PENDING" as const,
      attempts: 0,
      createdAt: "2026-10-04T09:00:00Z",
      updatedAt: "2026-10-04T09:00:00Z",
      requestState: "PENDING" as const,
    };

    await store.put(record);

    const result = await store.get(record.id);

    expect(result).toEqual(record);

    store.close();
  });

  it("lists records by status", async () => {
    const database = new SetuSyncDatabase(
      TEST_DATABASE_NAME,
    );

    const store = new IndexedDbOutboxStore(database);

    const baseRequest = {
      engine: "google",
      query: "government hospital",
      params: {
        gl: "in",
        hl: "en",
      },
    };

    await store.put({
      id: "outbox-001",
      request: baseRequest,
      status: "PENDING",
      attempts: 0,
      createdAt: "2026-10-04T09:00:00Z",
      updatedAt: "2026-10-04T09:00:00Z",
      requestState: "PENDING",
    });

    await store.put({
      id: "outbox-002",
      request: baseRequest,
      status: "FAILED",
      attempts: 2,
      createdAt: "2026-10-04T09:01:00Z",
      updatedAt: "2026-10-04T09:02:00Z",
      lastError: "Network unavailable",
      requestState: "FAILED",
    });

    await store.put({
      id: "outbox-003",
      request: baseRequest,
      status: "PENDING",
      attempts: 1,
      createdAt: "2026-10-04T09:03:00Z",
      updatedAt: "2026-10-04T09:03:00Z",
      requestState: "PENDING",
    });

    const pending = await store.listByStatus("PENDING");
    const failed = await store.listByStatus("FAILED");
    const sending = await store.listByStatus("SENDING");

    expect(pending).toHaveLength(2);
    expect(failed).toHaveLength(1);
    expect(sending).toHaveLength(0);

    store.close();
  });

  it("returns undefined for an unknown outbox id", async () => {
    const database = new SetuSyncDatabase(
      TEST_DATABASE_NAME,
    );

    const store = new IndexedDbOutboxStore(database);

    const result = await store.get("missing-outbox-id");

    expect(result).toBeUndefined();

    store.close();
  });

  it("deletes an outbox record", async () => {
    const database = new SetuSyncDatabase(
      TEST_DATABASE_NAME,
    );

    const store = new IndexedDbOutboxStore(database);

    const record = {
      id: "outbox-001",
      request: {
        engine: "google",
        query: "government hospital",
        params: {
          gl: "in",
          hl: "en",
        },
      },
      status: "PENDING" as const,
      attempts: 0,
      createdAt: "2026-10-04T09:00:00Z",
      updatedAt: "2026-10-04T09:00:00Z",
      requestState: "PENDING" as const,
    };

    await store.put(record);
    await store.delete(record.id);

    const result = await store.get(record.id);

    expect(result).toBeUndefined();

    store.close();
  });
});