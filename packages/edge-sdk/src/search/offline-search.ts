import type { Capsule } from "@setusync/protocol";
import {
  LocalSearchIndex,
  type LocalSearchHit,
} from "./local-search.js";

export type ConnectivityState = "ONLINE" | "OFFLINE";

export type SearchState =
  | "IDLE"
  | "SEARCHING"
  | "RESULTS"
  | "EMPTY"
  | "ERROR";

export interface OfflineSearchSnapshot {
  connectivity: ConnectivityState;
  state: SearchState;
  query: string;
  results: LocalSearchHit[];
  error?: string;
}

export interface OfflineSearchOptions {
  initialConnectivity?: ConnectivityState;
}

export class OfflineSearch {
  private readonly index: LocalSearchIndex;

  private connectivity: ConnectivityState;
  private state: SearchState = "IDLE";
  private query = "";
  private results: LocalSearchHit[] = [];
  private error: string | undefined;

  public constructor(
    options: OfflineSearchOptions = {},
    index = new LocalSearchIndex(),
  ) {
    this.index = index;
    this.connectivity =
      options.initialConnectivity ?? "OFFLINE";
  }

  public setConnectivity(
    connectivity: ConnectivityState,
  ): void {
    this.connectivity = connectivity;
  }

  public indexCapsule(capsule: Capsule): void {
    this.index.indexCapsule(capsule);
  }

  public indexCapsules(capsules: readonly Capsule[]): void {
    this.index.indexCapsules(capsules);
  }

  public removeCapsule(capsuleId: string): void {
    this.index.removeCapsule(capsuleId);
  }

  public clearIndex(): void {
    this.index.clear();
    this.query = "";
    this.results = [];
    this.state = "IDLE";
    this.error = undefined;
  }

  public search(
    query: string,
    limit = 20,
  ): OfflineSearchSnapshot {
    this.query = query.trim();
    this.error = undefined;

    if (this.query.length === 0) {
      this.results = [];
      this.state = "IDLE";

      return this.snapshot();
    }

    this.state = "SEARCHING";

    try {
      this.results = this.index.search(
        this.query,
        limit,
      );

      this.state =
        this.results.length > 0
          ? "RESULTS"
          : "EMPTY";
    } catch (error) {
      this.results = [];
      this.state = "ERROR";
      this.error =
        error instanceof Error
          ? error.message
          : "Local search failed";
    }

    return this.snapshot();
  }

  public getSnapshot(): OfflineSearchSnapshot {
    return this.snapshot();
  }

  public get documentCount(): number {
    return this.index.documentCount;
  }

  private snapshot(): OfflineSearchSnapshot {
    return {
      connectivity: this.connectivity,
      state: this.state,
      query: this.query,
      results: [...this.results],
      ...(this.error !== undefined
        ? { error: this.error }
        : {}),
    };
  }
}