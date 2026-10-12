import {
  LocalSearchIndex,
  type Capsule,
} from "@setusync/edge-sdk";

function createDemoCapsule(resultCount: number): Capsule {
  return {
    v: 1,
    kid: "benchmark-key",
    alg: "Ed25519",
    sig: "",
    body: {
      id: "benchmark-capsule-001",
      key: "benchmark-request-001",
      chash: "benchmark-content-001",
      engine: "google",
      params: {
        q: "Bhopal",
      },
      fetched_at: "2026-10-04T00:00:00.000Z",
      ttl_s: 86400,
      source: {
        provider: "benchmark",
      },
      organic_results: Array.from(
        { length: resultCount },
        (_, index) => ({
          position: index + 1,
          title:
            index % 2 === 0
              ? `Bhopal City Service ${index + 1}`
              : `Bhopal Local Information ${index + 1}`,
          link: `https://example.com/bhopal/${index + 1}`,
          snippet:
            `Useful local information for Bhopal, ` +
            `Madhya Pradesh, result ${index + 1}.`,
          displayedLink: "example.com",
        }),
      ),
    },
  };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );

  return sorted[index] ?? 0;
}

function formatMilliseconds(value: number): string {
  return `${value.toFixed(3)} ms`;
}

async function main(): Promise<void> {
  const resultCount = 1000;
  const iterations = 100;

  const capsule = createDemoCapsule(resultCount);
  const index = new LocalSearchIndex();

  const indexStart = performance.now();
  index.indexCapsule(capsule);
  const indexDuration = performance.now() - indexStart;

  const searchDurations: number[] = [];

  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();

    const results = index.search("Bhopal", 20);

    const duration = performance.now() - start;
    searchDurations.push(duration);

    if (results.length === 0) {
      throw new Error("Benchmark search returned no results.");
    }
  }

  const totalSearchTime = searchDurations.reduce(
    (sum, duration) => sum + duration,
    0,
  );

  const averageSearchTime = totalSearchTime / iterations;
  const p50 = percentile(searchDurations, 50);
  const p95 = percentile(searchDurations, 95);
  const p99 = percentile(searchDurations, 99);

  console.log("SetuSync Local Search Benchmark");
  console.log("--------------------------------");
  console.log(`Indexed results: ${resultCount}`);
  console.log(`Indexed documents: ${index.documentCount}`);
  console.log(`Search iterations: ${iterations}`);
  console.log(`Indexing time: ${formatMilliseconds(indexDuration)}`);
  console.log(`Average search: ${formatMilliseconds(averageSearchTime)}`);
  console.log(`P50 search: ${formatMilliseconds(p50)}`);
  console.log(`P95 search: ${formatMilliseconds(p95)}`);
  console.log(`P99 search: ${formatMilliseconds(p99)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});