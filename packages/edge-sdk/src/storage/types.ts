import type {
  Capsule,
  CapsuleRequest,
  RequestState,
} from "@setusync/protocol";

export interface CapsuleRecord {
  capsule: Capsule;
  storedAt: string;
}

export interface CapsuleMetadataRecord {
  capsuleId: string;
  key: string;
  fetchedAt: string;
  ttlSeconds: number;
  storedAt: string;
  lastAccessedAt?: string;
}

export type OutboxStatus =
  | "PENDING"
  | "SENDING"
  | "FAILED";

export interface OutboxRecord {
  id: string;
  request: CapsuleRequest;
  status: OutboxStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt?: string;
  lastError?: string;
  requestState: RequestState;
}

export interface SyncStateRecord {
  id: "default";
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastSuccessfulAt?: string;
  consecutiveFailures: number;
}

export interface CapsuleStore {
  put(record: CapsuleRecord): Promise<void>;

  get(
    capsuleId: string,
  ): Promise<CapsuleRecord | undefined>;

  listAll(): Promise<CapsuleRecord[]>;

  findByKey(key: string): Promise<CapsuleRecord[]>;

  delete(capsuleId: string): Promise<void>;
}

export interface MetadataStore {
  put(record: CapsuleMetadataRecord): Promise<void>;

  get(
    capsuleId: string,
  ): Promise<CapsuleMetadataRecord | undefined>;

  findByKey(
    key: string,
  ): Promise<CapsuleMetadataRecord[]>;

  delete(capsuleId: string): Promise<void>;
}

export interface OutboxStore {
  put(record: OutboxRecord): Promise<void>;

  get(id: string): Promise<OutboxRecord | undefined>;

  listByStatus(status: OutboxStatus): Promise<OutboxRecord[]>;

  delete(id: string): Promise<void>;
}

export interface SyncStateStore {
  get(): Promise<SyncStateRecord | undefined>;

  put(record: SyncStateRecord): Promise<void>;
}
