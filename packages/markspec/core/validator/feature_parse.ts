/**
 * @module core/validator/feature_parse
 *
 * `MSL-B062` (warning): a `gherkin` or `feature` block does not parse as
 * Gherkin (epic #915). The warning is reported at the file line of the
 * first parser error, for an entry of any type. A feature block anywhere in
 * the entry body is checked, including one nested in a list item. (Criteria
 * are read from top-level blocks only; see `core/criteria/scenarios.ts`.)
 * For a top-level block of a Requirement or Contract entry, the criteria of
 * a block that does not parse come from the line scanner.
 *
 * The column is always 1. The parser column is relative to the block text,
 * and the block indent (list-item and fence indent in Markdown, the comment
 * prefix in source doc comments) is not recorded, so the file column cannot
 * be derived reliably.
 *
 * A warning located in a delivered-corpus file is not published by the LSP
 * (its corpus-file guard). In `check`, the corpus post-pass keeps it and
 * prefixes the message with `delivered by <profile>@<version>: `
 * (`attributeCorpusDiagnostics`). Upstream entries are not checked:
 * `emittableEntries` skips them.
 *
 * Only a block that the Gherkin parser rejected carries `parseError`. When
 * the parser was not loaded (the synchronous `parse()` path), no block has
 * one and nothing is reported.
 */

import type { Diagnostic, Entry } from "../model/mod.ts";
import type { BodyBlock, FeatureNode } from "../ast/nodes.ts";
import { emittableEntries } from "../model/mod.ts";
import { featureFileLine } from "../gherkin/position.ts";

/** Report one MSL-B062 warning per feature block that failed to parse. */
export function checkFeatureParse(entries: readonly Entry[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const entry of emittableEntries(entries)) {
    for (const node of featureNodes(entry.bodyAst ?? [])) {
      const error = node.parseError;
      if (error === undefined) continue;
      // The parser message starts with a "(line:column): " position that
      // is relative to the block, which would mislead; the location holds
      // the file position.
      const reason = error.message.split("\n")[0]
        .replace(/^\(\d+:\d+\):\s*/, "").trim();
      diagnostics.push({
        code: "MSL-B062",
        severity: "warning",
        message: `${entry.displayId}: Gherkin block does not parse: ` +
          `${reason}`,
        location: {
          file: entry.location.file,
          line: featureFileLine(entry, node, error.line),
          column: 1,
        },
      });
    }
  }
  return diagnostics;
}

/** Every feature node in `blocks`, including those nested in list items,
 * in source order. */
function* featureNodes(
  blocks: readonly BodyBlock[],
): Generator<FeatureNode> {
  for (const block of blocks) {
    if (block.kind === "feature") yield block as FeatureNode;
    else if (block.kind === "list") {
      for (const item of block.items) yield* featureNodes(item.blocks);
    }
  }
}
