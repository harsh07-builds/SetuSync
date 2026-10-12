import {
  computeRequestKey,
  type CapsuleRequest,
  type HexSha256,
} from "@setusync/protocol";

export interface WishlistEntry {
  key: HexSha256;
  request: CapsuleRequest;
  createdAt: string;
  expiresAt: string;
}

export interface WishlistOptions {
  defaultLeaseSeconds?: number;
  now?: () => Date;
}

export class Wishlist {
  private readonly defaultLeaseSeconds: number;
  private readonly now: () => Date;
  private readonly entries = new Map<string, WishlistEntry>();

  public constructor(
    options: WishlistOptions = {},
  ) {
    this.defaultLeaseSeconds =
      options.defaultLeaseSeconds ?? 86400;

    this.now = options.now ?? (() => new Date());

    if (
      !Number.isFinite(this.defaultLeaseSeconds) ||
      this.defaultLeaseSeconds <= 0
    ) {
      throw new RangeError(
        "defaultLeaseSeconds must be a positive number",
      );
    }
  }

  public add(
    request: CapsuleRequest,
    leaseSeconds = this.defaultLeaseSeconds,
  ): WishlistEntry {
    if (
      !Number.isFinite(leaseSeconds) ||
      leaseSeconds <= 0
    ) {
      throw new RangeError(
        "leaseSeconds must be a positive number",
      );
    }

    const createdAtDate = this.now();

    if (!Number.isFinite(createdAtDate.getTime())) {
      throw new TypeError("now must return a valid Date");
    }

    const createdAt = createdAtDate.toISOString();
    const expiresAt = new Date(
      createdAtDate.getTime() +
        leaseSeconds * 1000,
    ).toISOString();

    const entry: WishlistEntry = {
      key: computeRequestKey(request),
      request: structuredClone(request),
      createdAt,
      expiresAt,
    };

    this.entries.set(entry.key, entry);

    return structuredClone(entry);
  }

  public get(
    requestOrKey: CapsuleRequest | string,
  ): WishlistEntry | undefined {
    const key =
      typeof requestOrKey === "string"
        ? requestOrKey
        : computeRequestKey(requestOrKey);

    const entry = this.entries.get(key);

    if (entry === undefined) {
      return undefined;
    }

    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return undefined;
    }

    return structuredClone(entry);
  }

  public has(
    requestOrKey: CapsuleRequest | string,
  ): boolean {
    return this.get(requestOrKey) !== undefined;
  }

  public remove(
    requestOrKey: CapsuleRequest | string,
  ): boolean {
    const key =
      typeof requestOrKey === "string"
        ? requestOrKey
        : computeRequestKey(requestOrKey);

    return this.entries.delete(key);
  }

  public list(): WishlistEntry[] {
    this.removeExpired();

    return Array.from(this.entries.values(), (entry) =>
      structuredClone(entry),
    );
  }

  public removeExpired(): number {
    let removed = 0;

    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry)) {
        this.entries.delete(key);
        removed += 1;
      }
    }

    return removed;
  }

  public remainingLeaseSeconds(
    requestOrKey: CapsuleRequest | string,
  ): number {
    const entry = this.get(requestOrKey);

    if (entry === undefined) {
      return 0;
    }

    const nowMs = this.now().getTime();
    const expiresAtMs = Date.parse(entry.expiresAt);

    return Math.max(
      0,
      (expiresAtMs - nowMs) / 1000,
    );
  }

  public clear(): void {
    this.entries.clear();
  }

  public get size(): number {
    this.removeExpired();
    return this.entries.size;
  }

  private isExpired(
    entry: WishlistEntry,
  ): boolean {
    return (
      this.now().getTime() >=
      Date.parse(entry.expiresAt)
    );
  }
}