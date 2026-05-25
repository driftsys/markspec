/**
 * @module concurrency/wal_contention
 *
 * SQLite WAL concurrency stress test. §4 of the spec claims: "readers
 * never block the writer, the writer never blocks readers." This bench
 * verifies that's true under sustained 1-writer + N-reader load matching
 * the LSP-writer + CLI-reader topology.
 *
 * Topology:
 *   - 1 writer subprocess: continuous updateEntry() at the 10k scale.
 *   - 8 reader subprocesses: continuous getEntryById() against a rotating
 *     set of 64 random keys.
 *   - Duration: DURATION_SEC (default 10 s) — adjust upward for a true
 *     sustained-load test once correctness is confirmed.
 *
 * Each worker writes a `STATS {...}` JSON line at end with ops count and
 * latency percentiles. The parent collects them and reports aggregate
 * throughput + per-role p95.
 */

import { generateProject, SCALE_10K } from "../corpus/generator.ts";
import { createAdapter, type PragmaSet } from "../bench/adapter.ts";
import { record } from "../bench/harness.ts";

const READER_COUNT = 8;
const DURATION_SEC = 10;

const TUNED: PragmaSet = {
  journalMode: "wal",
  synchronous: "normal",
  cacheSizeKb: 64_000,
  mmapSizeMb: 0,
  tempStore: "memory",
};

interface WorkerStats {
  readonly role: "writer" | "reader";
  readonly ops: number;
  readonly errors: number;
  readonly durationSec: string;
  readonly opsPerSec: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly samples: number;
}

interface Worker {
  readonly child: Deno.ChildProcess;
  readonly outBuffered: { value: string };
}

async function spawnWorker(
  role: "writer" | "reader",
  dbPath: string,
  workerScript: string,
): Promise<Worker> {
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-ffi",
      "--allow-env",
      "--allow-net",
      workerScript,
      role,
      dbPath,
      String(DURATION_SEC),
    ],
    stdout: "piped",
    stderr: "inherit",
  }).spawn();
  // Wait for "READY\n"
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  const outBuffered = { value: "" };
  while (!outBuffered.value.includes("READY\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    outBuffered.value += decoder.decode(value);
  }
  // Strip the READY line and keep the rest of the buffer for the STATS
  // line that comes at end. Continue reading in the background.
  outBuffered.value = outBuffered.value.replace("READY\n", "");
  // Pump stdout until close so the buffer ends up containing STATS.
  (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      outBuffered.value += decoder.decode(value);
    }
    reader.releaseLock();
  })();
  return { child, outBuffered };
}

function extractStats(buf: string): WorkerStats | undefined {
  const m = buf.match(/STATS (\{.*\})/);
  if (!m) return undefined;
  return JSON.parse(m[1]) as WorkerStats;
}

export async function runWalContention(resultsDir: string): Promise<void> {
  console.error(
    `wal_contention: scale=10k duration=${DURATION_SEC}s readers=${READER_COUNT}`,
  );

  // Seed the db once via the parent (the workers re-open the same file).
  const project = generateProject(SCALE_10K);
  const tmpDir = await Deno.makeTempDir({ prefix: "markspec-eval-wal-" });
  const dbPath = `${tmpDir}/index.db`;
  const workerScript = new URL("./wal_worker.ts", import.meta.url).pathname;

  try {
    {
      const adapter = await createAdapter("sqlite3");
      await adapter.open(dbPath, TUNED);
      await adapter.bulkInsertEntries(project.entries);
      await adapter.bulkInsertEdges(project.edges);
      await adapter.bulkInsertGlossary(project.glossary);
      await adapter.close();
    }
    console.error(
      `  cold-scanned ${project.entries.length} entries, spawning workers...`,
    );

    const writer = await spawnWorker("writer", dbPath, workerScript);
    const readers: Worker[] = [];
    for (let i = 0; i < READER_COUNT; i++) {
      readers.push(await spawnWorker("reader", dbPath, workerScript));
    }
    console.error(
      `  all workers ready (writer pid=${writer.child.pid}, ` +
        `${readers.length} readers); running for ${DURATION_SEC}s...`,
    );

    // Wait for all workers to exit
    await Promise.all([
      writer.child.status,
      ...readers.map((r) => r.child.status),
    ]);

    const writerStats = extractStats(writer.outBuffered.value);
    const readerStats = readers
      .map((r) => extractStats(r.outBuffered.value))
      .filter((s): s is WorkerStats => s !== undefined);

    if (!writerStats || readerStats.length !== READER_COUNT) {
      console.error(
        `  WARN: missing stats from some workers (writer=${
          writerStats ? "ok" : "missing"
        }, readers=${readerStats.length}/${READER_COUNT})`,
      );
    }

    const readerOpsTotal = readerStats.reduce((a, s) => a + s.ops, 0);
    const readerErrorsTotal = readerStats.reduce((a, s) => a + s.errors, 0);
    const readerP95Max = Math.max(...readerStats.map((s) => s.p95Ms));
    const readerP50Mean = readerStats.length === 0
      ? 0
      : readerStats.reduce((a, s) => a + s.p50Ms, 0) / readerStats.length;

    console.error(
      `  writer: ${writerStats?.ops} ops (${writerStats?.opsPerSec}/s), ` +
        `p50=${writerStats?.p50Ms.toFixed(3)}ms p95=${
          writerStats?.p95Ms.toFixed(3)
        }ms ` +
        `errors=${writerStats?.errors}`,
    );
    console.error(
      `  readers (aggregate): ${readerOpsTotal} ops, ` +
        `p50 mean=${readerP50Mean.toFixed(3)}ms p95 max=${
          readerP95Max.toFixed(3)
        }ms ` +
        `errors=${readerErrorsTotal}`,
    );

    await record({
      bench: "wal_contention",
      scale: "10k",
      driver: "sqlite3",
      pragmas: {
        journalMode: TUNED.journalMode,
        synchronous: TUNED.synchronous,
      },
      iterations: 1,
      warmup: 0,
      samplesMs: [],
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      meanMs: 0,
      maxMs: 0,
      totalMs: DURATION_SEC * 1000,
      notes: {
        readerCount: READER_COUNT,
        durationSec: DURATION_SEC,
        writerOps: writerStats?.ops ?? 0,
        writerOpsPerSec: writerStats?.opsPerSec ?? 0,
        writerP50Ms: writerStats?.p50Ms ?? 0,
        writerP95Ms: writerStats?.p95Ms ?? 0,
        writerP99Ms: writerStats?.p99Ms ?? 0,
        writerErrors: writerStats?.errors ?? 0,
        readersOpsTotal: readerOpsTotal,
        readersOpsPerSecAggregate: Math.round(readerOpsTotal / DURATION_SEC),
        readerP50MeanMs: Number(readerP50Mean.toFixed(4)),
        readerP95MaxMs: Number(readerP95Max.toFixed(4)),
        readerErrorsTotal,
      },
      timestamp: new Date().toISOString(),
    }, resultsDir);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}

if (import.meta.main) {
  const resultsDir = new URL("../results", import.meta.url).pathname;
  await runWalContention(resultsDir);
}
