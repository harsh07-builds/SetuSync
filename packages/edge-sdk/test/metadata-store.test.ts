import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { IndexedDbMetadataStore } from "../src/storage/metadata-store.js";
import { SetuSyncDatabase } from "../src/storage/database.js";
import { getMockCapsule } from "../src/testing/mock-capsule.js";

const TEST_DATABASE_NAME = "SetuSyncMetadataStore-test";

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

describe("IndexedDbMetadataStore", () => {
  it("stores and retrieves metadata by Capsule id", async () => {
    const database = new SetuSyncDatabase(
      TEST_DATABASE_NAME,
    );

    const store = new IndexedDbMetadataStore(database);
    const capsule = getMockCapsule();

    const record = {
      capsuleId: capsule.body.id,
      key: capsule.body.key,
      fetchedAt: capsule.body.fetched_at,
      ttlSeconds: capsule.body.ttl_s,
      storedAt: "2026-10-04T09:00:00Z",
    };

    await store.put(record);

    const result = await store.get(capsule.body.id);

    expect(result).toEqual(record);

    store.close();
  });

  it("finds metadata by logical request key", async () => {
    const database = new SetuSyncDatabase(
      TEST_DATABASE_NAME,
    );

    const store = new IndexedDbMetadataStore(database);
    const capsule = getMockCapsule();

    const record = {
      capsuleId: capsule.body.id,
      key: capsule.body.key,
      fetchedAt: capsule.body.fetched_at,
      ttlSeconds: capsule.body.ttl_s,
      storedAt: "2026-10-04T09:00:00Z",
    };

    await store.put(record);

    const results = await store.findByKey(
      capsule.body.key,
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.capsuleId).toBe(
      capsule.body.id,
    );
    expect(results[0]?.key).toBe(
      capsule.body.key,
    );

    store.close();
  });

  it("returns undefined for unknown Capsule metadata", async () => {
    const database = new SetuSyncDatabase(
      TEST_DATABASE_NAME,
    );

    const store = new IndexedDbMetadataStore(database);

    const result = await store.get(
      "0000000000000000000000000000000000000000000000000000000000000000",
    );

    expect(result).toBeUndefined();

    store.close();
  });

  it("deletes metadata by Capsule id", async () => {
    const database = new SetuSyncDatabase(
      TEST_DATABASE_NAME,
    );

    const store = new IndexedDbMetadataStore(database);
    const capsule = getMockCapsule();

    await store.put({
      capsuleId: capsule.body.id,
      key: capsule.body.key,
      fetchedAt: capsule.body.fetched_at,
      ttlSeconds: capsule.body.ttl_s,
      storedAt: "2026-10-04T09:00:00Z",
    });

    await store.delete(capsule.body.id);

    const result = await store.get(capsule.body.id);

    expect(result).toBeUndefined();

    store.close();
  });
});