/**
 * @module core/gherkin/procedure
 *
 * Procedure view of a Gherkin scenario. This module resolves the role of each
 * step (precondition, action or outcome). It is a pure function of the
 * normalized AST; nothing is stored on the AST.
 */

import type { ScenarioAst, StepAst } from "./types.ts";

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
      case "when":
      case "step":
        roles.push("action");
        break;
      case "and":
      case "but":
        roles.push(roles.at(-1) ?? "action");
        break;
      default: {
        const unhandled: never = step.normalized;
        throw new Error(`unhandled step keyword: ${unhandled}`);
      }
    }
  }
  return roles;
}

/** A step of the scenario, with its resolved role and where it came from. */
export interface ProcedureStepRef {
  readonly step: StepAst;
  readonly role: StepRole;
  readonly origin: "background" | "scenario";
}

/** One numbered step of a procedure: its setup, actions and expected results. */
export interface ProcedureStep {
  /** 1-based position in the scenario. */
  readonly n: number;
  /** `Given` steps that follow the first action. */
  readonly setup: readonly ProcedureStepRef[];
  readonly actions: readonly ProcedureStepRef[];
  readonly expected: readonly ProcedureStepRef[];
}

/** The procedure view of one scenario. */
export interface ScenarioProcedure {
  /** Background steps, then the leading precondition steps of the scenario. */
  readonly preconditions: readonly ProcedureStepRef[];
  readonly steps: readonly ProcedureStep[];
}

/**
 * Derive the procedure view of a scenario.
 *
 * Preconditions are the scenario's background steps followed by its leading
 * precondition steps. The remaining steps are paired in order: an action after
 * an expected result, or a precondition after an action or expected result,
 * opens a new step. Examples of an outline are not expanded.
 */
export function scenarioProcedure(scenario: ScenarioAst): ScenarioProcedure {
  const preconditions: ProcedureStepRef[] = scenario.background.map((step) => ({
    step,
    role: "precondition",
    origin: "background",
  }));
  const roles = stepRoles(scenario.steps);
  let first = 0;
  while (first < roles.length && roles[first] === "precondition") {
    preconditions.push({
      step: scenario.steps[first],
      role: "precondition",
      origin: "scenario",
    });
    first++;
  }

  const steps: ProcedureStep[] = [];
  let setup: ProcedureStepRef[] = [];
  let actions: ProcedureStepRef[] = [];
  let expected: ProcedureStepRef[] = [];
  const close = () => {
    if (setup.length + actions.length + expected.length === 0) return;
    steps.push({ n: steps.length + 1, setup, actions, expected });
    setup = [];
    actions = [];
    expected = [];
  };
  for (let i = first; i < roles.length; i++) {
    const ref: ProcedureStepRef = {
      step: scenario.steps[i],
      role: roles[i],
      origin: "scenario",
    };
    if (ref.role === "precondition") {
      if (actions.length > 0 || expected.length > 0) close();
      setup.push(ref);
    } else if (ref.role === "action") {
      if (expected.length > 0) close();
      actions.push(ref);
    } else {
      expected.push(ref);
    }
  }
  close();
  return { preconditions, steps };
}
