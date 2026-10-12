import type {
  SyncStateRecord,
  SyncStateStore,
} from "./types.js";

import {
  SetuSyncDatabase,
  STORE_NAMES,
} from "./database.js";

function requestToPromise<T>(
  request: IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(
        request.error ??
          new Error("IndexedDB request failed"),
      );
    };
  });
}

function transactionToPromise(
  transaction: IDBTransaction,
): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = () => {
      reject(
        transaction.error ??
          new Error("IndexedDB transaction failed"),
      );
    };

    transaction.onabort = () => {
      reject(
        transaction.error ??
          new Error("IndexedDB transaction aborted"),
      );
    };
  });
}

export class IndexedDbSyncStateStore
  implements SyncStateStore
{
  private readonly database: SetuSyncDatabase;
  private databaseHandle: IDBDatabase | undefined;

  public constructor(
    database = new SetuSyncDatabase(),
  ) {
    this.database = database;
  }

  private async openDatabase(): Promise<IDBDatabase> {
    if (this.databaseHandle === undefined) {
      this.databaseHandle = await this.database.open();
    }

    return this.databaseHandle;
  }

  public async get(): Promise<
    SyncStateRecord | undefined
  > {
    const db = await this.openDatabase();

    const transaction = db.transaction(
      STORE_NAMES.SYNC_STATE,
      "readonly",
    );

    return requestToPromise(
      transaction
        .objectStore(STORE_NAMES.SYNC_STATE)
        .get("default"),
    );
  }

  public async put(
    record: SyncStateRecord,
  ): Promise<void> {
    const db = await this.openDatabase();

    const transaction = db.transaction(
      STORE_NAMES.SYNC_STATE,
      "readwrite",
    );

    transaction
      .objectStore(STORE_NAMES.SYNC_STATE)
      .put(record);

    await transactionToPromise(transaction);
  }

  public close(): void {
    this.databaseHandle?.close();
    this.databaseHandle = undefined;
  }
}