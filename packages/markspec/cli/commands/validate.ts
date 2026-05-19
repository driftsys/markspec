/**
 * @module cli/commands/validate
 *
 * `markspec validate` — check broken refs, missing Ids, duplicates.
 */

import { Command } from "@cliffy/command";
import { ConfigError } from "../../core/mod.ts";
import type { CaptionConventions, Diagnostic } from "../../core/mod.ts";
import { loadActiveProfile, readFile } from "../helpers.ts";

export const validateCmd = new Command()
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
      options: { strict?: boolean; format?: string },
      ...files: string[]
    ) => {
      if (files.length === 0) {
        console.error("error: no files specified");
        console.error("usage: markspec validate <file...>");
        Deno.exit(1);
      }

      const { discoverProjectRoot, loadConfig } = await import(
        "../../core/mod.ts"
      );
      const projectRoot = await discoverProjectRoot(Deno.cwd(), readFile);
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
      for (const filePath of files) {
        let content: string;
        try {
          content = await Deno.readTextFile(filePath);
        } catch {
          console.error(`error: ${filePath}: file not found`);
          Deno.exit(1);
        }
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

      const result = runPipeline(
        allEntries,
        chain?.effective ?? null,
        captionConventions,
      );

      const listingDiagnostics = validateListingDocuments(listingContexts);

      // Merge parse-level (MSL-P0xx), pipeline, and listing diagnostics.
      const allDiagnostics = [
        ...parseDiagnostics,
        ...result.diagnostics,
        ...listingDiagnostics,
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
