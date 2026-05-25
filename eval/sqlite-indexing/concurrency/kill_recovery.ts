/**
 * @module concurrency/kill_recovery
 *
 * Process-kill recovery test. §7 of the spec promises that a corrupt index
 * is silently rebuilt — this bench verifies the WAL recovery + rebuild
 * paths after a writer dies mid-stream.
 *
 * Procedure (per kill point):
 *   1. Spawn `kill_writer.ts` subprocess against a fresh tmp db. The
 *      writer cold-scans, then loops doing updateEntry calls.
 *   2. Wait for the writer's "READY\n" signal on stdout.
 *   3. Sleep for `killPointMs`, then SIGKILL.
 *   4. Re-open the db via the adapter.
 *   5. Run `PRAGMA integrity_check` and `PRAGMA quick_check`.
 *   6. Verify entries are still readable (point lookup).
 *   7. Record findings.
 *
 * Three kill points sample different mid-stream states:
 *   - start  (5 ms after READY)   — only a few updates landed
 *   - middle (50 ms after READY)  — many updates, likely tx in flight
 *   - end    (200 ms after READY) — many tx completed, recent ones may be
 *                                   in WAL pre-checkpoint
 *
 * Note: this measures whether SQLite's automatic WAL recovery on next
 * open handles SIGKILL cleanly. The §7 "delete + cold rebuild" path is
 * the fallback when integrity_check fails — that scenario is harder
 * to trigger reliably with SIGKILL alone (SQLite is robust to abrupt
 * shutdown thanks to WAL). This bench documents what we actually see.
 */

import { generateProject, SCALE_1K } from "../corpus/generator.ts";
import { createAdapter, type PragmaSet } from "../bench/adapter.ts";
import { SqliteAdapter } from "../bench/sqlite_adapter.ts";
import { record } from "../bench/harness.ts";

export type KillPoint = "start" | "middle" | "end";

const KILL_POINT_DELAYS_MS: Record<KillPoint, number> = {
  start: 5,
  middle: 50,
  end: 200,
};

const TUNED: PragmaSet = {
  journalMode: "wal",
  synchronous: "normal",
  cacheSizeKb: 64_000,
  mmapSizeMb: 0,
  tempStore: "memory",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runKillRecovery(
  killPoint: KillPoint,
  resultsDir: string,
): Promise<void> {
  const delayMs = KILL_POINT_DELAYS_MS[killPoint];
  console.error(`kill_recovery: killPoint=${killPoint} delay=${delayMs}ms`);

  const tmpDir = await Deno.makeTempDir({
    prefix: `markspec-eval-kill-${killPoint}-`,
  });
  const dbPath = `${tmpDir}/index.db`;
  const writerScript = new URL("./kill_writer.ts", import.meta.url).pathname;
  const notes: Record<string, string | number> = { killPoint, delayMs };

  try {
    // Spawn writer subprocess
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-ffi",
        "--allow-env",
        "--allow-net",
        writerScript,
        dbPath,
      ],
      stdout: "piped",
      stderr: "inherit",
    }).spawn();

    // Wait for READY\n signal
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    while (!buffered.includes("READY\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value);
    }
    reader.releaseLock();
    console.error(`  writer ready (pid=${child.pid})`);

    await sleep(delayMs);

    // SIGKILL
    child.kill("SIGKILL");
    const status = await child.status;
    console.error(
      `  killed: signal=${status.signal} success=${status.success}`,
    );
    notes.exitSignal = String(status.signal ?? "<none>");

    // Give the OS a moment to release file handles
    await sleep(10);

    // Re-open via adapter
    let opened = false;
    let integrityOk = false;
    let quickOk = false;
    let readableEntries = 0;
    let openError = "";
    try {
      const adapter = await createAdapter("sqlite3");
      await adapter.open(dbPath, TUNED);
      opened = true;

      // Cast to SqliteAdapter for raw() access (eval-only API).
      const raw = (adapter as SqliteAdapter).raw();
      const integrity = raw.prepare("PRAGMA integrity_check").all<
        { integrity_check: string }
      >();
      integrityOk = integrity.length === 1 &&
        integrity[0].integrity_check === "ok";
      const quick = raw.prepare("PRAGMA quick_check").all<
        { quick_check: string }
      >();
      quickOk = quick.length === 1 && quick[0].quick_check === "ok";

      // Spot-check that point lookups still work by trying a handful.
      const project = generateProject(SCALE_1K);
      for (let i = 0; i < 8; i++) {
        const target = project.entries[i * 100];
        const got = await adapter.getEntryById(target.id);
        if (got) readableEntries++;
      }

      await adapter.close();
    } catch (err) {
      openError = err instanceof Error ? err.message : String(err);
    }

    notes.opened = opened ? "yes" : "no";
    notes.integrityCheck = integrityOk ? "ok" : "FAIL";
    notes.quickCheck = quickOk ? "ok" : "FAIL";
    notes.readableEntries = readableEntries;
    notes.openError = openError;

    console.error(
      `  reopened=${notes.opened}, integrity=${notes.integrityCheck}, ` +
        `quick=${notes.quickCheck}, readable=${readableEntries}/8` +
        (openError ? `, error="${openError}"` : ""),
    );

    await record({
      bench: `kill-${killPoint}`,
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
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}

if (import.meta.main) {
  const resultsDir = new URL("../results", import.meta.url).pathname;
  await runKillRecovery("start", resultsDir);
  await runKillRecovery("middle", resultsDir);
  await runKillRecovery("end", resultsDir);
}
