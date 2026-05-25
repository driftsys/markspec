/**
 * @module core/lint
 *
 * Prose-analysis lint pipeline barrel. Exports the public API for the
 * markspec lint subcommand and LSP integration.
 */

export type { LintDiagnostic } from "./types.ts";
export { isProseScope, runLint } from "./runner.ts";
export type { LintOptions, LintResult } from "./runner.ts";
export { ANTI_PATTERN_NOTE, computeScoreRollup } from "./score.ts";
export type { EntryScore, RuleContribution, ScoreRollup } from "./score.ts";
export { segmentSentences } from "./segmenter.ts";
export type { Sentence } from "./segmenter.ts";
