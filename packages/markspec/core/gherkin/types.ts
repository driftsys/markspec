/**
 * @module core/gherkin/types
 *
 * Normalized AST of one Gherkin block. It is built from the parser's
 * `GherkinDocument` by {@linkcode parseFeature}. Ranges are relative to the
 * authored block text: line 1 is the first line of the source, and a
 * synthetic `Feature:` line is not counted. Lines and columns are 1-based.
 * The end column is exclusive (one past the last character). A step with a
 * doc string or data table ends after its last line; a scenario ends after
 * its last step or Examples row; a section covers its keyword and colon.
 */

import type { SourceRange } from "../ast/nodes.ts";

/** Role-independent step keyword, taken from the parser's `keywordType`. */
export type StepKeyword = "given" | "when" | "then" | "and" | "but" | "step";

/** One Gherkin step. */
export interface StepAst {
  /** The keyword as authored, with the trailing space removed. */
  readonly keyword: string;
  readonly normalized: StepKeyword;
  readonly text: string;
  readonly docString?: { mediaType?: string; content: string };
  readonly dataTable?: readonly (readonly string[])[];
  readonly range: SourceRange;
}

/** One `Examples` table of a `Scenario Outline`. It is not expanded. */
export interface ExamplesAst {
  readonly name: string;
  readonly keyword: string;
  readonly tags: readonly string[];
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly range: SourceRange;
}

/** One scenario or scenario outline, with the Rules flattened away. */
export interface ScenarioAst {
  /** The parser name, trimmed. It is not normalized as a locator. */
  readonly name: string;
  readonly keyword: string;
  /** The scenario's own tags, not inherited ones. */
  readonly tags: readonly string[];
  readonly ruleName?: string;
  readonly description: string;
  readonly isOutline: boolean;
  /** Feature background steps, then Rule background steps, in order. */
  readonly background: readonly StepAst[];
  readonly steps: readonly StepAst[];
  readonly examples: readonly ExamplesAst[];
  readonly range: SourceRange;
}

/** A Feature, Background, Rule, Scenario or Examples keyword. */
export interface SectionAst {
  readonly keyword: string;
  readonly range: SourceRange;
}

/** The normalized document of one Gherkin block. */
export interface FeatureAst {
  /** Empty when the Feature line is synthetic. */
  readonly name: string;
  readonly keyword: string;
  /** `true` when MarkSpec added the Feature line before parsing. */
  readonly synthetic: boolean;
  readonly language: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly scenarios: readonly ScenarioAst[];
  /** Every structural keyword in document order, without the synthetic line. */
  readonly sections: readonly SectionAst[];
}

/** Result of {@linkcode parseFeature}. */
export type FeatureParse =
  | { ok: true; feature: FeatureAst }
  | { ok: false; line: number; column: number; message: string };
