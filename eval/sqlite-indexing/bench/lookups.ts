/**
 * @module bench/lookups
 *
 * Hot-path lookup benchmark. Four query shapes:
 *
 *   1. **getEntryById**           — primary-key point lookup.
 *   2. **getEntryByDisplayId**    — secondary-index point lookup.
 *   3. **getEntriesByDisplayIdPrefix** — prefix scan; the in-memory
 *                                   WorkspaceIndex's main scaling pain point.
 *   4. **getGlossaryBySlug**      — backs xref-glossary-undefined; carries
 *                                   the prose-analysis flagship's <5 ms budget.
 *
 * §6 budgets:
 *   - single-Id query        < 5 ms p95
 *   - glossary lookup        < 5 ms p95
 *   - prefix completion      (no explicit budget; reported anyway)
 *
 * Each query shape runs `ITERATIONS` lookups against a pre-picked set of
 * `KEY_SET_SIZE` random target keys (same set every iteration so the page
 * cache warms predictably). One BenchResult per (scale × shape).
 */

import {
  generateProject,
  type GenOptions,
  SCALE_100K,
  SCALE_10K,
  SCALE_1K,
} from "../corpus/generator.ts";
import { createAdapter, type PragmaSet } from "./adapter.ts";
import { measure, record, summarise } from "./harness.ts";

const ITERATIONS = 500;
const WARMUP = 50;
const KEY_SET_SIZE = 64;
const PREFIX_QUERY = "REQ_0";

export type QueryShape =
  | "getEntryById"
  | "getEntryByDisplayId"
  | "getEntriesByDisplayIdPrefix"
  | "getGlossaryBySlug";

const TUNED: PragmaSet = {
  journalMode: "wal",
  synchronous: "normal",
  cacheSizeKb: 64_000,
  mmapSizeMb: 0,
  tempStore: "memory",
};

function pickKeys<T>(items: readonly T[], n: number, seed: number): T[] {
  // Simple LCG-driven sampling so the picked keys are reproducible.
  let state = (seed >>> 0) || 1;
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out.push(items[state % items.length]);
  }
  return out;
}

export async function runLookups(
  scale: "1k" | "10k" | "100k",
  shape: QueryShape,
  resultsDir: string,
): Promise<void> {
  const baseOpts = scale === "100k"
    ? SCALE_100K
    : scale === "10k"
    ? SCALE_10K
    : SCALE_1K;
  const opts: GenOptions = baseOpts;
  console.error(
    `lookups: scale=${scale} shape=${shape} ` +
      `iterations=${ITERATIONS} warmup=${WARMUP} keySet=${KEY_SET_SIZE}`,
  );

  const project = generateProject(opts);
  const tmpDir = await Deno.makeTempDir({ prefix: "markspec-eval-lookups-" });
  const dbPath = `${tmpDir}/index.db`;
  try {
    const adapter = await createAdapter("sqlite3");
    await adapter.open(dbPath, TUNED);
    await adapter.bulkInsertEntries(project.entries);
    await adapter.bulkInsertEdges(project.edges);
    await adapter.bulkInsertGlossary(project.glossary);

    const idKeys = pickKeys(project.entries, KEY_SET_SIZE, 7).map((e) => e.id);
    const displayIdKeys = pickKeys(project.entries, KEY_SET_SIZE, 13).map((e) =>
      e.displayId
    );
    const glossaryKeys = pickKeys(project.glossary, KEY_SET_SIZE, 23).map((g) =>
      g.slug
    );

    let cursor = 0;
    let fn: () => Promise<void>;
    switch (shape) {
      case "getEntryById":
        fn = async () => {
          await adapter.getEntryById(idKeys[cursor++ % KEY_SET_SIZE]);
        };
        break;
      case "getEntryByDisplayId":
        fn = async () => {
          await adapter.getEntryByDisplayId(
            displayIdKeys[cursor++ % KEY_SET_SIZE],
          );
        };
        break;
      case "getEntriesByDisplayIdPrefix":
        fn = async () => {
          await adapter.getEntriesByDisplayIdPrefix(PREFIX_QUERY);
        };
        break;
      case "getGlossaryBySlug":
        fn = async () => {
          await adapter.getGlossaryBySlug(
            glossaryKeys[cursor++ % KEY_SET_SIZE],
          );
        };
        break;
    }

    const { samplesMs, totalMs } = await measure(
      `lookups/${scale}/${shape}`,
      fn,
      { iterations: ITERATIONS, warmup: WARMUP },
    );

    const result = summarise({
      bench: `lookups-${shape}`,
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
      notes: {
        entries: project.entries.length,
        glossary: project.glossary.length,
        keySet: KEY_SET_SIZE,
        prefixQuery: shape === "getEntriesByDisplayIdPrefix"
          ? PREFIX_QUERY
          : "n/a",
      },
    });
    await record(result, resultsDir);
    console.error(
      `  [${shape}] p50=${result.p50Ms.toFixed(3)}ms ` +
        `p95=${result.p95Ms.toFixed(3)}ms ` +
        `p99=${result.p99Ms.toFixed(3)}ms ` +
        `mean=${result.meanMs.toFixed(3)}ms ` +
        `max=${result.maxMs.toFixed(3)}ms`,
    );

    await adapter.close();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}

if (import.meta.main) {
  const resultsDir = new URL("../results", import.meta.url).pathname;
  const scale = (Deno.args[0] ?? "1k") as "1k" | "10k" | "100k";
  await runLookups(scale, "getEntryById", resultsDir);
  await runLookups(scale, "getEntryByDisplayId", resultsDir);
  await runLookups(scale, "getEntriesByDisplayIdPrefix", resultsDir);
  await runLookups(scale, "getGlossaryBySlug", resultsDir);
}
