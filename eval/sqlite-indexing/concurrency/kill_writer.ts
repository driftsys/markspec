/**
 * @module concurrency/kill_writer
 *
 * Writer subprocess used by `kill_recovery.ts`. Cold-scans the 1k corpus
 * into the db path passed as `Deno.args[0]`, then loops forever doing
 * `updateEntry` calls until SIGKILLed.
 *
 * Prints "READY\n" to stdout once cold scan is complete and the update
 * loop has started — the parent reads this signal before SIGKILLing.
 */

import { generateProject, SCALE_1K } from "../corpus/generator.ts";
import { createAdapter, type PragmaSet } from "../bench/adapter.ts";

const dbPath = Deno.args[0];
if (!dbPath) {
  console.error("kill_writer: missing db path argument");
  Deno.exit(1);
}

const TUNED: PragmaSet = {
  journalMode: "wal",
  synchronous: "normal",
  cacheSizeKb: 64_000,
  mmapSizeMb: 0,
  tempStore: "memory",
};

const project = generateProject(SCALE_1K);
const adapter = await createAdapter("sqlite3");
await adapter.open(dbPath, TUNED);
await adapter.bulkInsertEntries(project.entries);
await adapter.bulkInsertEdges(project.edges);
await adapter.bulkInsertGlossary(project.glossary);

// Pre-group edges so updateEntry can be called cheaply.
const edgesByFrom = new Map<string, typeof project.edges>();
for (const e of project.edges) {
  const arr = (edgesByFrom.get(e.from) ?? []) as typeof project.edges;
  edgesByFrom.set(e.from, [...arr, e]);
}

// Signal readiness — bypass stdout buffering so the parent sees it
// immediately.
const enc = new TextEncoder();
await Deno.stdout.write(enc.encode("READY\n"));

// Loop forever; parent will SIGKILL us.
let iter = 0;
while (true) {
  const entry = project.entries[iter % project.entries.length];
  const updated = {
    ...entry,
    body: `${entry.body} [iter ${iter}]`,
    contentHash: `mod${iter}`,
  };
  const edges = edgesByFrom.get(entry.id) ?? [];
  await adapter.updateEntry(updated, edges);
  iter++;
}
