/**
 * @module core/gherkin/position
 *
 * Maps a position inside a Gherkin block to a line of the file.
 */

import type { GherkinRange } from "./types.ts";
import type { Entry } from "../model/mod.ts";

/**
 * Return the 1-based file line of `sourceLine`, a 1-based line of the
 * authored block text of `node` (the same lines `FeatureAst` ranges use).
 * The result matches the lines `buildCriteria` reports and needs no further
 * translation. In Markdown, `bodyStartLine` is a file line and `node.range`
 * is relative to the body. In a source doc comment, `bodyStartLine` stays
 * relative to the extracted comment text, and `translateEntryLocations`
 * (`parser/translate.ts`) shifts `node.range` by the comment's file offset
 * instead; the sum is the file line in both cases.
 */
export function featureFileLine(
  entry: Entry,
  /** The feature block: a body-AST `FeatureNode`. */
  node: { readonly range: GherkinRange },
  sourceLine: number,
): number {
  const bodyStart = entry.bodyStartLine ?? (entry.location.line + 1);
  return bodyStart + node.range.start.line + sourceLine - 1;
}
