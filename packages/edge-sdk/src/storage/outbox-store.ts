import type {
  OutboxRecord,
  OutboxStatus,
  OutboxStore,
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

export class IndexedDbOutboxStore
  implements OutboxStore
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

  public async put(
    record: OutboxRecord,
  ): Promise<void> {
    const db = await this.openDatabase();

    const transaction = db.transaction(
      STORE_NAMES.OUTBOX,
      "readwrite",
    );

    transaction
      .objectStore(STORE_NAMES.OUTBOX)
      .put(record);

    await transactionToPromise(transaction);
  }

  public async get(
    id: string,
  ): Promise<OutboxRecord | undefined> {
    const db = await this.openDatabase();

    const transaction = db.transaction(
      STORE_NAMES.OUTBOX,
      "readonly",
    );

    return requestToPromise(
      transaction
        .objectStore(STORE_NAMES.OUTBOX)
        .get(id),
    );
  }

  public async listByStatus(
    status: OutboxStatus,
  ): Promise<OutboxRecord[]> {
    const db = await this.openDatabase();

    const transaction = db.transaction(
      STORE_NAMES.OUTBOX,
      "readonly",
    );

    return requestToPromise(
      transaction
        .objectStore(STORE_NAMES.OUTBOX)
        .index("byStatus")
        .getAll(status),
    );
  }

  public async delete(
    id: string,
  ): Promise<void> {
    const db = await this.openDatabase();

    const transaction = db.transaction(
      STORE_NAMES.OUTBOX,
      "readwrite",
    );

    transaction
      .objectStore(STORE_NAMES.OUTBOX)
      .delete(id);

    await transactionToPromise(transaction);
  }

  public close(): void {
    this.databaseHandle?.close();
    this.databaseHandle = undefined;
  }
}