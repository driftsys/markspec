/**
 * @module core/validator/procedure
 *
 * `MSL-B063` (warning): a step of a Gherkin procedure has actions and no
 * expected result (epic #915). Only entries whose type is, or extends, core
 * `Test` are checked, because the procedure view belongs to Test entries.
 * In a Requirement the block is a criterion, which is another check.
 *
 * Each `feature` or `gherkin` block is checked in a top-level block or in a
 * list item at any depth, as for `MSL-B062`. A block that has a
 * `parseError` or no `feature` is skipped: `MSL-B062` reports the first, and
 * the second means the Gherkin parser was not loaded. Upstream entries are
 * not checked (`emittableEntries`).
 *
 * The warning is reported at the file line of the last action of the step,
 * in column 1. The entries must be classified (`entry.type` set), so the
 * caller runs this check on the pipeline's final entries.
 */

import type { Diagnostic, EffectiveProfile, Entry } from "../model/mod.ts";
import { emittableEntries } from "../model/mod.ts";
import { isTestEntry } from "../criteria/scenarios.ts";
import { scenarioProcedure } from "../gherkin/procedure.ts";
import { featureFileLine } from "../gherkin/position.ts";
import { featureNodes } from "./feature_parse.ts";
import { withType } from "./locators.ts";

/** Report one MSL-B063 warning per procedure step with no expected result. */
export function checkProcedureSteps(
  entries: readonly Entry[],
  profile: EffectiveProfile | null,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const candidate of emittableEntries(entries)) {
    // Classify an unclassified entry, as `validateLocators` does.
    const entry = withType(candidate, profile);
    if (!isTestEntry(entry, profile)) continue;
    for (const node of featureNodes(entry.bodyAst ?? [])) {
      if (node.parseError !== undefined || node.feature === undefined) continue;
      for (const scenario of node.feature.scenarios) {
        for (const step of scenarioProcedure(scenario).steps) {
          const last = step.actions.at(-1);
          if (last === undefined || step.expected.length > 0) continue;
          diagnostics.push({
            code: "MSL-B063",
            severity: "warning",
            message: `${entry.displayId}: step ${step.n} of scenario ` +
              `"${scenario.name}" has no expected result (no Then step); ` +
              "add a Then step after the last action",
            location: {
              file: entry.location.file,
              line: featureFileLine(entry, node, last.step.range.start.line),
              column: 1,
            },
          });
        }
      }
    }
  }
  return diagnostics;
}
