import type { Capsule } from "@setusync/protocol";
import type { CapsuleTransport } from "../transport.js";
import { planCapsuleReplacement } from "../storage/supersede.js";
import type { CapsuleVerificationResult } from "../verification/capsule-verifier.js";
import type {
  CapsuleRecord,
  CapsuleMetadataRecord,
  OutboxRecord,
  SyncStateRecord,
  OutboxStore,
  CapsuleStore,
  MetadataStore,
  SyncStateStore,
} from "../storage/index.js";

export interface SyncEngineStores {
  outbox: OutboxStore;
  capsules: CapsuleStore;
  metadata: MetadataStore;
  syncState: SyncStateStore;
}

export interface SyncCapsuleVerifier {
  verify(capsule: Capsule): Promise<CapsuleVerificationResult>;
}

export interface SyncEngineOptions {
  now?: () => Date;
  /**
   * When provided, every fetched capsule must verify before it is stored.
   * A rejected capsule marks its outbox record FAILED and is not persisted.
   */
  verifier?: SyncCapsuleVerifier;
}

export interface SyncRunResult {
  processed: number;
  succeeded: number;
  failed: number;
  startedAt: string;
  completedAt: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown sync error";
}

function createMetadataRecord(
  capsule: CapsuleRecord["capsule"],
  storedAt: string,
): CapsuleMetadataRecord {
  return {
    capsuleId: capsule.body.id,
    key: capsule.body.key,
    fetchedAt: capsule.body.fetched_at,
    ttlSeconds: capsule.body.ttl_s,
    storedAt,
  };
}

export class SyncEngine {
  private readonly transport: CapsuleTransport;
  private readonly stores: SyncEngineStores;
  private readonly now: () => Date;
  private readonly verifier: SyncCapsuleVerifier | undefined;
  private activeRun: Promise<SyncRunResult> | undefined;

  public constructor(
    transport: CapsuleTransport,
    stores: SyncEngineStores,
    options: SyncEngineOptions = {},
  ) {
    this.transport = transport;
    this.stores = stores;
    this.now = options.now ?? (() => new Date());
    this.verifier = options.verifier;
  }

  /**
   * Runs one sync pass. Calls made while a pass is already running share
   * that pass instead of starting an overlapping one.
   */
  public sync(): Promise<SyncRunResult> {
    if (this.activeRun !== undefined) {
      return this.activeRun;
    }

    const run = this.runSync().finally(() => {
      this.activeRun = undefined;
    });

    this.activeRun = run;

    return run;
  }

  private async runSync(): Promise<SyncRunResult> {
    const startedAt = this.now().toISOString();

    const existingState =
      (await this.stores.syncState.get()) ??
      ({
        id: "default",
        consecutiveFailures: 0,
      } satisfies SyncStateRecord);

    await this.stores.syncState.put({
      ...existingState,
      lastStartedAt: startedAt,
    });

    // FAILED records are retried on every pass. SENDING records can only
    // exist here if an earlier pass was interrupted (e.g. the tab closed
    // mid-request); overlapping passes are prevented by sync().
    const retryableRecords = [
      ...(await this.stores.outbox.listByStatus("PENDING")),
      ...(await this.stores.outbox.listByStatus("FAILED")),
      ...(await this.stores.outbox.listByStatus("SENDING")),
    ];

    let succeeded = 0;
    let failed = 0;

    for (const record of retryableRecords) {
      const outcome = await this.processRecord(record);

      if (outcome === "SUCCEEDED") {
        succeeded += 1;
      } else {
        failed += 1;
      }
    }

    const completedAt = this.now().toISOString();

    const finalState: SyncStateRecord = {
      ...existingState,
      lastStartedAt: startedAt,
      lastCompletedAt: completedAt,
      consecutiveFailures:
        failed === 0
          ? 0
          : existingState.consecutiveFailures + 1,
      ...(failed === 0
        ? { lastSuccessfulAt: completedAt }
        : {}),
    };

    await this.stores.syncState.put(finalState);

    return {
      processed: retryableRecords.length,
      succeeded,
      failed,
      startedAt,
      completedAt,
    };
  }

  private async processRecord(
    record: OutboxRecord,
  ): Promise<"SUCCEEDED" | "FAILED"> {
    const sendingAt = this.now().toISOString();

    const sendingRecord: OutboxRecord = {
      ...record,
      status: "SENDING",
      attempts: record.attempts + 1,
      updatedAt: sendingAt,
      requestState: "PROCESSING",
    };

    await this.stores.outbox.put(sendingRecord);

    try {
      const capsule =
        await this.transport.fetchCapsule(record.request);

      if (this.verifier !== undefined) {
        const verification =
          await this.verifier.verify(capsule);

        if (!verification.valid) {
          throw new Error(
            `Capsule rejected: ${
              verification.reason ?? "verification failed"
            }`,
          );
        }
      }

      const storedAt = this.now().toISOString();

      const capsuleRecord: CapsuleRecord = {
        capsule,
        storedAt,
      };

      const plan = planCapsuleReplacement(
        capsule,
        await this.stores.capsules.findByKey(
          capsule.body.key,
        ),
      );

      if (plan.store) {
        await this.stores.capsules.put(capsuleRecord);

        await this.stores.metadata.put(
          createMetadataRecord(
            capsuleRecord.capsule,
            storedAt,
          ),
        );

        for (const replaced of plan.remove) {
          await this.stores.capsules.delete(
            replaced.body.id,
          );
          await this.stores.metadata.delete(
            replaced.body.id,
          );
        }
      }

      await this.stores.outbox.delete(record.id);

      return "SUCCEEDED";
    } catch (error) {
      const failedAt = this.now().toISOString();

      const failedRecord: OutboxRecord = {
        ...record,
        status: "FAILED",
        attempts: record.attempts + 1,
        updatedAt: failedAt,
        requestState: "FAILED",
        lastError: errorMessage(error),
      };

      await this.stores.outbox.put(failedRecord);

      return "FAILED";
    }
  }
}