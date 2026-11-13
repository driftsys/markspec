/**
 * @module core/validator/block_role
 *
 * Diagnostics for the role of a Gherkin block (epic #915, ADR-038).
 *
 * `MSL-B064` (warning): a scenario of a criteria block has no outcome step.
 * A criteria block belongs to an entry that is, or extends, a Requirement
 * or a Contract (see `blockRole`). The scenario has no `Then` step (or the
 * keyword of the block language that means `Then`, including `And` and `But`
 * after it), or no step at all. A scenario with `Given` and `Then` and no
 * action is valid. `Scenario Outline` Examples are not considered.
 *
 * Each `feature` or `gherkin` block is checked in a top-level block or in a
 * list item at any depth, as for `MSL-B062`. A block that has a `parseError`
 * or no `feature` is skipped. Upstream entries are not checked
 * (`emittableEntries`). An entry without a type after classification with
 * the profile is not checked.
 *
 * The warning is reported at the file line of the `Scenario` keyword, in
 * column 1.
 */

import type { Diagnostic, EffectiveProfile, Entry } from "../model/mod.ts";
import { emittableEntries } from "../model/mod.ts";
import { blockRole } from "../gherkin/role.ts";
import { stepRoles } from "../gherkin/procedure.ts";
import { featureFileLine } from "../gherkin/position.ts";
import { featureNodes } from "./feature_parse.ts";
import { withType } from "./locators.ts";

/** Report the block-role diagnostics for `entries`. */
export function checkBlockRoles(
  entries: readonly Entry[],
  profile: EffectiveProfile | null,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const candidate of emittableEntries(entries)) {
    const nodes = [...featureNodes(candidate.bodyAst ?? [])];
    if (nodes.length === 0) continue;
    // Classify an unclassified entry, as `validateLocators` does.
    const entry = withType(candidate, profile);
    if (blockRole(entry, profile) !== "criteria") continue;
    for (const node of nodes) {
      if (node.parseError !== undefined || node.feature === undefined) continue;
      for (const scenario of node.feature.scenarios) {
        if (stepRoles(scenario.steps).includes("outcome")) continue;
        diagnostics.push({
          code: "MSL-B064",
          severity: "warning",
          message: `${entry.displayId}: scenario "${scenario.name}" has no ` +
            "outcome (no Then step); a criterion must state what has to " +
            "hold; add a Then step",
          location: {
            file: entry.location.file,
            line: featureFileLine(entry, node, scenario.range.start.line),
            column: 1,
          },
        });
      }
    }
  }
  return diagnostics;
}
