const DATABASE_NAME = "SetuSyncDB";
const DATABASE_VERSION = 1;

export const STORE_NAMES = {
  CAPSULES: "capsules",
  METADATA: "metadata",
  OUTBOX: "outbox",
  SYNC_STATE: "syncState",
} as const;

export type StoreName =
  (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

export class SetuSyncDatabase {
  private readonly databaseName: string;
  private readonly databaseVersion: number;

  public constructor(
    databaseName = DATABASE_NAME,
    databaseVersion = DATABASE_VERSION,
  ) {
    this.databaseName = databaseName;
    this.databaseVersion = databaseVersion;
  }

  public async open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(
        this.databaseName,
        this.databaseVersion,
      );

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_NAMES.CAPSULES)) {
          const capsules = db.createObjectStore(
            STORE_NAMES.CAPSULES,
            { keyPath: "capsule.body.id" },
          );

          capsules.createIndex(
            "byKey",
            "capsule.body.key",
            { unique: false },
          );
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.METADATA)) {
          const metadata = db.createObjectStore(
            STORE_NAMES.METADATA,
            { keyPath: "capsuleId" },
          );

          metadata.createIndex(
            "byKey",
            "key",
            { unique: false },
          );
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.OUTBOX)) {
          const outbox = db.createObjectStore(
            STORE_NAMES.OUTBOX,
            { keyPath: "id" },
          );

          outbox.createIndex(
            "byStatus",
            "status",
            { unique: false },
          );

          outbox.createIndex(
            "byNextAttemptAt",
            "nextAttemptAt",
            { unique: false },
          );
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.SYNC_STATE)) {
          db.createObjectStore(
            STORE_NAMES.SYNC_STATE,
            { keyPath: "id" },
          );
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(
          request.error ??
            new Error("Failed to open SetuSync IndexedDB"),
        );
      };
    });
  }
}