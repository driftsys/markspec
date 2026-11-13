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
import {
  scenarioProcedure,
  stepRoles,
  unplacedStepLabels,
} from "../gherkin/procedure.ts";
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
    const role = blockRole(entry, profile);
    if (role === undefined) continue;
    const found: Diagnostic[] = [];
    const report = (
      code: string,
      node: Parameters<typeof featureFileLine>[1],
      sourceLine: number,
      severity: Diagnostic["severity"],
      message: string,
    ) =>
      found.push({
        code,
        severity,
        message: `${entry.displayId}: ${message}`,
        location: {
          file: entry.location.file,
          line: featureFileLine(entry, node, sourceLine),
          column: 1,
        },
      });
    for (const node of nodes) {
      if (node.parseError !== undefined || node.feature === undefined) continue;
      const feature = node.feature;
      if (role === "illustration") {
        report(
          "MSL-B068",
          node,
          1,
          "info",
          `Gherkin block in a ${entry.type} entry is an illustration; only ` +
            "Requirement, Contract and Test entries give it a meaning",
        );
        continue;
      }
      for (const scenario of feature.scenarios) {
        const first = scenario.steps[0];
        if (
          first !== undefined &&
          (first.normalized === "and" || first.normalized === "but")
        ) {
          report(
            "MSL-B066",
            node,
            first.range.start.line,
            "info",
            `scenario "${scenario.name}" starts with "${first.keyword}"; ` +
              "the step is read as an action; start with Given, When or Then",
          );
        }
        if (role === "criteria") {
          if (stepRoles(scenario.steps).includes("outcome")) continue;
          report(
            "MSL-B064",
            node,
            scenario.range.start.line,
            "warning",
            `scenario "${scenario.name}" has no outcome (no Then step); a ` +
              "criterion must state what has to hold; add a Then step",
          );
          continue;
        }
        const procedure = scenarioProcedure(scenario, feature.comments);
        for (const step of procedure.steps) {
          if (step.actions.length > 0 || step.expected.length === 0) continue;
          report(
            "MSL-B065",
            node,
            step.expected[0].step.range.start.line,
            "info",
            `step ${step.n} of scenario "${scenario.name}" has an expected ` +
              "result and no action; add a When step before the Then step",
          );
        }
      }
      if (role === "procedure") {
        for (const comment of unplacedStepLabels(feature)) {
          report(
            "MSL-B067",
            node,
            comment.line,
            "info",
            `"${comment.text.trim()}" labels no procedure step; place it ` +
              "directly above the first action of a step",
          );
        }
      }
    }
    // Stable sort: diagnostics of one entry follow the file order.
    found.sort((a, b) => a.location!.line - b.location!.line);
    diagnostics.push(...found);
  }
  return diagnostics;
}
