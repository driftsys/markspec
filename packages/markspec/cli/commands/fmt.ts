/**
 * @module cli/commands/fmt
 *
 * `markspec fmt` — stamp ULIDs, fix indentation, normalize attributes.
 */

import { Command } from "@cliffy/command";
import { extname } from "@std/path";
import type { LockEdge, RefIndex } from "../../core/mod.ts";
import {
  assertNotDeliveredTarget,
  cliProjectRootResolver,
  denoDiscoveryIO,
  loadActiveProfile,
  loadMarkdownFormatterOrExit,
  projectCollectOptions,
  readFile,
  resolveScope,
} from "../helpers.ts";

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
      const { format } = await import("../../core/mod.ts");

      // Load the profile of every project group before any file is written,
      // so a refused target (below) stops the run before any file changes.
      // Each group uses the profile, `.markspec.yaml` and `markspec.lock` of
      // its own project (#845).
      const chains = [];
      for (const group of scope.groups) {
        chains.push(
          group.projectRoot !== undefined
            ? await loadActiveProfile(group.projectRoot)
            : null,
        );
      }
      // Delivered corpus/docs files are read-only (ADR-030). Refuse an
      // explicitly-named target that resolves to one rather than overwriting
      // the profile package's file (#700). A delivered file often lies
      // outside the project whose profile delivers it (a profile folder next
      // to the project, a package cache), so its own group has no profile
      // that knows it: compare every target against the profile of every
      // group and of the current directory's project. Project-wide scope
      // never includes corpus files (they live outside the walk / under
      // `exclude:`).
      if (!scope.projectWide) {
        const cwdRoot = await (await cliProjectRootResolver()).ownerOf(
          Deno.cwd(),
        );
        if (
          cwdRoot !== undefined &&
          !scope.groups.some((g) => g.projectRoot === cwdRoot)
        ) {
          chains.push(await loadActiveProfile(cwdRoot));
        }
        assertNotDeliveredTarget(scope.groups.flatMap((g) => g.files), chains);
      }

      const formatMarkdownProse = await loadMarkdownFormatterOrExit();

      let totalFormatted = 0;
      let totalUnchanged = 0;

      let hasErrors = false;
      const resolver = await cliProjectRootResolver();

      for (const group of scope.groups) {
        // Project-aware reference canonicalisation/healing (issue #593,
        // Slice 4). Built once per project group and reused for every file
        // of the group. A group without a project root leaves refIndex
        // undefined and skips canonicalisation entirely.
        let refIndex: RefIndex | undefined = undefined;
        let ledger: readonly LockEdge[] = [];
        if (group.projectRoot !== undefined) {
          const {
            buildRefIndex,
            collectProjectEntries,
            parseLockfile,
          } = await import("../../core/mod.ts");
          const { join } = await import("@std/path");
          // The canonicalisation corpus is the project's own file set, the
          // one `check` (MSL-L006) and `lock` use: an entry in an excluded
          // path (e.g. `skills/`) or in a nested project must not resolve
          // trace references.
          const projectEntries = await collectProjectEntries(
            group.projectRoot,
            denoDiscoveryIO(),
            await projectCollectOptions(group.projectRoot, resolver),
          );
          refIndex = buildRefIndex(projectEntries);
          const lockRaw = await readFile(
            join(group.projectRoot, "markspec.lock"),
          );
          if (lockRaw !== undefined) {
            const parsed = parseLockfile(lockRaw);
            if (parsed.lockfile) ledger = parsed.lockfile.edges;
          }
        }

        for (const filePath of group.files) {
          let content: string;
          try {
            content = await Deno.readTextFile(filePath);
          } catch {
            console.error(`error: ${filePath}: file not found`);
            hasErrors = true;
            continue;
          }

          // ADR-029's whole-document markdown pass is Markdown-only:
          // `resolveScope`'s explicit-file branch passes any named file
          // through regardless of extension (its filter only applies to
          // bare/directory scope), so a source file (e.g. `main.rs`) reaching
          // here without this guard would have dprint join its lines as
          // Markdown paragraphs — destructive, and undetectable by the
          // CommonMark-semantic equivalence gate (line-joining is
          // wrap-equivalent as Markdown).
          const isMarkdown = MARKDOWN_EXTENSIONS.has(
            extname(filePath).toLowerCase(),
          );
          const result = format(content, {
            file: filePath,
            formatMarkdownProse: isMarkdown ? formatMarkdownProse : undefined,
          });
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
            const loc = d.location
              ? `${d.location.file}:${d.location.line}`
              : "";
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
      }

      const total = totalFormatted + totalUnchanged;
      console.error(
        `${totalFormatted} file(s) formatted, ${totalUnchanged} unchanged (${total} total)`,
      );

      // MSL-L011 stale-pin info — emitted when markspec.lock is more than 60
      // days old. Non-fatal, never affects exit code.
      for (const { projectRoot } of scope.groups) {
        if (projectRoot === undefined) continue;
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
