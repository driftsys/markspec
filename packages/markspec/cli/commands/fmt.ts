/**
 * @module cli/commands/fmt
 *
 * `markspec fmt` — stamp ULIDs, fix indentation, normalize attributes.
 */

import { Command } from "@cliffy/command";
import type { LockEdge, RefIndex } from "../../core/mod.ts";
import { loadActiveProfile, readFile, resolveScope } from "../helpers.ts";

export const fmtCmd = new Command()
  .description("Stamp ULIDs, fix indentation, normalize attributes")
  .option(
    "--check",
    "Check mode: report but don't write (exit 1 if changes needed)",
  )
  .arguments("[...files:string]")
  .action(
    async (
      options: { check?: boolean; quiet?: boolean },
      ...fileArgs: string[]
    ) => {
      const { MARKDOWN_EXTENSIONS } = await import("../../core/mod.ts");
      const scope = await resolveScope(fileArgs, {
        verb: options.check ? "checking format of" : "formatting",
        extensions: MARKDOWN_EXTENSIONS,
        quiet: options.quiet === true,
      });
      const files = scope.files;

      const { discoverProjectRoot } = await import("../../core/mod.ts");
      const projectRoot = await discoverProjectRoot(Deno.cwd(), readFile);
      if (projectRoot !== undefined) {
        await loadActiveProfile(projectRoot);
      }

      const { format } = await import("../../core/mod.ts");

      // Project-aware reference canonicalisation/healing (issue #593, Slice 4).
      // Built once and reused for every file. File-local fmt (no project root)
      // leaves refIndex undefined and skips canonicalisation entirely.
      let refIndex: RefIndex | undefined = undefined;
      let ledger: readonly LockEdge[] = [];
      if (projectRoot !== undefined) {
        const { buildRefIndex, parseLockfile } = await import(
          "../../core/mod.ts"
        );
        const { collectEntries } = await import("./lock.ts");
        const { join } = await import("@std/path");
        const projectEntries = await collectEntries(projectRoot);
        refIndex = buildRefIndex(projectEntries);
        const lockRaw = await readFile(join(projectRoot, "markspec.lock"));
        if (lockRaw !== undefined) {
          const parsed = parseLockfile(lockRaw);
          if (parsed.lockfile) ledger = parsed.lockfile.edges;
        }
      }

      let totalFormatted = 0;
      let totalUnchanged = 0;

      let hasErrors = false;

      for (const filePath of files) {
        let content: string;
        try {
          content = await Deno.readTextFile(filePath);
        } catch {
          console.error(`error: ${filePath}: file not found`);
          hasErrors = true;
          continue;
        }

        const result = format(content, { file: filePath });
        let output = result.output;
        let changed = result.changed;

        if (refIndex !== undefined) {
          const { parseFile, canonicalizeRefs } = await import(
            "../../core/mod.ts"
          );
          const parsed = await parseFile(output, { file: filePath });
          const refResult = canonicalizeRefs(
            output,
            parsed.entries,
            refIndex,
            ledger,
          );
          if (refResult.changed) {
            output = refResult.output;
            changed = true;
          }
        }

        for (const d of result.diagnostics) {
          const loc = d.location ? `${d.location.file}:${d.location.line}` : "";
          console.error(`${d.severity}: ${loc} ${d.message}`);
        }

        if (changed) {
          totalFormatted++;
          if (!options.check) {
            await Deno.writeTextFile(filePath, output);
          }
        } else {
          totalUnchanged++;
        }
      }

      const total = totalFormatted + totalUnchanged;
      console.error(
        `${totalFormatted} file(s) formatted, ${totalUnchanged} unchanged (${total} total)`,
      );

      // MSL-L011 stale-pin info — emitted when markspec.lock is more than 60
      // days old. Non-fatal, never affects exit code.
      if (projectRoot !== undefined) {
        const { join } = await import("@std/path");
        const lockPath = join(projectRoot, "markspec.lock");
        const lockRaw = await readFile(lockPath);
        if (lockRaw !== undefined) {
          const { parseLockfile } = await import("../../core/mod.ts");
          const parsed = parseLockfile(lockRaw);
          if (parsed.lockfile) {
            const lockedAtMs = Date.parse(parsed.lockfile.meta.lockedAt);
            if (!Number.isNaN(lockedAtMs)) {
              const ageDays = (Date.now() - lockedAtMs) / (1000 * 60 * 60 * 24);
              if (ageDays > 60) {
                console.error(
                  `info: MSL-L011: markspec.lock is ${
                    ageDays.toFixed(0)
                  } days old. Consider running \`markspec lock\` to refresh.`,
                );
              }
            }
          }
        }
      }

      if (hasErrors) {
        Deno.exit(1);
      }
      if (options.check && totalFormatted > 0) {
        Deno.exit(1);
      }
    },
  );
