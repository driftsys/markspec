/**
 * @module core/lint/score_text
 *
 * Score a single piece of requirement prose using the PA-3 lint
 * pipeline. Wraps the input text in a synthetic `Entry` (type
 * `Requirement`, body = text, bodyAst = parsed) and runs `runLint`
 * against a one-entry corpus.
 *
 * Two non-obvious wrapping choices:
 *   - `bodyAst` is populated via `buildBodyAst(text)`. Most PA-3
 *     rules (modal, EARS, INCOSE, passive, lexicon) walk `bodyAst`,
 *     not the raw `body` string — without the AST, ~95% of the
 *     rule catalog silently no-ops.
 *   - `title` is set to the resolved id. Q400 (`struct-title-length`)
 *     fires when title length is outside [3, 120]; reusing the id
 *     (always ≥ 3 chars) keeps Q400 silent so the score reflects
 *     prose quality, not the absence of an authored title.
 *
 * Corpus-dependent rules (Q500 xref-glossary, xref-undefined,
 * suppression hygiene) self-skip because there is nothing for them
 * to cross-reference on a one-entry corpus. Note specifically:
 * `bodyTokens` is left empty here, which means any `$Identifier`
 * style entity references inside `text` are NOT extracted and so
 * Q500 cannot fire on them in either direction. External requirement
 * prose (DOORS / Word / PDF) does not use MarkSpec's `$Identifier`
 * syntax, so this is the right trade for v1; a caller that does want
 * `$Identifier` resolution should run the prose through `parseFile`
 * to get a real entry and use the normal `runLint` path instead.
 */

import type { Entry } from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";
import { buildBodyAst } from "../ast/build.ts";
import { runLint } from "./runner.ts";
import type { LintDiagnostic } from "./types.ts";
import type { RuleContribution } from "./score.ts";

const SYNTHETIC_FILE = "<scoreText>";
const DEFAULT_ID = "EXT_0001";

/** Options for {@linkcode scoreText}. */
export interface ScoreTextOptions {
  /**
   * Caller-supplied identifier carried through to the result so a
   * batch caller can correlate inputs and outputs. Defaults to
   * `"EXT_0001"` when absent or empty.
   */
  readonly id?: string;
}

/**
 * Result returned by {@linkcode scoreText}.
 *
 * `warningCount + infoCount === diagnostics.length` by convention:
 * every PA-3 rule emits `warning` or `info` only. The `Severity` type
 * permits `error`, but no current rule produces one; if that ever
 * changes the partition will need a third counter.
 */
export interface ScoreTextResult {
  readonly id: string;
  /** Sum of `weight × occurrences` across all firings. */
  readonly score: number;
  /** Number of diagnostics with severity `"warning"`. */
  readonly warningCount: number;
  /** Number of diagnostics with severity `"info"`. */
  readonly infoCount: number;
  /** Sorted by weight DESC, code ASC. */
  readonly contributions: readonly RuleContribution[];
  /** Full lint diagnostics, in pipeline order. */
  readonly diagnostics: readonly LintDiagnostic[];
}

/**
 * Score a single piece of requirement prose against the PA-3 rule
 * catalog. See module doc for the wrapping strategy.
 */
export async function scoreText(
  text: string,
  opts?: ScoreTextOptions,
): Promise<ScoreTextResult> {
  const id = typeof opts?.id === "string" && opts.id.length > 0
    ? opts.id
    : DEFAULT_ID;

  const entry: Entry = {
    displayId: makeDisplayId(id),
    title: id,
    body: text,
    bodyAst: buildBodyAst(text),
    rawAttributes: [],
    typedAttributes: new Map(),
    type: "Requirement",
    shape: "Authored",
    location: { file: SYNTHETIC_FILE, line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
  };

  const lintResult = await runLint({ entries: [entry] });

  let warningCount = 0;
  let infoCount = 0;
  for (const d of lintResult.diagnostics) {
    if (d.severity === "warning") warningCount++;
    else if (d.severity === "info") infoCount++;
  }

  const entryScore = lintResult.score.perEntry[0];
  return {
    id,
    score: entryScore?.score ?? 0,
    warningCount,
    infoCount,
    contributions: entryScore?.contributions ?? [],
    diagnostics: lintResult.diagnostics,
  };
}
