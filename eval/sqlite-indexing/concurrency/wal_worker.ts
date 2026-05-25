/**
 * @module concurrency/wal_worker
 *
 * Worker subprocess used by `wal_contention.ts`. Acts as either a writer
 * or a reader against a shared SQLite db for `durationSec` seconds.
 *
 * CLI:
 *   wal_worker.ts <role> <dbPath> <durationSec>
 *
 * where `<role>` is "writer" or "reader".
 *
 * Prints "READY\n" to stdout once the adapter is open. At end prints a
 * single JSON line `STATS {...}` with op counts and latency samples.
 */

import { generateProject, SCALE_10K } from "../corpus/generator.ts";
import { createAdapter, type PragmaSet } from "../bench/adapter.ts";

const role = Deno.args[0] as "writer" | "reader";
const dbPath = Deno.args[1];
const durationSec = Number(Deno.args[2]);

if (!["writer", "reader"].includes(role) || !dbPath || !durationSec) {
  console.error("usage: wal_worker.ts <writer|reader> <dbPath> <durationSec>");
  Deno.exit(1);
}

const TUNED: PragmaSet = {
  journalMode: "wal",
  synchronous: "normal",
  cacheSizeKb: 64_000,
  mmapSizeMb: 0,
  tempStore: "memory",
};

// Workers re-generate the corpus locally so they know which ids to
// target — same seed/options as the parent's cold-scan, so the ids
// match exactly.
const project = generateProject(SCALE_10K);
const adapter = await createAdapter("sqlite3");
await adapter.open(dbPath, TUNED);

const enc = new TextEncoder();
await Deno.stdout.write(enc.encode("READY\n"));

const samplesMs: number[] = [];
let ops = 0;
let errors = 0;
const SAMPLE_RATE = 50; // record latency every Nth op (keep memory bounded)

const startMs = performance.now();
const endMs = startMs + durationSec * 1000;

if (role === "writer") {
  const edgesByFrom = new Map<string, typeof project.edges>();
  for (const e of project.edges) {
    const arr = (edgesByFrom.get(e.from) ?? []) as typeof project.edges;
    edgesByFrom.set(e.from, [...arr, e]);
  }
  let iter = 0;
  while (performance.now() < endMs) {
    const entry = project.entries[iter % project.entries.length];
    const updated = {
      ...entry,
      body: `${entry.body} [iter ${iter}]`,
      contentHash: `mod${iter}`,
    };
    const edges = edgesByFrom.get(entry.id) ?? [];
    const t0 = performance.now();
    try {
      await adapter.updateEntry(updated, edges);
      ops++;
      if (ops % SAMPLE_RATE === 0) samplesMs.push(performance.now() - t0);
    } catch {
      errors++;
    }
    iter++;
  }
} else {
  // reader
  // Pick a deterministic set of 64 keys to rotate through — same as the
  // lookups bench's pattern.
  const ids = project.entries.slice(0, 64).map((e) => e.id);
  let cursor = 0;
  while (performance.now() < endMs) {
    const id = ids[cursor++ % ids.length];
    const t0 = performance.now();
    try {
      await adapter.getEntryById(id);
      ops++;
      if (ops % SAMPLE_RATE === 0) samplesMs.push(performance.now() - t0);
    } catch {
      errors++;
    }
  }
}

await adapter.close();

samplesMs.sort((a, b) => a - b);
const p = (q: number) =>
  samplesMs.length === 0 ? 0 : samplesMs[
    Math.min(samplesMs.length - 1, Math.floor(q * samplesMs.length))
  ];
const stats = {
  role,
  ops,
  errors,
  durationSec: ((performance.now() - startMs) / 1000).toFixed(2),
  opsPerSec: Math.round(ops / ((performance.now() - startMs) / 1000)),
  p50Ms: p(0.5),
  p95Ms: p(0.95),
  p99Ms: p(0.99),
  samples: samplesMs.length,
};
await Deno.stdout.write(enc.encode(`STATS ${JSON.stringify(stats)}\n`));
