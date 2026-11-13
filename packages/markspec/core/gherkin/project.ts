/**
 * @module core/gherkin/project
 *
 * Projects the {@linkcode FeatureAst} of a whole `.feature` file onto one
 * entry (epic #915 Case B, ADR-038). The entry keeps only the scenarios it
 * owns, and its ranges are rebased so that line 1 is the first line of the
 * owning node's span.
 */

import type {
  ExamplesAst,
  FeatureAst,
  GherkinRange,
  ScenarioAst,
  StepAst,
} from "./types.ts";

/** A span of file lines, 1-based and inclusive. */
export interface LineSpan {
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Return the part of `ast` that one entry owns.
 *
 * - `scenarios` holds the scenarios at `scenarioIndexes`, in that order.
 * - Every range is rebased: file line `span.startLine` becomes line 1.
 *   Inherited Background steps lie above the span and keep rebased lines
 *   that can be 0 or less.
 * - `backgrounds` holds the Background steps that apply to the kept
 *   scenarios, each once, in document order.
 * - `sections` and `comments` keep only the ones inside the span and
 *   outside every `exclude` span (the header and span of a nested node
 *   that is its own entry).
 *
 * @param ast - The normalized AST of the whole file; ranges are file lines.
 * @param scenarioIndexes - Indexes into `ast.scenarios` of the owned ones.
 * @param span - The file lines of the owning node.
 * @param exclude - File line spans inside `span` that belong to other
 *   entries.
 */
export function projectFeature(
  ast: FeatureAst,
  scenarioIndexes: readonly number[],
  span: LineSpan,
  exclude: readonly LineSpan[] = [],
): FeatureAst {
  const offset = span.startLine - 1;
  const range = (r: GherkinRange): GherkinRange => ({
    start: { line: r.start.line - offset, column: r.start.column },
    end: { line: r.end.line - offset, column: r.end.column },
  });
  const step = (s: StepAst): StepAst => ({ ...s, range: range(s.range) });
  const examples = (e: ExamplesAst): ExamplesAst => ({
    ...e,
    range: range(e.range),
  });
  const scenario = (s: ScenarioAst): ScenarioAst => ({
    ...s,
    ...(s.descriptionEndLine !== undefined
      ? { descriptionEndLine: s.descriptionEndLine - offset }
      : {}),
    background: s.background.map(step),
    steps: s.steps.map(step),
    examples: s.examples.map(examples),
    range: range(s.range),
  });
  const kept = scenarioIndexes.map((i) => ast.scenarios[i]);

  const visible = (line: number) =>
    line >= span.startLine && line <= span.endLine &&
    !exclude.some((x) => line >= x.startLine && line <= x.endLine);

  const background = new Set(kept.flatMap((s) => s.background));
  return {
    ...ast,
    scenarios: kept.map(scenario),
    backgrounds: ast.backgrounds.filter((s) => background.has(s)).map(step),
    sections: ast.sections
      .filter((s) => visible(s.range.start.line))
      .map((s) => ({ ...s, range: range(s.range) })),
    comments: ast.comments
      .filter((c) => visible(c.line))
      .map((c) => ({ ...c, line: c.line - offset })),
  };
}
