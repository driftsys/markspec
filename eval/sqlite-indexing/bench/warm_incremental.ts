/**
 * @module bench/warm_incremental
 *
 * Warm-incremental benchmark. Three change types — each calibrating a
 * different §5.2 invalidation path:
 *
 *   1. **body-edit**     — one entry's body changes; closure size = 1
 *                          (only the entry itself is invalidated).
 *   2. **non-hub-rename** — one mid-degree entry renamed; closure walks
 *                          the reverse-edge index for that entry's id.
 *   3. **hub-rename**    — one high-degree (top hubRatio) entry renamed;
 *                          closure can be in the hundreds-to-thousands.
 *                          This calibrates the §9 Q5 `index.invalidation-cap`
 *                          default (≈200).
 *
 * §6 budget: warm incremental per changed entry must complete in < 50 ms.
 *
 * The hub-rename run also walks every hub once to record the empirical
 * closure-size distribution (mean / max), which is what §9 Q5's cap
 * should be calibrated against.
 *
 * Output: one BenchResult per (scale × change-type) tuple, plus the
 * hub-rename closure-size distribution as `notes.closureMean`,
 * `notes.closureMax`, `notes.closureP95`.
 */

import {
  generateProject,
  type GenOptions,
  SCALE_100K,
  SCALE_10K,
  SCALE_1K,
  type SyntheticEdge,
  type SyntheticEntry,
} from "../corpus/generator.ts";
import { createAdapter, type PragmaSet } from "./adapter.ts";
import { measure, record, summarise } from "./harness.ts";

const ITERATIONS = 20;
const WARMUP = 2;
const CAP = 10_000; // Big cap so we observe the true closure size.

export type ChangeType = "body-edit" | "non-hub-rename" | "hub-rename";

// Tuned pragma set — recommended by cold_scan (ADR-020).
const TUNED: PragmaSet = {
  journalMode: "wal",
  synchronous: "normal",
  cacheSizeKb: 64_000,
  mmapSizeMb: 0,
  tempStore: "memory",
};

function groupEdgesByFrom(
  edges: readonly SyntheticEdge[],
): Map<string, SyntheticEdge[]> {
  const m = new Map<string, SyntheticEdge[]>();
  for (const e of edges) {
    const arr = m.get(e.from) ?? [];
    arr.push(e);
    m.set(e.from, arr);
  }
  return m;
}

function pickTargetIndex(
  changeType: ChangeType,
  opts: GenOptions,
): number {
  switch (changeType) {
    case "body-edit":
      // Mid-range non-hub entry (deterministic; hubs are 0..hubCount-1).
      return Math.floor(opts.entryCount / 2);
    case "non-hub-rename":
      return Math.floor(opts.entryCount * 0.6);
    case "hub-rename":
      // First hub. Hub-rename run additionally sweeps all hubs for
      // closure-size distribution.
      return 0;
  }
}

function applyChange(
  changeType: ChangeType,
  entry: SyntheticEntry,
  iter: number,
): SyntheticEntry {
  if (changeType === "body-edit") {
    const newBody = `${entry.body} [mod-${iter}]`;
    return { ...entry, body: newBody, contentHash: `mod${iter}` };
  }
  // For renames, we model the display-id change. Underlying id stays
  // (so edges keyed by id don't need rewiring — the closure walk on
  // the id is what production renaming would do to find every reverse
  // pointer in the index).
  return { ...entry, displayId: `${entry.displayId}_R${iter}` };
}

export async function runWarmIncremental(
  scale: "1k" | "10k" | "100k",
  changeType: ChangeType,
  resultsDir: string,
): Promise<void> {
  const baseOpts = scale === "100k"
    ? SCALE_100K
    : scale === "10k"
    ? SCALE_10K
    : SCALE_1K;
  const opts: GenOptions = baseOpts;
  console.error(
    `warm_incremental: scale=${scale} change=${changeType} ` +
      `iterations=${ITERATIONS} warmup=${WARMUP}`,
  );

  const project = generateProject(opts);
  const edgesByFrom = groupEdgesByFrom(project.edges);
  console.error(
    `  ${project.entries.length} entries, ${project.edges.length} edges`,
  );

  const tmpDir = await Deno.makeTempDir({ prefix: "markspec-eval-warm-" });
  const dbPath = `${tmpDir}/index.db`;
  try {
    const adapter = await createAdapter("sqlite3");
    await adapter.open(dbPath, TUNED);
    await adapter.bulkInsertEntries(project.entries);
    await adapter.bulkInsertEdges(project.edges);
    await adapter.bulkInsertGlossary(project.glossary);

    const targetIndex = pickTargetIndex(changeType, opts);
    const target = project.entries[targetIndex];
    const targetEdges = edgesByFrom.get(target.id) ?? [];
    console.error(
      `  target=${target.displayId} (idx ${targetIndex}, outDeg=${targetEdges.length})`,
    );

    let iter = 0;
    const fn = async () => {
      const updated = applyChange(changeType, target, iter++);
      await adapter.updateEntry(updated, targetEdges);
      await adapter.reverseEdgeClosure(target.id, CAP);
    };
    const { samplesMs, totalMs } = await measure(
      `warm/${scale}/${changeType}`,
      fn,
      { iterations: ITERATIONS, warmup: WARMUP },
    );

    // For hub-rename, sweep every hub to capture closure-size
    // distribution — the calibration data §9 Q5 actually needs.
    const notes: Record<string, string | number> = {
      entries: project.entries.length,
      edges: project.edges.length,
      targetOutDegree: targetEdges.length,
    };
    if (changeType === "hub-rename") {
      const hubCount = Math.max(1, Math.floor(opts.entryCount * opts.hubRatio));
      const closureSizes: number[] = [];
      for (let h = 0; h < hubCount; h++) {
        const closure = await adapter.reverseEdgeClosure(
          project.entries[h].id,
          CAP,
        );
        closureSizes.push(closure.length);
      }
      closureSizes.sort((a, b) => a - b);
      const sum = closureSizes.reduce((a, b) => a + b, 0);
      notes.closureCount = hubCount;
      notes.closureMean = Math.round(sum / hubCount);
      notes.closureMax = closureSizes[closureSizes.length - 1];
      notes.closureMin = closureSizes[0];
      notes.closureP95 = closureSizes[
        Math.min(
          closureSizes.length - 1,
          Math.floor(0.95 * closureSizes.length),
        )
      ];
      console.error(
        `  closure-size across ${hubCount} hubs: ` +
          `min=${notes.closureMin} mean=${notes.closureMean} ` +
          `p95=${notes.closureP95} max=${notes.closureMax}`,
      );
    }

    const result = summarise({
      bench: `warm-${changeType}`,
      scale,
      driver: "sqlite3",
      pragmas: {
        journalMode: TUNED.journalMode,
        synchronous: TUNED.synchronous,
      },
      iterations: ITERATIONS,
      warmup: WARMUP,
      samplesMs,
      totalMs,
      notes,
    });
    await record(result, resultsDir);
    console.error(
      `  [${changeType}] p50=${result.p50Ms.toFixed(2)}ms ` +
        `p95=${result.p95Ms.toFixed(2)}ms ` +
        `p99=${result.p99Ms.toFixed(2)}ms ` +
        `mean=${result.meanMs.toFixed(2)}ms`,
    );

    await adapter.close();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}

if (import.meta.main) {
  const resultsDir = new URL("../results", import.meta.url).pathname;
  const scale = (Deno.args[0] ?? "1k") as "1k" | "10k" | "100k";
  await runWarmIncremental(scale, "body-edit", resultsDir);
  await runWarmIncremental(scale, "non-hub-rename", resultsDir);
  await runWarmIncremental(scale, "hub-rename", resultsDir);
}
