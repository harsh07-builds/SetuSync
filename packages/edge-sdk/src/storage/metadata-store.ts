import type {
  CapsuleMetadataRecord,
  MetadataStore,
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

export class IndexedDbMetadataStore
  implements MetadataStore
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
    record: CapsuleMetadataRecord,
  ): Promise<void> {
    const db = await this.openDatabase();

    const transaction = db.transaction(
      STORE_NAMES.METADATA,
      "readwrite",
    );

    transaction
      .objectStore(STORE_NAMES.METADATA)
      .put(record);

    await transactionToPromise(transaction);
  }

  public async get(
    capsuleId: string,
  ): Promise<CapsuleMetadataRecord | undefined> {
    const db = await this.openDatabase();

    const transaction = db.transaction(
      STORE_NAMES.METADATA,
      "readonly",
    );

    return requestToPromise(
      transaction
        .objectStore(STORE_NAMES.METADATA)
        .get(capsuleId),
    );
  }

  public async findByKey(
    key: string,
  ): Promise<CapsuleMetadataRecord[]> {
    const db = await this.openDatabase();

    const transaction = db.transaction(
      STORE_NAMES.METADATA,
      "readonly",
    );

    return requestToPromise(
      transaction
        .objectStore(STORE_NAMES.METADATA)
        .index("byKey")
        .getAll(key),
    );
  }

  public async delete(
    capsuleId: string,
  ): Promise<void> {
    const db = await this.openDatabase();

    const transaction = db.transaction(
      STORE_NAMES.METADATA,
      "readwrite",
    );

    transaction
      .objectStore(STORE_NAMES.METADATA)
      .delete(capsuleId);

    await transactionToPromise(transaction);
  }

  public close(): void {
    this.databaseHandle?.close();
    this.databaseHandle = undefined;
  }
}