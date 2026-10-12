import { describe, expect, it } from "vitest";
import type { Capsule } from "@setusync/protocol";
import { OfflineSearch } from "../src/search/offline-search.js";

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

describe("OfflineSearch", () => {
  it("starts in OFFLINE and IDLE state", () => {
    const search = new OfflineSearch();

    expect(search.getSnapshot()).toEqual({
      connectivity: "OFFLINE",
      state: "IDLE",
      query: "",
      results: [],
    });
  });

  it("searches indexed capsule data while offline", () => {
    const search = new OfflineSearch();

    search.indexCapsule(
      createCapsule("capsule-1", [
        {
          position: 1,
          title: "Government Hospital Bhopal",
          snippet: "Public hospital services",
          link: "https://example.com/bhopal",
        },
      ]),
    );

    const snapshot = search.search("government hospital");

    expect(snapshot.connectivity).toBe("OFFLINE");
    expect(snapshot.state).toBe("RESULTS");
    expect(snapshot.query).toBe("government hospital");
    expect(snapshot.results).toHaveLength(1);
    expect(snapshot.results[0]?.title).toBe(
      "Government Hospital Bhopal",
    );
  });

  it("returns EMPTY when no local result matches", () => {
    const search = new OfflineSearch();

    search.indexCapsule(
      createCapsule("capsule-1", [
        {
          position: 1,
          title: "Government Hospital Bhopal",
          snippet: "Public hospital services",
          link: "https://example.com/bhopal",
        },
      ]),
    );

    const snapshot = search.search("railway station");

    expect(snapshot.state).toBe("EMPTY");
    expect(snapshot.results).toEqual([]);
    expect(snapshot.query).toBe("railway station");
  });

  it("returns IDLE for a blank query", () => {
    const search = new OfflineSearch();

    search.indexCapsule(
      createCapsule("capsule-1", [
        {
          position: 1,
          title: "Government Hospital",
          snippet: "Public hospital services",
          link: "https://example.com/hospital",
        },
      ]),
    );

    const snapshot = search.search("   ");

    expect(snapshot.state).toBe("IDLE");
    expect(snapshot.query).toBe("");
    expect(snapshot.results).toEqual([]);
  });

  it("tracks connectivity independently from local search", () => {
    const search = new OfflineSearch({
      initialConnectivity: "ONLINE",
    });

    expect(search.getSnapshot().connectivity).toBe("ONLINE");

    search.setConnectivity("OFFLINE");

    expect(search.getSnapshot().connectivity).toBe("OFFLINE");

    search.indexCapsule(
      createCapsule("capsule-1", [
        {
          position: 1,
          title: "Government Hospital",
          snippet: "Public hospital services",
          link: "https://example.com/hospital",
        },
      ]),
    );

    const snapshot = search.search("government hospital");

    expect(snapshot.connectivity).toBe("OFFLINE");
    expect(snapshot.state).toBe("RESULTS");
  });

  it("supports indexing multiple capsules", () => {
    const search = new OfflineSearch();

    search.indexCapsules([
      createCapsule("capsule-1", [
        {
          position: 1,
          title: "Government Hospital Bhopal",
          snippet: "Public hospital",
          link: "https://example.com/bhopal",
        },
      ]),
      createCapsule("capsule-2", [
        {
          position: 1,
          title: "Government Hospital Indore",
          snippet: "District hospital",
          link: "https://example.com/indore",
        },
      ]),
    ]);

    const snapshot = search.search("government hospital");

    expect(snapshot.state).toBe("RESULTS");
    expect(snapshot.results).toHaveLength(2);
    expect(search.documentCount).toBe(2);
  });

  it("removes a capsule from the searchable index", () => {
    const search = new OfflineSearch();

    search.indexCapsule(
      createCapsule("capsule-1", [
        {
          position: 1,
          title: "Government Hospital",
          snippet: "Public hospital",
          link: "https://example.com/hospital",
        },
      ]),
    );

    expect(search.documentCount).toBe(1);

    search.removeCapsule("capsule-1");

    expect(search.documentCount).toBe(0);
    expect(search.search("government hospital").state).toBe("EMPTY");
  });

  it("clears the search index and resets state", () => {
    const search = new OfflineSearch();

    search.indexCapsule(
      createCapsule("capsule-1", [
        {
          position: 1,
          title: "Government Hospital",
          snippet: "Public hospital",
          link: "https://example.com/hospital",
        },
      ]),
    );

    search.search("government hospital");

    expect(search.getSnapshot().state).toBe("RESULTS");
    expect(search.documentCount).toBe(1);

    search.clearIndex();

    expect(search.documentCount).toBe(0);
    expect(search.getSnapshot()).toEqual({
      connectivity: "OFFLINE",
      state: "IDLE",
      query: "",
      results: [],
    });
  });

  it("limits search results", () => {
    const search = new OfflineSearch();

    search.indexCapsule(
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

    const snapshot = search.search("government hospital", 2);

    expect(snapshot.state).toBe("RESULTS");
    expect(snapshot.results).toHaveLength(2);
  });
});