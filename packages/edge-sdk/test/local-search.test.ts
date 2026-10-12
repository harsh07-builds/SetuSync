import { describe, expect, it } from "vitest";
import type { Capsule } from "@setusync/protocol";
import { LocalSearchIndex } from "../src/search/local-search.js";

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

describe("LocalSearchIndex", () => {
  it("indexes capsule results and finds matching text", () => {
    const index = new LocalSearchIndex();

    const capsule = createCapsule("capsule-1", [
      {
        position: 1,
        title: "Government Hospital Bhopal",
        snippet: "Public hospital information and services",
        link: "https://example.com/bhopal",
      },
      {
        position: 2,
        title: "Private Clinic Bhopal",
        snippet: "Clinic and appointment information",
        link: "https://example.com/clinic",
      },
    ]);

    index.indexCapsule(capsule);

    const results = index.search("government hospital");

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Government Hospital Bhopal");
    expect(results[0]?.capsuleId).toBe("capsule-1");
    expect(index.documentCount).toBe(2);
  });

  it("searches across multiple capsules", () => {
    const index = new LocalSearchIndex();

    index.indexCapsules([
      createCapsule("capsule-1", [
        {
          position: 1,
          title: "Government Hospital Bhopal",
          snippet: "Public hospital services",
          link: "https://example.com/1",
        },
      ]),
      createCapsule("capsule-2", [
        {
          position: 1,
          title: "Government Hospital Indore",
          snippet: "District hospital information",
          link: "https://example.com/2",
        },
      ]),
    ]);

    const results = index.search("government hospital");

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.capsuleId).sort()).toEqual([
      "capsule-1",
      "capsule-2",
    ]);
  });

  it("supports prefix matching", () => {
    const index = new LocalSearchIndex();

    index.indexCapsule(
      createCapsule("capsule-1", [
        {
          position: 1,
          title: "Government Hospital",
          snippet: "Public healthcare services",
          link: "https://example.com/hospital",
        },
      ]),
    );

    const results = index.search("govern");

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Government Hospital");
  });

  it("removes all documents belonging to a capsule", () => {
    const index = new LocalSearchIndex();

    index.indexCapsule(
      createCapsule("capsule-1", [
        {
          position: 1,
          title: "Government Hospital",
          snippet: "Public hospital",
          link: "https://example.com/hospital",
        },
      ]),
    );

    expect(index.documentCount).toBe(1);

    index.removeCapsule("capsule-1");

    expect(index.documentCount).toBe(0);
    expect(index.search("government")).toEqual([]);
  });

  it("re-indexing a capsule replaces its previous documents", () => {
    const index = new LocalSearchIndex();

    index.indexCapsule(
      createCapsule("capsule-1", [
        {
          position: 1,
          title: "Old Hospital Result",
          snippet: "Old result",
          link: "https://example.com/old",
        },
      ]),
    );

    index.indexCapsule(
      createCapsule("capsule-1", [
        {
          position: 1,
          title: "New Hospital Result",
          snippet: "New result",
          link: "https://example.com/new",
        },
      ]),
    );

    expect(index.documentCount).toBe(1);
    expect(index.search("new hospital")[0]?.title).toBe(
      "New Hospital Result",
    );
    expect(index.search("old hospital")).toEqual([]);
  });

  it("returns an empty array for blank queries and invalid limits", () => {
    const index = new LocalSearchIndex();

    expect(index.search("")).toEqual([]);
    expect(index.search("   ")).toEqual([]);
    expect(index.search("hospital", 0)).toEqual([]);
    expect(index.search("hospital", -1)).toEqual([]);
  });

  it("limits the number of returned results", () => {
    const index = new LocalSearchIndex();

    index.indexCapsule(
      createCapsule("capsule-1", [
        {
          position: 1,
          title: "Government Hospital One",
          snippet: "Hospital",
          link: "https://example.com/1",
        },
        {
          position: 2,
          title: "Government Hospital Two",
          snippet: "Hospital",
          link: "https://example.com/2",
        },
        {
          position: 3,
          title: "Government Hospital Three",
          snippet: "Hospital",
          link: "https://example.com/3",
        },
      ]),
    );

    const results = index.search("government hospital", 2);

    expect(results).toHaveLength(2);
  });
});