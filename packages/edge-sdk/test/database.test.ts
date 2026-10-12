import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import {
  SetuSyncDatabase,
  STORE_NAMES,
} from "../src/storage/database.js";

const TEST_DATABASE_NAME = "SetuSyncDB-test-v1";

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
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

describe("SetuSyncDatabase", () => {
  it("creates all required object stores", async () => {
    const database = new SetuSyncDatabase(
      TEST_DATABASE_NAME,
    );

    const db = await database.open();

    expect(
      db.objectStoreNames.contains(STORE_NAMES.CAPSULES),
    ).toBe(true);

    expect(
      db.objectStoreNames.contains(STORE_NAMES.METADATA),
    ).toBe(true);

    expect(
      db.objectStoreNames.contains(STORE_NAMES.OUTBOX),
    ).toBe(true);

    expect(
      db.objectStoreNames.contains(STORE_NAMES.SYNC_STATE),
    ).toBe(true);

    db.close();
  });

  it("creates the expected indexes", async () => {
    const database = new SetuSyncDatabase(
      TEST_DATABASE_NAME,
    );

    const db = await database.open();

    const transaction = db.transaction(
      [
        STORE_NAMES.CAPSULES,
        STORE_NAMES.METADATA,
        STORE_NAMES.OUTBOX,
      ],
      "readonly",
    );

    const capsules = transaction.objectStore(
      STORE_NAMES.CAPSULES,
    );

    const metadata = transaction.objectStore(
      STORE_NAMES.METADATA,
    );

    const outbox = transaction.objectStore(
      STORE_NAMES.OUTBOX,
    );

    expect(capsules.indexNames.contains("byKey")).toBe(true);
    expect(metadata.indexNames.contains("byKey")).toBe(true);
    expect(outbox.indexNames.contains("byStatus")).toBe(true);
    expect(
      outbox.indexNames.contains("byNextAttemptAt"),
    ).toBe(true);

    db.close();
  });
});