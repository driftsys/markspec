/**
 * @module bench/cold_scan
 *
 * Cold-scan benchmark. Measures how fast a fresh SQLite index can be
 * populated from a synthetic project of N entries, sweeping a few pragma
 * combinations to find the production-recommended set.
 *
 * §6 budget: cold index at 10 000 entries must complete in < 5 s.
 *
 * Pragma sweep variants:
 *   - baseline       — WAL + synchronous=full + small cache + no mmap
 *   - tuned          — WAL + synchronous=normal + cache=64MB + no mmap
 *   - tuned + mmap   — WAL + synchronous=normal + cache=64MB + mmap=256MB
 *   - unsafe         — WAL + synchronous=off (correctness-unsafe; upper bound)
 *
 * Each pragma set runs `ITERATIONS` cold scans (fresh tmp directory each
 * time) with `WARMUP` warmup runs to filter JIT + filesystem-cache jitter.
 * Output: one BenchResult per (scale × pragma-set) tuple.
 */

import {
  generateProject,
  type GenOptions,
  SCALE_100K,
  SCALE_10K,
  SCALE_1K,
} from "../corpus/generator.ts";
import { createAdapter, type PragmaSet, resolveDriverName } from "./adapter.ts";
import { measure, record, summarise } from "./harness.ts";

const ITERATIONS = 5;
const WARMUP = 1;

const PRAGMA_SETS: ReadonlyArray<{ name: string; pragmas: PragmaSet }> = [
  {
    name: "baseline",
    pragmas: {
      journalMode: "wal",
      synchronous: "full",
      cacheSizeKb: 2_000,
      mmapSizeMb: 0,
      tempStore: "default",
    },
  },
  {
    name: "tuned",
    pragmas: {
      journalMode: "wal",
      synchronous: "normal",
      cacheSizeKb: 64_000,
      mmapSizeMb: 0,
      tempStore: "memory",
    },
  },
  {
    name: "tuned+mmap",
    pragmas: {
      journalMode: "wal",
      synchronous: "normal",
      cacheSizeKb: 64_000,
      mmapSizeMb: 256,
      tempStore: "memory",
    },
  },
  {
    name: "unsafe",
    pragmas: {
      journalMode: "wal",
      synchronous: "off",
      cacheSizeKb: 64_000,
      mmapSizeMb: 256,
      tempStore: "memory",
    },
  },
];

function pragmasToRecord(p: PragmaSet): Record<string, string | number> {
  return {
    journalMode: p.journalMode,
    synchronous: p.synchronous,
    cacheSizeKb: p.cacheSizeKb,
    mmapSizeMb: p.mmapSizeMb,
    tempStore: p.tempStore,
  };
}

export async function runColdScan(
  scale: "1k" | "10k" | "100k",
  resultsDir: string,
): Promise<void> {
  const baseOpts = scale === "100k"
    ? SCALE_100K
    : scale === "10k"
    ? SCALE_10K
    : SCALE_1K;
  const opts: GenOptions = baseOpts;
  console.error(
    `cold_scan: scale=${scale} entries=${opts.entryCount} ` +
      `iterations=${ITERATIONS} warmup=${WARMUP}`,
  );

  console.error(`generating corpus...`);
  const tGen0 = performance.now();
  const project = generateProject(opts);
  const genMs = performance.now() - tGen0;
  console.error(
    `  ${project.entries.length} entries, ${project.edges.length} edges, ` +
      `${project.glossary.length} glossary (${genMs.toFixed(1)} ms)`,
  );

  for (const { name, pragmas } of PRAGMA_SETS) {
    const fn = async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "markspec-eval-" });
      try {
        const adapter = await createAdapter("sqlite3");
        await adapter.open(`${tmpDir}/index.db`, pragmas);
        await adapter.bulkInsertEntries(project.entries);
        await adapter.bulkInsertEdges(project.edges);
        await adapter.bulkInsertGlossary(project.glossary);
        await adapter.close();
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    };
    const { samplesMs, totalMs } = await measure(
      `cold_scan/${scale}/${name}`,
      fn,
      { iterations: ITERATIONS, warmup: WARMUP },
    );
    const result = summarise({
      bench: `cold_scan-${name}`,
      scale,
      driver: resolveDriverName(),
      pragmas: pragmasToRecord(pragmas),
      iterations: ITERATIONS,
      warmup: WARMUP,
      samplesMs,
      totalMs,
      notes: {
        entries: project.entries.length,
        edges: project.edges.length,
        glossary: project.glossary.length,
      },
    });
    await record(result, resultsDir);
    console.error(
      `  [${name}] p50=${result.p50Ms.toFixed(1)}ms ` +
        `p95=${result.p95Ms.toFixed(1)}ms ` +
        `mean=${result.meanMs.toFixed(1)}ms ` +
        `max=${result.maxMs.toFixed(1)}ms`,
    );
  }
}

if (import.meta.main) {
  const resultsDir = new URL("../results", import.meta.url).pathname;
  const scale = (Deno.args[0] ?? "1k") as "1k" | "10k" | "100k";
  await runColdScan(scale, resultsDir);
}
