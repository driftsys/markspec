/**
 * @module cli/commands/doctor
 *
 * `markspec doctor` — project health check.
 */

import { Command } from "@cliffy/command";
import {
  collectProjectEntries,
  detectOfflineEdgeDrift,
  isBelowFloor,
  parseLockfile,
  VERSION,
} from "../../core/mod.ts";
import {
  compileProject,
  denoDiscoveryIO,
  readFile,
  requireProjectConfig,
} from "../helpers.ts";

export const doctorCmd = new Command()
  .description("Project health check")
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .action(async (options: { format?: string }) => {
    // compileProject() loads config + profile chain and compiles the
    // given paths. We pass `[]` because doctor currently only needs the
    // resolved profile + a per-discipline tally of any entries the
    // helper happens to surface (none, for an empty path list). When a
    // future iteration adds project-wide discovery, the second value
    // becomes meaningful for real-world projects.
    const { result, chain } = await compileProject([]);
    // requireProjectConfig is invoked twice (once via compileProject,
    // once here) so doctor can report `config.name` + `projectRoot`
    // without refactoring the shared helper's return shape. Both reads
    // are fast and idempotent.
    const { config, projectRoot } = await requireProjectConfig();

    // Read markspec.lock once — its floor feeds the toolchain-skew check
    // (slice F) and its generated-cache feeds the lockfile edge-drift check
    // (#658). A missing/unreadable file means "no lockfile"; a present-but-
    // malformed one means "no floor / no drift" — lockfile validity is
    // `markspec check`/`lock`'s concern, not doctor's.
    let floor: string | undefined;
    let lockfilePresent = false;
    let parsedLock: ReturnType<typeof parseLockfile>["lockfile"];
    try {
      const lockRaw = await Deno.readTextFile(`${projectRoot}/markspec.lock`);
      lockfilePresent = true;
      parsedLock = parseLockfile(lockRaw).lockfile;
      floor = parsedLock?.meta.toolchain?.minVersion;
    } catch {
      // No lockfile (or unreadable) → no floor, no drift check.
    }
    const belowFloor = isBelowFloor(VERSION, floor);

    const diagnostics: Array<
      { severity: string; code: string; message: string }
    > = belowFloor
      ? [{
        severity: "warning",
        code: "toolchain-below-floor",
        message: `CLI version ${VERSION} is below the workspace floor ${floor}`,
      }]
      : [];

    // Lockfile edge-drift (#658): surface the same offline drift `check`'s
    // MSL-L212 gate errors on, but as a non-blocking warning — the proactive
    // onramp so a post-upgrade `check` isn't a surprise red build. Only runs
    // when a parseable lockfile exists; the project walk is skipped otherwise
    // so doctor stays fast when there is nothing to compare against.
    let edgeDrift = false;
    let lockedEdges = 0;
    let currentEdges = 0;
    if (parsedLock) {
      // The shared collectProjectEntries walk is exactly what `markspec lock`
      // pinned with (same discovery + default extensions + `exclude:`), so the
      // two edge sets cannot diverge. Corpus-blind, mirroring `check`'s
      // MSL-L212 gate: the lockfile never counts delivered-corpus edges
      // (ADR-030), so neither do we.
      const projectEntries = await collectProjectEntries(
        projectRoot,
        denoDiscoveryIO(),
        { exclude: config.exclude },
      );
      const drift = await detectOfflineEdgeDrift(
        projectEntries.filter((e) => !e.origin),
        parsedLock.generatedCache,
      );
      edgeDrift = drift.drifted;
      lockedEdges = drift.lockedCount;
      currentEdges = drift.currentCount;
      if (edgeDrift) {
        diagnostics.push({
          severity: "warning",
          code: "lockfile-edge-drift",
          message:
            `traceability edges drifted from markspec.lock: locked ${lockedEdges} edge(s), current ${currentEdges} — run \`markspec lock\` to refresh (expected once after a MarkSpec upgrade)`,
        });
      }
    }

    const leaf = chain ? chain.tiers[chain.tiers.length - 1] : null;
    const tierCount = chain ? chain.tiers.length : 0;
    const effective = chain?.effective ?? null;
    const modeInfo = effective?.disciplineMode;

    // Group entries by derivedDiscipline (Slice 1 field). Falls back to
    // "system" when the compiler hasn't classified the entry (pre-Phase-4
    // or no profile loaded).
    const counts: Record<string, number> = {};
    if (effective) {
      for (const e of result.entries.values()) {
        const k = e.derivedDiscipline ?? "system";
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }

    // Delivered-document health (ADR-030): re-load the corpus to report a
    // per-document count + any surviving corpus diagnostics. compileProject()
    // above already exited(1) on any error-severity corpus finding, so only
    // warning/info issues reach here — a missing docs-only file
    // (PROFILE-DELIVERS-002) or a corpus-file parse warning. Every diagnostic
    // loadDeliveredCorpus emits is a delivered-document concern by
    // construction (a missing declared file or a `delivered by …`-attributed
    // parse finding), so none is filtered out; an earlier `PROFILE-DELIVERS`
    // prefix filter dropped corpus parse warnings and left this section only
    // ever able to show the docs-only-missing case.
    let corpusEntryCount = 0;
    const corpusIssues: Array<
      { severity: string; code: string; message: string }
    > = [];
    if (effective && effective.delivers.length > 0) {
      const { loadDeliveredCorpus } = await import("../../core/mod.ts");
      const corpus = await loadDeliveredCorpus(effective.delivers, readFile);
      corpusEntryCount = corpus.entries.length;
      for (const d of corpus.diagnostics) {
        corpusIssues.push({
          severity: d.severity,
          code: d.code,
          message: d.message,
        });
      }
    }
    // Fold into the same diagnostics list the JSON output already reports
    // (toolchain-below-floor lives here too) so both are visible together.
    diagnostics.push(...corpusIssues);

    if (options.format === "json") {
      const output: Record<string, unknown> = {
        project: {
          name: config.name,
          version: config.version,
          root: projectRoot,
        },
        profile: leaf
          ? {
            id: leaf.id,
            version: leaf.version,
            tiers: tierCount,
            ...(modeInfo
              ? {
                disciplineMode: {
                  value: modeInfo.value,
                  origin: modeInfo.origin,
                },
              }
              : {}),
          }
          : null,
        diagnostics,
        toolchain: {
          cliVersion: VERSION,
          floor: floor ?? null,
          belowFloor,
        },
        // Drift fields only when a lockfile was actually compared (parsedLock)
        // — a present-but-malformed lockfile reports `present: true` without
        // the drift fields, mirroring the text output's `parsedLock` guard, so
        // a JSON consumer never reads `edgeDrift: false` as "in sync" when no
        // comparison ran. Lockfile validity stays `check`/`lock`'s concern.
        lockfile: parsedLock
          ? { present: true, edgeDrift, lockedEdges, currentEdges }
          : { present: lockfilePresent },
        ...(modeInfo ? { disciplineCounts: counts } : {}),
        ...(effective && effective.delivers.length > 0
          ? {
            delivers: {
              documents: effective.delivers.length,
              corpusEntries: corpusEntryCount,
              issues: corpusIssues.length,
            },
          }
          : {}),
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.error(`Project: ${config.name} (${config.version})`);
      console.error(`Root: ${projectRoot}`);
      if (leaf) {
        console.error(
          `Profile: ${leaf.id}@${leaf.version} (${tierCount} tier(s))`,
        );
      } else {
        console.error("Profile: no profile configured");
      }
      if (floor === undefined) {
        console.error(
          `Toolchain: CLI ${VERSION} · no workspace floor declared`,
        );
      } else if (belowFloor) {
        console.error(
          `⚠ Toolchain: CLI ${VERSION} below workspace floor ${floor} — upgrade markspec`,
        );
      } else {
        console.error(`Toolchain: CLI ${VERSION} · workspace floor ${floor} ✓`);
      }
      // Lockfile status line — only when a parseable lockfile was compared
      // (a malformed one prints nothing; its validity is `check`'s concern).
      if (parsedLock) {
        if (edgeDrift) {
          console.error(
            `⚠ Lockfile: traceability edges drifted (locked ${lockedEdges}, current ${currentEdges}) — run \`markspec lock\``,
          );
        } else {
          console.error("Lockfile: traceability edges in sync ✓");
        }
      }
      if (modeInfo) {
        console.error(
          `Discipline mode: ${modeInfo.value} (${modeInfo.origin})`,
        );
        const countsLine = Object.entries(counts)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        console.error(`Entries by discipline: ${countsLine || "(none)"}`);
      }
      if (effective && effective.delivers.length > 0) {
        console.error(
          `Delivered documents: ${effective.delivers.length} ` +
            `(${corpusEntryCount} corpus entries` +
            `${
              corpusIssues.length > 0 ? `, ${corpusIssues.length} issue(s)` : ""
            })`,
        );
        for (const d of corpusIssues) {
          console.error(`  ${d.severity}[${d.code}]: ${d.message}`);
        }
      }
    }

    // clig.dev: warnings → exit 2 so CI can gate on toolchain skew, corpus
    // health, or lockfile drift. Hard errors (no config/profile) throw earlier
    // and yield 1. Lockfile drift stays exit 2 here (gentle) — the hard
    // MSL-L212 exit 1 lives in `markspec check` (#658).
    if (belowFloor || corpusIssues.length > 0 || edgeDrift) Deno.exit(2);
  });
