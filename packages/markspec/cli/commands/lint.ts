/**
 * @module cli/commands/lint
 *
 * `markspec lint` — run prose-quality rules on entries (lexicon,
 * structural, suppression hygiene).
 */

import { Command } from "@cliffy/command";
import { compileProject, resolveScope } from "../helpers.ts";

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
  .arguments("[...paths:string]")
  .action(
    async (
      options: { format?: string; strict?: boolean; quiet?: boolean },
      ...paths: string[]
    ) => {
      const scope = await resolveScope(paths, {
        verb: "linting",
        quiet: options.quiet === true || options.format === "json",
      });
      const { result } = await compileProject(scope.files);
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
        const output = { diagnostics, score: lintResult.score };
        console.log(JSON.stringify(output, null, 2));
      } else {
        for (const d of diagnostics) {
          const loc = d.location
            ? `${d.location.file}:${d.location.line}:${d.location.column}`
            : "";
          console.error(
            `${loc} ${d.severity} ${d.slug} [${d.code}]: ${d.message}`,
          );
        }
        const { bandCounts, mean } = lintResult.score.rollup;
        const { antiPatternNote } = lintResult.score;
        const bandSummary = [
          `${bandCounts["0"]} entries in band 0`,
          `${bandCounts["1-3"]} in 1-3`,
          `${bandCounts["4-7"]} in 4-7`,
          `${bandCounts["8-15"]} in 8-15`,
          `${bandCounts["16+"]} in 16+`,
        ].join(", ");
        console.error(`\nScore: ${bandSummary}. Mean: ${mean}.`);
        console.error(`Note: ${antiPatternNote}`);
      }

      if (hasErrors) {
        Deno.exit(1);
      } else if (hasWarnings) {
        Deno.exit(2);
      }
    },
  );
