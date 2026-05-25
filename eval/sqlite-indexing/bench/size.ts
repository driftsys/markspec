/**
 * @module bench/size
 *
 * Index file-size benchmark. Cold-scans the corpus, stats the on-disk
 * files, then runs `PRAGMA wal_checkpoint(TRUNCATE)` + `VACUUM` and
 * re-stats. Reports raw / post-checkpoint / post-vacuum sizes at each
 * scale.
 *
 * Informational — no §6 budget — but lets the §8 privacy paragraph
 * commit to a defensible disk-budget number ("expect ~X MB at 100k
 * entries on this machine").
 */

import {
  generateProject,
  type GenOptions,
  SCALE_100K,
  SCALE_10K,
  SCALE_1K,
} from "../corpus/generator.ts";
import { createAdapter, type PragmaSet } from "./adapter.ts";
import { SqliteAdapter } from "./sqlite_adapter.ts";
import { record } from "./harness.ts";

const TUNED: PragmaSet = {
  journalMode: "wal",
  synchronous: "normal",
  cacheSizeKb: 64_000,
  mmapSizeMb: 0,
  tempStore: "memory",
};

async function statBytes(path: string): Promise<number> {
  try {
    const s = await Deno.stat(path);
    return s.size;
  } catch {
    return 0;
  }
}

async function totalBytes(dbPath: string): Promise<{
  db: number;
  wal: number;
  shm: number;
  total: number;
}> {
  const db = await statBytes(dbPath);
  const wal = await statBytes(`${dbPath}-wal`);
  const shm = await statBytes(`${dbPath}-shm`);
  return { db, wal, shm, total: db + wal + shm };
}

export async function runSizeMeasurement(
  scale: "1k" | "10k" | "100k",
  resultsDir: string,
): Promise<void> {
  const baseOpts = scale === "100k"
    ? SCALE_100K
    : scale === "10k"
    ? SCALE_10K
    : SCALE_1K;
  const opts: GenOptions = baseOpts;
  console.error(`size: scale=${scale} entries=${opts.entryCount}`);

  const project = generateProject(opts);
  const tmpDir = await Deno.makeTempDir({ prefix: "markspec-eval-size-" });
  const dbPath = `${tmpDir}/index.db`;

  try {
    const adapter = await createAdapter("sqlite3");
    await adapter.open(dbPath, TUNED);
    await adapter.bulkInsertEntries(project.entries);
    await adapter.bulkInsertEdges(project.edges);
    await adapter.bulkInsertGlossary(project.glossary);

    const raw = (adapter as SqliteAdapter).raw();

    const sizesRaw = await totalBytes(dbPath);
    console.error(
      `  raw:             db=${sizesRaw.db} wal=${sizesRaw.wal} ` +
        `shm=${sizesRaw.shm} total=${sizesRaw.total}`,
    );

    // Checkpoint truncates the WAL so its contents are folded into the
    // main db file. The .db file grows, the .db-wal file shrinks to 0.
    raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const sizesPostCheckpoint = await totalBytes(dbPath);
    console.error(
      `  post-checkpoint: db=${sizesPostCheckpoint.db} ` +
        `wal=${sizesPostCheckpoint.wal} shm=${sizesPostCheckpoint.shm} ` +
        `total=${sizesPostCheckpoint.total}`,
    );

    // VACUUM rebuilds the main db file densely-packed, reclaiming any
    // free pages. The size reported here is the steady-state size for
    // a freshly-built index.
    raw.exec("VACUUM");
    const sizesPostVacuum = await totalBytes(dbPath);
    console.error(
      `  post-vacuum:     db=${sizesPostVacuum.db} ` +
        `wal=${sizesPostVacuum.wal} shm=${sizesPostVacuum.shm} ` +
        `total=${sizesPostVacuum.total}`,
    );

    await adapter.close();

    const bytesPerEntry = Math.round(sizesPostVacuum.db / opts.entryCount);

    await record({
      bench: "size",
      scale,
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
      totalMs: 0,
      notes: {
        entries: project.entries.length,
        edges: project.edges.length,
        glossary: project.glossary.length,
        rawDbBytes: sizesRaw.db,
        rawWalBytes: sizesRaw.wal,
        rawShmBytes: sizesRaw.shm,
        rawTotalBytes: sizesRaw.total,
        postCheckpointDbBytes: sizesPostCheckpoint.db,
        postCheckpointWalBytes: sizesPostCheckpoint.wal,
        postCheckpointTotalBytes: sizesPostCheckpoint.total,
        postVacuumDbBytes: sizesPostVacuum.db,
        postVacuumTotalBytes: sizesPostVacuum.total,
        bytesPerEntryVacuumed: bytesPerEntry,
      },
      timestamp: new Date().toISOString(),
    }, resultsDir);
    console.error(`  ~${bytesPerEntry} bytes per entry (post-vacuum db only)`);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}

if (import.meta.main) {
  const resultsDir = new URL("../results", import.meta.url).pathname;
  const scale = (Deno.args[0] ?? "1k") as "1k" | "10k" | "100k";
  await runSizeMeasurement(scale, resultsDir);
}
