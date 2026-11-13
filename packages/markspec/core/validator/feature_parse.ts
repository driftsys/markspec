/**
 * @module core/validator/feature_parse
 *
 * `MSL-B062` (warning): a `gherkin` or `feature` block does not parse as
 * Gherkin (epic #915). The warning is reported at the file line of the
 * first parser error, for an entry of any type. Criteria for that block
 * come from the line scanner, so the block still yields scenarios.
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
      const reason = error.message.split("\n")[0].trim();
      diagnostics.push({
        code: "MSL-B062",
        severity: "warning",
        message: `${entry.displayId}: Gherkin block does not parse: ` +
          `${reason}. Fix the syntax at this line; scenario names are ` +
          "read from the block text until then",
        location: {
          file: entry.location.file,
          line: featureFileLine(entry, node, error.line),
          column: error.column,
        },
      });
    }
  }
  return diagnostics;
}
