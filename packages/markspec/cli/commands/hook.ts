/**
 * @module cli/commands/hook
 *
 * `markspec hook` — run format --check + validate as a pre-commit hook.
 */

import { Command } from "@cliffy/command";
import { ConfigError } from "../../core/mod.ts";
import type { CaptionConventions } from "../../core/mod.ts";
import { loadActiveProfile, readFile } from "../helpers.ts";

export const hookCmd = new Command()
  .description("Run format --check + validate as a pre-commit hook")
  .arguments("[...files:string]")
  .action(async (_options, ...files: string[]) => {
    if (files.length === 0) {
      // Nothing to do — exit clean. Pre-commit frameworks call with
      // zero files when no tracked file matches the hook's filter.
      Deno.exit(0);
    }

    const { discoverProjectRoot, format, loadConfig, parseFile, runPipeline } =
      await import("../../core/mod.ts");

    const projectRoot = await discoverProjectRoot(Deno.cwd(), readFile);
    const chain = projectRoot !== undefined
      ? await loadActiveProfile(projectRoot)
      : null;

    // Load caption conventions for MSL-C072.  A malformed config (ConfigError)
    // IS surfaced — same as the validate command (M-1 fix).  Absent config stays
    // non-fatal; the rule simply stays inactive.
    let hookCaptionConventions: CaptionConventions = {};
    if (projectRoot !== undefined) {
      try {
        const configResult = await loadConfig(projectRoot, readFile);
        if (configResult) {
          hookCaptionConventions = configResult.config.captionConventions;
        }
      } catch (err) {
        if (err instanceof ConfigError) {
          console.error(`error: ${err.message}`);
          Deno.exit(1);
        }
        // Other unexpected errors remain non-fatal.
      }
    }

    let hadError = false;
    const allEntries = [];

    for (const filePath of files) {
      let content: string;
      try {
        content = await Deno.readTextFile(filePath);
      } catch {
        console.error(`error: ${filePath}: file not found`);
        hadError = true;
        continue;
      }

      // Stage 1 — format check. `result.changed` means the file is
      // not in canonical form; reject the commit.
      const formatResult = format(content, { file: filePath });
      for (const d of formatResult.diagnostics) {
        const loc = d.location ? `${d.location.file}:${d.location.line}` : "";
        console.error(`${d.severity}: ${loc} ${d.message}`);
      }
      if (formatResult.changed) {
        console.error(`${filePath}: needs formatting (run 'markspec format')`);
        hadError = true;
      }

      // Stage 2 — collect entries for validation.
      const parsed = await parseFile(content, { file: filePath });
      allEntries.push(...parsed.entries);
    }

    if (!hadError) {
      const result = runPipeline(
        allEntries,
        chain?.effective ?? null,
        hookCaptionConventions,
      );
      for (const d of result.diagnostics) {
        const loc = d.location ? `${d.location.file}:${d.location.line}` : "";
        console.error(`${d.severity}[${d.code}]: ${loc} ${d.message}`);
      }
      if (result.diagnostics.some((d) => d.severity === "error")) {
        hadError = true;
      }
    }

    // Stage 3 — lockfile drift check. Only runs when the project has a lockfile.
    if (projectRoot !== undefined) {
      const { join } = await import("@std/path");
      const lockPath = join(projectRoot, "markspec.lock");
      const lockRaw = await readFile(lockPath);
      if (lockRaw !== undefined) {
        const { parseLockfile, checkDrift, resolveUpstreams } = await import(
          "../../core/mod.ts"
        );
        const parsed = parseLockfile(lockRaw);
        if (!parsed.lockfile) {
          for (const d of parsed.diagnostics) {
            console.error(`${d.severity}: ${d.code}: ${d.message}`);
          }
          hadError = true;
        } else {
          const {
            collectEntries,
            defaultFetchUrl,
            defaultReadFile,
            loadAllMappings,
          } = await import("./lock.ts");
          const configForLock = (await loadConfig(projectRoot, readFile))
            ?.config;
          if (configForLock !== undefined) {
            const lockEntries = await collectEntries(projectRoot);
            const mappings = await loadAllMappings(projectRoot);
            const resolved = await resolveUpstreams({
              entries: lockEntries,
              profileChain: chain ?? [],
              config: configForLock,
              mappings,
              fetchUrl: defaultFetchUrl,
              readFile: defaultReadFile,
            });
            const drift = checkDrift(parsed.lockfile, resolved);
            for (const d of drift) {
              console.error(`${d.severity}: ${d.code}: ${d.message}`);
            }
            if (drift.length > 0) hadError = true;
          }
        }
      }
    }

    console.error(
      hadError
        ? `hook: ${files.length} file(s) checked — failed`
        : `hook: ${files.length} file(s) checked — clean`,
    );

    if (hadError) Deno.exit(1);
  });
