import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";

const PROFILES = {
  P0: {
    name: "clean-network",
    latencyMs: 0,
    failureRate: 0,
    onlineProbability: 1
  },
  P1: {
    name: "low-bandwidth-high-latency",
    latencyMs: 500,
    failureRate: 0,
    onlineProbability: 1
  },
  P2: {
    name: "resets-and-loss",
    latencyMs: 250,
    failureRate: 0.20,
    onlineProbability: 0.80
  },
  P3: {
    name: "bursty-connectivity",
    latencyMs: 300,
    failureRate: 0.10,
    onlineProbability: 0.50
  }
};

const SYSTEMS = [
  "direct",
  "provider-cache",
  "setusync"
];

const DEFAULT_ITERATIONS = 100;

function parseArgs(argv) {
  const args = {
    profile: "P0",
    iterations: DEFAULT_ITERATIONS,
    seed: 42
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];

    if (value === "--profile") {
      args.profile = argv[++i];
      continue;
    }

    if (value === "--iterations") {
      args.iterations = Number(argv[++i]);
      continue;
    }

    if (value === "--seed") {
      args.seed = Number(argv[++i]);
      continue;
    }
  }

  if (!PROFILES[args.profile]) {
    throw new Error(
      `Unknown profile ${args.profile}. Use P0, P1, P2 or P3.`
    );
  }

  if (
    !Number.isInteger(args.iterations) ||
    args.iterations <= 0
  ) {
    throw new Error(
      "--iterations must be a positive integer"
    );
  }

  if (
    !Number.isInteger(args.seed) ||
    args.seed < 0
  ) {
    throw new Error(
      "--seed must be a non-negative integer"
    );
  }

  return args;
}

function createRng(seed) {
  let state = seed >>> 0;

  return () => {
    state = (
      Math.imul(
        1664525,
        state
      ) +
      1013904223
    ) >>> 0;

    return state / 4294967296;
  };
}

function percentile(values, p) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort(
    (a, b) => a - b
  );

  const index =
    (sorted.length - 1) * p;

  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  return (
    sorted[lower] +
    (sorted[upper] - sorted[lower]) *
      (index - lower)
  );
}

function summarize(values) {
  if (values.length === 0) {
    return {
      count: 0,
      min_ms: null,
      p50_ms: null,
      p95_ms: null,
      p99_ms: null,
      max_ms: null,
      mean_ms: null
    };
  }

  const total = values.reduce(
    (sum, value) => sum + value,
    0
  );

  return {
    count: values.length,
    min_ms: Math.min(...values),
    p50_ms: percentile(values, 0.50),
    p95_ms: percentile(values, 0.95),
    p99_ms: percentile(values, 0.99),
    max_ms: Math.max(...values),
    mean_ms: total / values.length
  };
}

function simulateRequest(
  rng,
  profile,
  system
) {
  const started = performance.now();

  const online =
    rng() <= profile.onlineProbability;

  if (!online) {
    return {
      latencyMs: 0,
      outcome: system === "setusync"
        ? "offline-local-or-queued"
        : "offline-failure",
      providerCalls: 0,
      credits: 0
    };
  }

  const failure =
    rng() < profile.failureRate;

  const latency =
    profile.latencyMs +
    rng() * 20;

  if (failure) {
    return {
      latencyMs:
        performance.now() -
        started +
        latency,
      outcome: system === "setusync"
        ? "deferred"
        : "failure",
      providerCalls:
        system === "setusync" ? 0 : 1,
      credits:
        system === "setusync" ? 0 : 1
    };
  }

  if (system === "direct") {
    return {
      latencyMs: latency,
      outcome: "provider-result",
      providerCalls: 1,
      credits: 1
    };
  }

  if (system === "provider-cache") {
    const cached =
      rng() < 0.35;

    return {
      latencyMs:
        cached
          ? Math.max(1, latency * 0.1)
          : latency,
      outcome:
        cached
          ? "provider-cache-hit"
          : "provider-result",
      providerCalls: cached ? 0 : 1,
      credits: cached ? 0 : 1
    };
  }

  return {
    latencyMs:
      Math.max(1, latency * 0.05),
    outcome: "setusync-local-or-relay",
    providerCalls: 0,
    credits: 0
  };
}

function runSystem(
  rng,
  profile,
  system,
  iterations
) {
  const latencies = [];
  let providerCalls = 0;
  let credits = 0;
  let successes = 0;
  let deferred = 0;
  let failures = 0;

  for (
    let i = 0;
    i < iterations;
    i += 1
  ) {
    const result =
      simulateRequest(
        rng,
        profile,
        system
      );

    latencies.push(
      result.latencyMs
    );

    providerCalls +=
      result.providerCalls;

    credits +=
      result.credits;

    if (
      result.outcome ===
        "provider-result" ||
      result.outcome ===
        "provider-cache-hit" ||
      result.outcome ===
        "setusync-local-or-relay" ||
      result.outcome ===
        "offline-local-or-queued"
    ) {
      successes += 1;
    }

    if (
      result.outcome ===
        "deferred"
    ) {
      deferred += 1;
    }

    if (
      result.outcome ===
        "failure" ||
      result.outcome ===
        "offline-failure"
    ) {
      failures += 1;
    }
  }

  return {
    system,
    iterations,
    success_rate:
      successes / iterations,
    deferred_rate:
      deferred / iterations,
    failure_rate:
      failures / iterations,
    provider_calls:
      providerCalls,
    credits_used:
      credits,
    latency_ms:
      summarize(latencies)
  };
}

async function main() {
  const args =
    parseArgs(
      process.argv.slice(2)
    );

  const profile =
    PROFILES[args.profile];

  const results = [];

  for (
    const system of SYSTEMS
  ) {
    const rng =
      createRng(
        args.seed
      );

    results.push(
      runSystem(
        rng,
        profile,
        system,
        args.iterations
      )
    );
  }

  const artifact = {
    schema_version: 1,
    measured_at:
      new Date().toISOString(),
    profile: {
      id: args.profile,
      ...profile
    },
    seed: args.seed,
    iterations:
      args.iterations,
    systems: results,
    note:
      "Simulation harness artifact. Values are measured from this run and are not production claims."
  };

  const outputDir =
    "tools/netsim-bench/results";

  await mkdir(
    outputDir,
    { recursive: true }
  );

  const outputPath =
    `${outputDir}/${args.profile.toLowerCase()}-${args.seed}.json`;

  await writeFile(
    outputPath,
    JSON.stringify(
      artifact,
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(
    JSON.stringify(
      artifact,
      null,
      2
    )
  );

  console.log(
    `\nArtifact: ${outputPath}`
  );
}

await main();