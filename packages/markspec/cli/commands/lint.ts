/**
 * @module cli/commands/lint
 *
 * `markspec lint` — run prose-quality rules on entries (lexicon,
 * structural, suppression hygiene).
 */

import { Command } from "@cliffy/command";
import type { Diagnostic } from "../../core/mod.ts";
import { compileProject, resolveScope } from "../helpers.ts";

/** The score of one project, as returned by `runLint`. */
type LintScore = Awaited<
  ReturnType<typeof import("../../core/mod.ts").runLint>
>[
  "score"
];

/**
 * Combine the scores of several projects into one: band counts are summed,
 * the mean is weighted by each project's number of scored entries (the sum
 * of its band counts), and the anti-pattern note is the first non-empty one.
 * A single score is returned unchanged.
 */
function combineScores(scores: readonly LintScore[]): LintScore {
  if (scores.length === 1) return scores[0];
  const bandCounts: Record<string, number> = {};
  let entryCount = 0;
  let weightedSum = 0;
  for (const score of scores) {
    const projectCount = Object.values(score.rollup.bandCounts).reduce(
      (a, b) => a + b,
      0,
    );
    entryCount += projectCount;
    weightedSum += score.rollup.mean * projectCount;
    for (const [band, count] of Object.entries(score.rollup.bandCounts)) {
      bandCounts[band] = (bandCounts[band] ?? 0) + count;
    }
  }
  const mean = entryCount === 0
    ? 0
    : Math.round((weightedSum / entryCount) * 10) / 10;
  return {
    ...scores[0],
    perEntry: scores.flatMap((s) => s.perEntry),
    rollup: { bandCounts, mean },
    antiPatternNote:
      scores.map((s) => s.antiPatternNote).find((n) => n !== "") ??
        "",
  };
}

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
      // The headers are printed per project below, not by `resolveScope`.
      const scope = await resolveScope(paths, {
        verb: "linting",
        quiet: true,
      });
      const quiet = options.quiet === true || options.format === "json";
      // Explicit arguments: one run over those files. Bare invocation: one
      // run per project, the root project first (ADR-028 section 7).
      const runs = scope.projectWide
        ? scope.projects.map((p) => ({ root: p.root, files: p.files }))
        : [{ root: undefined, files: scope.files }];
      const { runLint } = await import("../../core/mod.ts");

      const allDiagnostics: Diagnostic[] = [];
      const scores: LintScore[] = [];
      let hasErrors = false;
      let hasWarnings = false;
      for (const run of runs) {
        if (scope.projectWide && !quiet) {
          console.error(
            `linting ${run.files.length} file(s) under ${run.root}`,
          );
        }
        const { result, chain } = await compileProject(run.files, {
          projectRoot: run.root,
        });
        // `result.entries` is the merged project + delivered-corpus set. Pass
        // it whole with the active profile: `runLint` keeps corpus entries in
        // its resolver indexes but never emits diagnostics for them (ADR-030
        // §D4), and the profile scopes profile-typed entries into prose
        // analysis (#675).
        const lintResult = await runLint({
          entries: [...result.entries.values()],
          profile: chain?.effective,
        });

        let diagnostics = [...lintResult.diagnostics];
        if (options.strict) {
          diagnostics = diagnostics.map((d) =>
            d.severity === "warning" ? { ...d, severity: "error" as const } : d
          );
        }
        hasErrors ||= diagnostics.some((d) => d.severity === "error");
        hasWarnings ||= diagnostics.some((d) => d.severity === "warning");
        allDiagnostics.push(...diagnostics);
        scores.push(lintResult.score);

        if (options.format !== "json") {
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
      }

      if (options.format === "json") {
        const output = {
          diagnostics: allDiagnostics,
          score: combineScores(scores),
        };
        console.log(JSON.stringify(output, null, 2));
      }

      if (hasErrors) {
        Deno.exit(1);
      } else if (hasWarnings) {
        Deno.exit(2);
      }
    },
  );
