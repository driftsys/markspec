/**
 * @module core/gherkin/position
 *
 * Maps a position inside a Gherkin block to a line of the file.
 */

import type { FeatureNode } from "../ast/nodes.ts";
import type { Entry } from "../model/mod.ts";

/**
 * Return the 1-based file line of `sourceLine`, a 1-based line of the
 * authored block text of `node` (the same lines `FeatureAst` ranges use).
 * The result matches the lines `buildCriteria` reports. `bodyStartLine` is
 * file-relative for Markdown and source doc comments, so the result needs no
 * further translation.
 */
export function featureFileLine(
  entry: Entry,
  node: FeatureNode,
  sourceLine: number,
): number {
  const bodyStart = entry.bodyStartLine ?? (entry.location.line + 1);
  return bodyStart + node.range.start.line + sourceLine - 1;
}
