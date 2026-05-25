/**
 * @module concurrency/schema_mismatch
 *
 * Schema-version mismatch test. §7 of the spec says a schema mismatch is
 * "treated exactly as corruption ⇒ silent rebuild." This bench verifies
 * the building blocks are in place:
 *
 *   1. Cold-scan the 1k corpus, close.
 *   2. Tamper with `schema_meta.schema_version` directly.
 *   3. Re-open the index via the adapter.
 *   4. Verify `getSchemaVersion()` returns the tampered value (the
 *      adapter's `open()` uses INSERT OR IGNORE so it doesn't blindly
 *      overwrite — that's the design hook the production rebuild path
 *      needs).
 *   5. Trigger the rebuild path manually: delete `index.db` + re-scan +
 *      verify post-rebuild version is correct.
 *
 * Output: a SchemaMismatchResult per field tested.
 *
 * Note: this bench tests the **mechanism**, not a fully-implemented
 * production detect-and-rebuild flow. The production indexer (Phase 2)
 * is expected to wrap `open()` with: open → getSchemaVersion() → compare
 * → delete + cold-scan if mismatch. The eval surfaces that all the
 * primitives needed for that flow work as expected.
 */

import { Database } from "jsr:@db/sqlite@^0.13.0";
import { generateProject, SCALE_1K } from "../corpus/generator.ts";
import { createAdapter, type PragmaSet } from "../bench/adapter.ts";
import { record } from "../bench/harness.ts";
import { SCHEMA_VERSION } from "../bench/sqlite_adapter.ts";

export type VersionField = "schema_version";

const TUNED: PragmaSet = {
  journalMode: "wal",
  synchronous: "normal",
  cacheSizeKb: 64_000,
  mmapSizeMb: 0,
  tempStore: "memory",
};

const TAMPERED_VERSION = 999;

export async function runSchemaMismatch(
  _field: VersionField,
  resultsDir: string,
): Promise<void> {
  console.error(`schema_mismatch: scale=1k field=schema_version`);

  const project = generateProject(SCALE_1K);
  const tmpDir = await Deno.makeTempDir({
    prefix: "markspec-eval-schema-mismatch-",
  });
  const dbPath = `${tmpDir}/index.db`;
  const notes: Record<string, string | number> = {};

  try {
    // Step 1: cold-scan to populate the db
    {
      const adapter = await createAdapter("sqlite3");
      await adapter.open(dbPath, TUNED);
      await adapter.bulkInsertEntries(project.entries);
      await adapter.bulkInsertEdges(project.edges);
      await adapter.bulkInsertGlossary(project.glossary);

      const initialVersion = await adapter.getSchemaVersion();
      notes.initialVersion = String(initialVersion);
      console.error(`  initial version: ${initialVersion}`);

      await adapter.close();
    }

    // Step 2: tamper with schema_version directly via raw SQLite
    {
      const raw = new Database(dbPath);
      raw.exec(
        "UPDATE schema_meta SET value = ?1 WHERE key = 'schema_version'",
        String(TAMPERED_VERSION),
      );
      raw.close();
      console.error(`  tampered version → ${TAMPERED_VERSION}`);
    }

    // Step 3 + 4: re-open and verify the adapter sees the tampered value
    {
      const adapter = await createAdapter("sqlite3");
      await adapter.open(dbPath, TUNED);
      const observedAfterTamper = await adapter.getSchemaVersion();
      notes.observedAfterTamper = String(observedAfterTamper);
      notes.detected = observedAfterTamper === TAMPERED_VERSION ? "yes" : "no";
      notes.expected = String(SCHEMA_VERSION);
      console.error(
        `  re-opened: observed=${observedAfterTamper}, expected=${SCHEMA_VERSION}, ` +
          `mismatch detected=${notes.detected}`,
      );

      await adapter.close();
    }

    // Step 5: simulate the §7 rebuild path — delete + cold-scan
    {
      await Deno.remove(dbPath);
      for (const suffix of ["-wal", "-shm"]) {
        try {
          await Deno.remove(`${dbPath}${suffix}`);
        } catch { /* may not exist */ }
      }

      const adapter = await createAdapter("sqlite3");
      await adapter.open(dbPath, TUNED);
      await adapter.bulkInsertEntries(project.entries);
      await adapter.bulkInsertEdges(project.edges);
      await adapter.bulkInsertGlossary(project.glossary);
      const postRebuildVersion = await adapter.getSchemaVersion();
      notes.postRebuildVersion = String(postRebuildVersion);
      notes.rebuilt = postRebuildVersion === SCHEMA_VERSION ? "yes" : "no";
      console.error(
        `  post-rebuild version: ${postRebuildVersion} ` +
          `(rebuild succeeded=${notes.rebuilt})`,
      );

      await adapter.close();
    }

    await record({
      bench: "schema_mismatch",
      scale: "1k",
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
      notes,
      timestamp: new Date().toISOString(),
    }, resultsDir);
    console.error(
      `  result: detected=${notes.detected}, rebuilt=${notes.rebuilt}`,
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}

if (import.meta.main) {
  const resultsDir = new URL("../results", import.meta.url).pathname;
  await runSchemaMismatch("schema_version", resultsDir);
}
