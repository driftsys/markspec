/**
 * @module core/gherkin/procedure
 *
 * Procedure view of a Gherkin scenario. This module resolves the role of each
 * step (precondition, action or outcome). It is a pure function of the
 * normalized AST; nothing is stored on the AST.
 */

import type { StepAst } from "./types.ts";

/** What a step does in a procedure. */
export type StepRole = "precondition" | "action" | "outcome";

/**
 * Resolve the role of each step, in order.
 *
 * `Given` is a precondition, `When` is an action, `Then` is an outcome, and a
 * `*` step is always an action. `And` and `But` take the role of the step
 * before them; a first `And` or `But` is an action.
 */
export function stepRoles(steps: readonly StepAst[]): StepRole[] {
  const roles: StepRole[] = [];
  for (const step of steps) {
    switch (step.normalized) {
      case "given":
        roles.push("precondition");
        break;
      case "then":
        roles.push("outcome");
        break;
      case "and":
      case "but":
        roles.push(roles.at(-1) ?? "action");
        break;
      default:
        roles.push("action");
    }
  }
  return roles;
}
