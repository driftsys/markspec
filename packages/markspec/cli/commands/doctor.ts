/**
 * @module cli/commands/doctor
 *
 * `markspec doctor` — project health check.
 */

import { Command } from "@cliffy/command";
import { isBelowFloor, parseLockfile, VERSION } from "../../core/mod.ts";
import { compileProject, requireProjectConfig } from "../helpers.ts";

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

    // Toolchain floor skew (slice F): compare the running CLI version against
    // the workspace markspec.lock min-version floor using the slice-B SSOT.
    // A missing lockfile or missing floor means "no floor declared" — not skew.
    let floor: string | undefined;
    try {
      const lockRaw = await Deno.readTextFile(`${projectRoot}/markspec.lock`);
      floor = parseLockfile(lockRaw).lockfile?.meta.toolchain?.minVersion;
    } catch {
      // No lockfile (or unreadable) → no floor. Lockfile validity is the
      // concern of `markspec check`/`lock`, not doctor.
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
        ...(modeInfo ? { disciplineCounts: counts } : {}),
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
    }

    // clig.dev: below-floor is a warning → exit 2 so CI can gate on toolchain
    // skew. Hard errors (no config/profile) throw earlier and yield 1.
    if (belowFloor) Deno.exit(2);
  });
