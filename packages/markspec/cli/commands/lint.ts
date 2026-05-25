/**
 * @module cli/commands/lint
 *
 * `markspec lint` — run prose-quality rules on entries (lexicon,
 * structural, suppression hygiene).
 */

import { Command } from "@cliffy/command";
import { compileProject } from "../helpers.ts";

export const lintCmd = new Command()
  .description(
    "Run prose-quality rules on entries (lexicon, structural, suppression hygiene)",
  )
  .option(
    "--format <format:string>",
    "Output format (json|text)",
    { default: "text" },
  )
  .option("--strict", "Promote warnings to errors")
  .arguments("<paths...:string>")
  .action(
    async (
      options: { format?: string; strict?: boolean },
      ...paths: string[]
    ) => {
      const { result } = await compileProject(paths);
      const { runLint } = await import("../../core/mod.ts");
      const lintResult = await runLint({
        entries: [...result.entries.values()],
      });

      let diagnostics = [...lintResult.diagnostics];
      if (options.strict) {
        diagnostics = diagnostics.map((d) =>
          d.severity === "warning" ? { ...d, severity: "error" as const } : d
        );
      }

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
