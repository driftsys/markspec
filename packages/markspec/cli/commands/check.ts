/**
 * @module cli/commands/check
 *
 * `markspec check` — check broken refs, missing Ids, duplicates.
 */

import { Command } from "@cliffy/command";
import { ConfigError } from "../../core/mod.ts";
import type { CaptionConventions, Diagnostic } from "../../core/mod.ts";
import { loadActiveProfile, readFile, resolveScope } from "../helpers.ts";

export const checkCmd = new Command()
  .description("Check broken refs, missing Ids, duplicates")
  .option("--strict", "Promote warnings to errors")
  .option(
    "--format <format:string>",
    "Output format (json|text)",
    { default: "text" },
  )
  .arguments("[...files:string]")
  .action(
    async (
      options: { strict?: boolean; format?: string; quiet?: boolean },
      ...fileArgs: string[]
    ) => {
      const scope = await resolveScope(fileArgs, {
        verb: "checking",
        quiet: options.quiet === true || options.format === "json",
      });
      const files = scope.files;
      const projectRoot = scope.projectRoot;

      const { loadConfig } = await import("../../core/mod.ts");

      const chain = projectRoot !== undefined
        ? await loadActiveProfile(projectRoot)
        : null;

      // Load project config for config-driven rules (e.g. MSL-C072
      // caption-position convention). Absent config → defaults (rules inactive).
      // A malformed config (ConfigError) IS surfaced — a bad caption-conventions
      // block silently disabling MSL-C072 would be invisible debt (M-1 fix).
      let captionConventions: CaptionConventions = {};
      if (projectRoot !== undefined) {
        try {
          const configResult = await loadConfig(projectRoot, readFile);
          if (configResult) {
            captionConventions = configResult.config.captionConventions;
          }
        } catch (err) {
          if (err instanceof ConfigError) {
            console.error(`error: ${err.message}`);
            Deno.exit(1);
          }
          // Other unexpected errors (I/O, etc.) remain non-fatal — the rule
          // simply stays inactive; the file-missing path already returns undefined
          // from readFile and never throws.
        }
      }

      const {
        detectDirectives,
        parseFile,
        runPipeline,
        validateListingDocuments,
      } = await import("../../core/mod.ts");

      const allEntries = [];
      const parseDiagnostics: Diagnostic[] = [];
      // deno-lint-ignore no-explicit-any
      const listingContexts: any[] = [];
      const mdContents = new Map<string, string>();
      for (const filePath of files) {
        let content: string;
        try {
          content = await Deno.readTextFile(filePath);
        } catch {
          console.error(`error: ${filePath}: file not found`);
          Deno.exit(1);
        }
        if (filePath.endsWith(".md")) mdContents.set(filePath, content);
        const result = await parseFile(content, { file: filePath });
        allEntries.push(...result.entries);
        parseDiagnostics.push(...result.diagnostics);
        listingContexts.push({
          file: filePath,
          content,
          entries: result.entries,
          directives: detectDirectives(content, { file: filePath }),
        });
      }

      // projectWide reflects the resolved scope: a bare invocation walks the
      // whole project, so MSL-L006 ("link target does not resolve") is
      // meaningful and fires. Explicit file args stay file-local — that
      // subset cannot distinguish a typo from a valid cross-file target, so
      // MSL-L006 is suppressed. Full existence checks are always available
      // via `markspec compile` or the LSP (which index all files).
      const result = runPipeline(
        allEntries,
        chain?.effective ?? null,
        captionConventions,
        { projectWide: scope.projectWide },
      );

      const listingDiagnostics = validateListingDocuments(listingContexts);

      // Gate: fmt drift (project-wide only — the composite `check` gate; a
      // file-local `check <file>` stays a fast structural check, and the
      // canonical agent path runs `fmt` before `check`). Markdown only —
      // `markspec fmt` never rewrites source files.
      const fmtDiagnostics: Diagnostic[] = [];
      if (scope.projectWide) {
        const { format } = await import("../../core/mod.ts");
        for (const [filePath, content] of mdContents) {
          if (format(content, { file: filePath }).changed) {
            fmtDiagnostics.push({
              code: "MSL-F010",
              severity: "error",
              message: "file is not formatted (run `markspec fmt`)",
              location: { file: filePath, line: 1, column: 1 },
            });
          }
        }
      }

      // Merge parse-level (MSL-P0xx), pipeline, listing, and fmt-drift
      // diagnostics.
      const allDiagnostics = [
        ...parseDiagnostics,
        ...result.diagnostics,
        ...listingDiagnostics,
        ...fmtDiagnostics,
      ];

      // Apply --strict: promote warnings to errors.
      const diagnostics = options.strict
        ? allDiagnostics.map((d) =>
          d.severity === "warning" ? { ...d, severity: "error" as const } : d
        )
        : allDiagnostics;

      const hasErrors = diagnostics.some((d) => d.severity === "error");
      const hasWarnings = diagnostics.some((d) => d.severity === "warning");

      if (options.format === "json") {
        console.log(JSON.stringify(diagnostics, null, 2));
      } else {
        for (const d of diagnostics) {
          const loc = d.location ? `${d.location.file}:${d.location.line}` : "";
          console.error(`${d.severity}[${d.code}]: ${loc} ${d.message}`);
        }
      }

      if (hasErrors) {
        Deno.exit(1);
      } else if (hasWarnings) {
        Deno.exit(2);
      }
    },
  );
