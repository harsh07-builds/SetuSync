import type { Capsule } from "@setusync/protocol";

import type {
  CapsuleStore,
} from "../storage/index.js";

import {
  planCapsuleReplacement,
} from "../storage/supersede.js";

import {
  LocalSearchIndex,
} from "./local-search.js";

export interface CapsuleIndexerOptions {
  searchIndex?: LocalSearchIndex;
}

export class CapsuleIndexer {
  private readonly capsuleStore: CapsuleStore;
  private readonly searchIndex: LocalSearchIndex;

  public constructor(
    capsuleStore: CapsuleStore,
    options: CapsuleIndexerOptions = {},
  ) {
    this.capsuleStore = capsuleStore;
    this.searchIndex =
      options.searchIndex ?? new LocalSearchIndex();
  }

  public async indexCapsule(
    capsule: Capsule,
  ): Promise<void> {
    const plan = planCapsuleReplacement(
      capsule,
      await this.capsuleStore.findByKey(capsule.body.key),
    );

    if (!plan.store) {
      return;
    }

    await this.capsuleStore.put({
      capsule,
      storedAt: new Date().toISOString(),
    });

    for (const replaced of plan.remove) {
      await this.capsuleStore.delete(replaced.body.id);
      this.searchIndex.removeCapsule(replaced.body.id);
    }

    this.searchIndex.indexCapsule(capsule);
  }

  public async indexCapsules(
    capsules: readonly Capsule[],
  ): Promise<void> {
    for (const capsule of capsules) {
      await this.indexCapsule(capsule);
    }
  }

  public async indexStoredCapsule(
    capsuleId: string,
  ): Promise<boolean> {
    const record =
      await this.capsuleStore.get(capsuleId);

    if (record === undefined) {
      return false;
    }

    this.searchIndex.indexCapsule(record.capsule);

    return true;
  }

  public async rebuildAll(): Promise<number> {
    const records =
      await this.capsuleStore.listAll();

    this.searchIndex.clear();

    for (const record of records) {
      this.searchIndex.indexCapsule(record.capsule);
    }

    return records.length;
  }

  public removeCapsule(capsuleId: string): void {
    this.searchIndex.removeCapsule(capsuleId);
  }

  public async removeStoredCapsule(
    capsuleId: string,
  ): Promise<boolean> {
    const record =
      await this.capsuleStore.get(capsuleId);

    if (record === undefined) {
      return false;
    }

    await this.capsuleStore.delete(capsuleId);
    this.searchIndex.removeCapsule(capsuleId);

    return true;
  }

  public async rebuildForKey(
    key: string,
  ): Promise<number> {
    const records =
      await this.capsuleStore.findByKey(key);

    for (const record of records) {
      this.searchIndex.indexCapsule(record.capsule);
    }

    return records.length;
  }

  public clearIndex(): void {
    this.searchIndex.clear();
  }

  public getIndex(): LocalSearchIndex {
    return this.searchIndex;
  }
}
