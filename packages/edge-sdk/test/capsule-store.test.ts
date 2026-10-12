import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { IndexedDbCapsuleStore } from "../src/storage/capsule-store.js";
import { SetuSyncDatabase } from "../src/storage/database.js";
import { getMockCapsule } from "../src/testing/mock-capsule.js";

const TEST_DATABASE_NAME = "SetuSyncCapsuleStore-test";

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

describe("IndexedDbCapsuleStore", () => {
  it("stores and retrieves a Capsule by id", async () => {
    const database = new SetuSyncDatabase(
      TEST_DATABASE_NAME,
    );

    const store = new IndexedDbCapsuleStore(database);
    const capsule = getMockCapsule();

    await store.put({
      capsule,
      storedAt: "2026-10-04T01:00:00Z",
    });

    const result = await store.get(capsule.body.id);

    expect(result).toEqual({
      capsule,
      storedAt: "2026-10-04T01:00:00Z",
    });

    store.close();
  });

  it("finds Capsules by logical request key", async () => {
    const database = new SetuSyncDatabase(
      TEST_DATABASE_NAME,
    );

    const store = new IndexedDbCapsuleStore(database);
    const capsule = getMockCapsule();

    await store.put({
      capsule,
      storedAt: "2026-10-04T01:00:00Z",
    });

    const results = await store.findByKey(
      capsule.body.key,
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.capsule.body.id).toBe(
      capsule.body.id,
    );

    store.close();
  });

  it("returns undefined for an unknown Capsule id", async () => {
    const database = new SetuSyncDatabase(
      TEST_DATABASE_NAME,
    );

    const store = new IndexedDbCapsuleStore(database);

    const result = await store.get(
      "0000000000000000000000000000000000000000000000000000000000000000",
    );

    expect(result).toBeUndefined();

    store.close();
  });

  it("deletes a Capsule by id", async () => {
    const database = new SetuSyncDatabase(
      TEST_DATABASE_NAME,
    );

    const store = new IndexedDbCapsuleStore(database);
    const capsule = getMockCapsule();

    await store.put({
      capsule,
      storedAt: "2026-10-04T01:00:00Z",
    });

    await store.delete(capsule.body.id);

    const result = await store.get(capsule.body.id);

    expect(result).toBeUndefined();

    store.close();
  });
});