import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import type { Capsule } from "@setusync/protocol";
import { SetuSyncDatabase } from "../src/storage/database.js";
import { IndexedDbCapsuleStore } from "../src/storage/capsule-store.js";
import {
  CapsuleIndexer,
  type CapsuleIndexerOptions,
} from "../src/search/capsule-indexer.js";
import { LocalSearchIndex } from "../src/search/local-search.js";

const databaseNames: string[] = [];

function createIndexer(
  searchIndex?: LocalSearchIndex,
): {
  indexer: CapsuleIndexer;
  capsuleStore: IndexedDbCapsuleStore;
} {
  const databaseName =
    `SetuSyncCapsuleIndexerTest-${crypto.randomUUID()}`;

  databaseNames.push(databaseName);

  const database = new SetuSyncDatabase(databaseName);
  const capsuleStore = new IndexedDbCapsuleStore(database);

  const options: CapsuleIndexerOptions =
    searchIndex === undefined
      ? {}
      : { searchIndex };

  return {
    indexer: new CapsuleIndexer(
      capsuleStore,
      options,
    ),
    capsuleStore,
  };
}

function createCapsule(
  id: string,
  results: Capsule["body"]["organic_results"],
): Capsule {
  return {
    v: 1,
    kid: "test-key",
    alg: "Ed25519",
    sig: "test-signature",
    body: {
      id,
      key: `key-${id}`,
      chash: `hash-${id}`,
      engine: "google",
      params: {},
      fetched_at: "2026-10-04T00:00:00Z",
      ttl_s: 3600,
      source: {
        provider: "serpapi",
      },
      organic_results: results,
      related_questions: [],
    },
  };
}

afterEach(() => {
  for (const databaseName of databaseNames.splice(0)) {
    indexedDB.deleteDatabase(databaseName);
  }
});

describe("CapsuleIndexer", () => {
  it("stores and indexes a capsule", async () => {
    const { indexer, capsuleStore } =
      createIndexer();

    const capsule = createCapsule(
      "capsule-1",
      [
        {
          position: 1,
          title: "Government Hospital Bhopal",
          snippet: "Public hospital services",
          link: "https://example.com/bhopal",
        },
      ],
    );

    await indexer.indexCapsule(capsule);

    const stored =
      await capsuleStore.get("capsule-1");

    expect(stored?.capsule).toEqual(capsule);

    const results =
      indexer.getIndex().search("government hospital");

    expect(results).toHaveLength(1);
    expect(results[0]?.capsuleId).toBe(
      "capsule-1",
    );
  });

  it("indexes an already stored capsule", async () => {
    const { indexer, capsuleStore } =
      createIndexer();

    const capsule = createCapsule(
      "capsule-1",
      [
        {
          position: 1,
          title: "Government Hospital Indore",
          snippet: "District hospital",
          link: "https://example.com/indore",
        },
      ],
    );

    await capsuleStore.put({
      capsule,
      storedAt: "2026-10-04T12:00:00.000Z",
    });

    const indexed =
      await indexer.indexStoredCapsule("capsule-1");

    expect(indexed).toBe(true);

    const results =
      indexer.getIndex().search("government hospital");

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe(
      "Government Hospital Indore",
    );
  });

  it("returns false when indexing a missing stored capsule", async () => {
    const { indexer } = createIndexer();

    await expect(
      indexer.indexStoredCapsule("missing"),
    ).resolves.toBe(false);

    expect(
      indexer.getIndex().documentCount,
    ).toBe(0);
  });

  it("removes a capsule from the search index", async () => {
    const { indexer } = createIndexer();

    const capsule = createCapsule(
      "capsule-1",
      [
        {
          position: 1,
          title: "Government Hospital",
          snippet: "Public hospital",
          link: "https://example.com/hospital",
        },
      ],
    );

    await indexer.indexCapsule(capsule);

    expect(
      indexer.getIndex().documentCount,
    ).toBe(1);

    indexer.removeCapsule("capsule-1");

    expect(
      indexer.getIndex().documentCount,
    ).toBe(0);
  });

  it("removes a stored capsule and its search entry", async () => {
    const { indexer, capsuleStore } =
      createIndexer();

    const capsule = createCapsule(
      "capsule-1",
      [
        {
          position: 1,
          title: "Government Hospital",
          snippet: "Public hospital",
          link: "https://example.com/hospital",
        },
      ],
    );

    await indexer.indexCapsule(capsule);

    const removed =
      await indexer.removeStoredCapsule(
        "capsule-1",
      );

    expect(removed).toBe(true);

    await expect(
      capsuleStore.get("capsule-1"),
    ).resolves.toBeUndefined();

    expect(
      indexer.getIndex().documentCount,
    ).toBe(0);
  });

  it("returns false when removing a missing stored capsule", async () => {
    const { indexer } = createIndexer();

    await expect(
      indexer.removeStoredCapsule("missing"),
    ).resolves.toBe(false);
  });

  it("rebuilds the index for a request key", async () => {
    const searchIndex = new LocalSearchIndex();

    const { indexer, capsuleStore } =
      createIndexer(searchIndex);

    const key = "shared-key";

    const first = createCapsule(
      "capsule-1",
      [
        {
          position: 1,
          title: "Government Hospital Bhopal",
          snippet: "Bhopal hospital",
          link: "https://example.com/bhopal",
        },
      ],
    );

    const second = createCapsule(
      "capsule-2",
      [
        {
          position: 1,
          title: "Government Hospital Indore",
          snippet: "Indore hospital",
          link: "https://example.com/indore",
        },
      ],
    );

    const other = {
      ...createCapsule(
        "capsule-3",
        [
          {
            position: 1,
            title: "Railway Station",
            snippet: "Railway information",
            link: "https://example.com/railway",
          },
        ],
      ),
    };

    await capsuleStore.put({
      capsule: {
        ...first,
        body: {
          ...first.body,
          key,
        },
      },
      storedAt: "2026-10-04T12:00:00.000Z",
    });

    await capsuleStore.put({
      capsule: {
        ...second,
        body: {
          ...second.body,
          key,
        },
      },
      storedAt: "2026-10-04T12:01:00.000Z",
    });

    await capsuleStore.put({
      capsule: other,
      storedAt: "2026-10-04T12:02:00.000Z",
    });

    const rebuilt =
      await indexer.rebuildForKey(key);

    expect(rebuilt).toBe(2);
    expect(indexer.getIndex().documentCount).toBe(2);

    const hospitalResults =
      indexer.getIndex().search("government hospital");

    expect(hospitalResults).toHaveLength(2);
  });

  it("clears the local search index without deleting stored capsules", async () => {
    const { indexer, capsuleStore } =
      createIndexer();

    const capsule = createCapsule(
      "capsule-1",
      [
        {
          position: 1,
          title: "Government Hospital",
          snippet: "Public hospital",
          link: "https://example.com/hospital",
        },
      ],
    );

    await indexer.indexCapsule(capsule);

    indexer.clearIndex();

    expect(
      indexer.getIndex().documentCount,
    ).toBe(0);

    await expect(
      capsuleStore.get("capsule-1"),
    ).resolves.toBeDefined();
  });

  it("replaces an older capsule for the same request key", async () => {
    const { indexer, capsuleStore } = createIndexer();

    const older = createCapsule("capsule-old", [
      {
        position: 1,
        title: "Bhopal Hospital Old Answer",
        snippet: "Outdated",
        link: "https://example.com/old",
      },
    ]);

    const newer = createCapsule("capsule-new", [
      {
        position: 1,
        title: "Bhopal Hospital New Answer",
        snippet: "Current",
        link: "https://example.com/new",
      },
    ]);

    const withVersion = (
      capsule: Capsule,
      fetchedAt: string,
    ): Capsule => ({
      ...capsule,
      body: {
        ...capsule.body,
        key: "shared-key",
        fetched_at: fetchedAt,
      },
    });

    await indexer.indexCapsule(
      withVersion(older, "2026-10-01T00:00:00Z"),
    );
    await indexer.indexCapsule(
      withVersion(newer, "2026-10-04T00:00:00Z"),
    );

    await expect(
      capsuleStore.get("capsule-old"),
    ).resolves.toBeUndefined();

    await expect(
      capsuleStore.get("capsule-new"),
    ).resolves.toBeDefined();

    const titles = indexer
      .getIndex()
      .search("bhopal hospital")
      .map((hit) => hit.title);

    expect(titles).toEqual(["Bhopal Hospital New Answer"]);
  });

  it("ignores an incoming capsule older than the stored one", async () => {
    const { indexer, capsuleStore } = createIndexer();

    const make = (id: string, title: string, fetchedAt: string) => {
      const capsule = createCapsule(id, [
        {
          position: 1,
          title,
          snippet: title,
          link: `https://example.com/${id}`,
        },
      ]);

      return {
        ...capsule,
        body: {
          ...capsule.body,
          key: "shared-key",
          fetched_at: fetchedAt,
        },
      };
    };

    await indexer.indexCapsule(
      make("capsule-new", "Hospital New", "2026-10-04T00:00:00Z"),
    );
    await indexer.indexCapsule(
      make("capsule-old", "Hospital Old", "2026-10-01T00:00:00Z"),
    );

    await expect(
      capsuleStore.get("capsule-old"),
    ).resolves.toBeUndefined();

    expect(
      indexer
        .getIndex()
        .search("hospital")
        .map((hit) => hit.title),
    ).toEqual(["Hospital New"]);
  });
});
