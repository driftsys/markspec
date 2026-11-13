/**
 * @module core/validator/feature_parse
 *
 * `MSL-B062` (warning): a `gherkin` or `feature` block does not parse as
 * Gherkin (epic #915). The warning is reported at the file line of the
 * first parser error, for an entry of any type. Criteria for that block
 * come from the line scanner, so the block still yields scenarios.
 *
 * The column is always 1. The parser column is relative to the block text,
 * and the block indent (list-item and fence indent in Markdown, the comment
 * prefix in source doc comments) is not recorded, so the file column cannot
 * be derived reliably.
 *
 * Like `MSL-B060` and `MSL-B061`, a warning located in a delivered-corpus
 * file is filtered at publish time (LSP) or by the corpus post-pass
 * (`check`); `emittableEntries` already skips upstream entries.
 *
 * Only a block that the Gherkin parser rejected carries `parseError`. When
 * the parser was not loaded (the synchronous `parse()` path), no block has
 * one and nothing is reported.
 */

import type { Diagnostic, Entry } from "../model/mod.ts";
import type { FeatureNode } from "../ast/nodes.ts";
import { emittableEntries } from "../model/mod.ts";
import { featureFileLine } from "../gherkin/position.ts";

/** Report one MSL-B062 warning per feature block that failed to parse. */
export function checkFeatureParse(entries: readonly Entry[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const entry of emittableEntries(entries)) {
    for (const block of entry.bodyAst ?? []) {
      if (block.kind !== "feature") continue;
      const node = block as FeatureNode;
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
          `${reason}. Fix the syntax at this line; scenario names are ` +
          "read from the block text until then",
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
