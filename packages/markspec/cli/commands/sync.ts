/**
 * @module cli/commands/sync
 *
 * `markspec sync` — read-only commands surfacing bound-entry state.
 *
 *   sync status [<system>] [--state <state>]                      Group bound entries by remote_state
 *   sync log    [<system>] [--since DATE] [--op X] [--tail N]     Tail NDJSON log
 *   sync show   <displayId>                                        Per-entry detail
 *
 * `sync push` / `pull` / `resolve` / `init` are connector-side and land
 * in per-tool ADRs.
 */

import { Command } from "@cliffy/command";
import { join } from "@std/path";
import {
  aggregateStatusByState,
  type BoundEntryStatus,
  discoverProjectRoot,
  parseLockfile,
  parseLogLine,
  type RemoteState,
  type SyncLogEntry,
} from "../../core/mod.ts";

async function readFileOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return undefined;
  }
}

export const syncCmd = new Command()
  .description("Read-only sync state surface (status, log, show)")
  .command("status [system:string]")
  .description("Group bound entries by remote_state")
  .option("--state <state:string>", "Filter to one remote_state")
  .option("--format <format:string>", "Output format: json")
  .action(async (options, system) => {
    await runStatus(system, options.state, options.format);
  })
  .reset()
  .command("log [system:string]")
  .description("Tail the per-system sync log (NDJSON)")
  .option("--tail <n:number>", "Number of lines from the end", { default: 20 })
  .option("--op <op:string>", "Filter to one op (push|pull|conflict|resolve)")
  .option(
    "--since <date:string>",
    "Filter to entries at or after this RFC 3339 timestamp",
  )
  .option("--format <format:string>", "Output format: json")
  .action(async (options, system) => {
    await runLog(
      system,
      options.tail,
      options.op,
      options.since,
      options.format,
    );
  })
  .reset()
  .command("show <displayId:string>")
  .description("Show full sync state for one bound entry")
  .option("--format <format:string>", "Output format: json")
  .action(async (options, displayId) => {
    await runShow(displayId, options.format);
  });

async function runStatus(
  system: string | undefined,
  state: string | undefined,
  format: string | undefined,
): Promise<void> {
  const root = (await discoverProjectRoot(Deno.cwd(), readFileOrUndefined)) ??
    Deno.cwd();
  const entries = await collectBoundStatuses(root, system);
  const filtered = state
    ? entries.filter((e) => e.remoteState === state)
    : entries;
  if (format === "json") {
    console.log(JSON.stringify({
      command: "sync-status",
      entries: filtered.map((e) => ({ ...e })),
    }));
    return;
  }
  const grouped = aggregateStatusByState(filtered);
  const order: RemoteState[] = [
    "conflict",
    "behind",
    "ahead",
    "unreachable",
    "deleted-upstream",
    "unbound",
    "ok",
  ];
  for (const st of order) {
    const list = grouped.get(st);
    if (!list || list.length === 0) continue;
    console.log(`${st} (${list.length}):`);
    for (const e of list) {
      console.log(`  ${e.displayId}  →  ${e.externalId}`);
    }
    console.log();
  }
}

async function runLog(
  system: string | undefined,
  tail: number,
  op: string | undefined,
  since: string | undefined,
  format: string | undefined,
): Promise<void> {
  const root = (await discoverProjectRoot(Deno.cwd(), readFileOrUndefined)) ??
    Deno.cwd();
  const systems = system ? [system] : await listSyncSystems(root);
  const all: SyncLogEntry[] = [];
  for (const sys of systems) {
    const path = join(root, ".markspec", "sync", sys, "log.ndjson");
    const text = await readFileOrUndefined(path);
    if (text === undefined) continue;
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        all.push(parseLogLine(line));
      } catch { /* skip malformed line */ }
    }
  }
  const filtered = all
    .filter((e) => op === undefined || e.op === op)
    .filter((e) => since === undefined || e.ts >= since);
  filtered.sort((a, b) => a.ts.localeCompare(b.ts));
  const tailed = filtered.slice(Math.max(0, filtered.length - tail));
  if (format === "json") {
    console.log(JSON.stringify({ command: "sync-log", entries: tailed }));
    return;
  }
  for (const e of tailed) {
    console.log(
      `${e.ts}  ${e.op.padEnd(8)} ${e.displayId}  ${e.externalId}  [${
        e.attrsChanged.join(", ")
      }]  ${e.remoteStateBefore}→${e.remoteStateAfter}  ${e.actor}`,
    );
  }
}

async function runShow(
  displayId: string,
  format: string | undefined,
): Promise<void> {
  const root = (await discoverProjectRoot(Deno.cwd(), readFileOrUndefined)) ??
    Deno.cwd();
  const entries = await collectBoundStatuses(root, undefined);
  const matches = entries.filter((e) => e.displayId === displayId);
  if (matches.length === 0) {
    console.error(`error: ${displayId} is not bound to any external system`);
    Deno.exit(1);
  }
  if (format === "json") {
    console.log(JSON.stringify({
      command: "sync-show",
      displayId,
      bindings: matches,
    }));
    return;
  }
  console.log(displayId);
  console.log();
  console.log("Bindings:");
  for (const m of matches) {
    console.log(
      `  ${m.externalId}   system: ${m.system}   state: ${m.remoteState}`,
    );
    if (m.lastSyncedAt !== undefined) {
      console.log(`    last synced: ${m.lastSyncedAt}`);
    }
    if (m.lastConflictAt !== undefined) {
      console.log(`    last conflict: ${m.lastConflictAt}`);
    }
  }
}

/**
 * Derive bound-entry status from the lockfile. MVP: `remoteState` is
 * always `"unbound"` until a real connector wires observed events into
 * the entry-properties pipeline (post-MVP).
 */
async function collectBoundStatuses(
  root: string,
  systemFilter: string | undefined,
): Promise<BoundEntryStatus[]> {
  const raw = await readFileOrUndefined(join(root, "markspec.lock"));
  if (raw === undefined) return [];
  const parsed = parseLockfile(raw);
  if (!parsed.lockfile) return [];
  const out: BoundEntryStatus[] = [];
  for (const be of parsed.lockfile.boundEntries) {
    for (const b of be.bindings) {
      if (systemFilter !== undefined && b.system !== systemFilter) continue;
      out.push({
        displayId: be.displayId,
        system: b.system,
        externalId: b.externalId,
        remoteState: "unbound",
        lockedAttributes: [...b.lockedAttributes.keys()],
      });
    }
  }
  return out;
}

/** Enumerate sync systems by scanning `.markspec/sync/*.yaml` mapping files. */
async function listSyncSystems(root: string): Promise<string[]> {
  const out: string[] = [];
  const dir = join(root, ".markspec", "sync");
  try {
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile && e.name.endsWith(".yaml")) {
        out.push(e.name.replace(/\.yaml$/, ""));
      }
    }
  } catch { /* no sync dir */ }
  return out;
}
