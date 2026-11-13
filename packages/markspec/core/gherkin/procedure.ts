/**
 * @module core/gherkin/procedure
 *
 * Procedure view of a Gherkin scenario. This module resolves the role of each
 * step (precondition, action or outcome). It is a pure function of the
 * normalized AST; nothing is stored on the AST.
 */

import type {
  FeatureAst,
  GherkinComment,
  ScenarioAst,
  StepAst,
} from "./types.ts";

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
  /**
   * The `# Step <text>` label above the step's first line, without the `#`
   * (for example `Step 1`). Absent when the step has no label. It never
   * changes `n`.
   */
  readonly label?: string;
  /** Preconditions that follow the first non-precondition step. */
  readonly setup: readonly ProcedureStepRef[];
  readonly actions: readonly ProcedureStepRef[];
  readonly expected: readonly ProcedureStepRef[];
}

/** The procedure view of one scenario. */
export interface ScenarioProcedure {
  /** Background steps, then the leading precondition steps of the scenario. */
  readonly preconditions: readonly ProcedureStepRef[];
  readonly steps: readonly ProcedureStep[];
  /**
   * `# Step` labels inside the scenario's range that do not label a step: one
   * before a leading precondition or a step that does not open a procedure
   * step, one with no step after it (including one before `Examples:`), or a
   * second label above the same step. Labels outside every scenario are
   * reported by {@linkcode unplacedStepLabels}.
   */
  readonly unplacedLabels: readonly GherkinComment[];
}

/** A step label comment: `#`, the fixed word `Step`, then text. */
const STEP_LABEL_RE = /^#\s*Step\s+\S/;

/**
 * Derive the procedure view of a scenario.
 *
 * Preconditions are the scenario's background steps followed by its leading
 * precondition steps. The remaining steps are paired in order: an action after
 * an expected result, or a precondition after an action or expected result,
 * opens a new step. Examples of an outline are not expanded.
 *
 * `comments` are the block's comments. A `# Step <text>` comment inside the
 * scenario's range labels the procedure step that starts at the next step
 * line; any other label is returned in `unplacedLabels`.
 */
export function scenarioProcedure(
  scenario: ScenarioAst,
  comments: readonly GherkinComment[] = [],
): ScenarioProcedure {
  // Guards a call through `Array.prototype.map`, which passes the index.
  if (!Array.isArray(comments)) comments = [];
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
  let startIndex = first;
  // Scenario step index that opens each procedure step.
  const startIndexes: number[] = [];
  const close = (next: number) => {
    if (setup.length + actions.length + expected.length === 0) return;
    steps.push({ n: steps.length + 1, setup, actions, expected });
    startIndexes.push(startIndex);
    startIndex = next;
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
      if (actions.length > 0 || expected.length > 0) close(i);
      setup.push(ref);
    } else if (ref.role === "action") {
      if (expected.length > 0) close(i);
      actions.push(ref);
    } else {
      expected.push(ref);
    }
  }
  close(roles.length);

  const labels = new Map<number, string>();
  const unplacedLabels: GherkinComment[] = [];
  for (const comment of comments) {
    if (!STEP_LABEL_RE.test(comment.text)) continue;
    if (
      comment.line < scenario.range.start.line ||
      comment.line > scenario.range.end.line
    ) continue;
    const next = scenario.steps.findIndex((s) =>
      s.range.start.line > comment.line
    );
    const target = next < 0 ? -1 : startIndexes.indexOf(next);
    if (target < 0 || labels.has(target)) unplacedLabels.push(comment);
    else labels.set(target, comment.text.slice(1).trim());
  }
  return {
    preconditions,
    steps: steps.map((step, i) =>
      labels.has(i) ? { ...step, label: labels.get(i)! } : step
    ),
    unplacedLabels,
  };
}

/**
 * Every `# Step` label of a feature block that labels no step, each once, in
 * document order. A label inside a scenario's range is unplaced when
 * {@linkcode scenarioProcedure} leaves it unplaced; a label outside every
 * scenario (in a Background, a Rule header, after a scenario's last step, or
 * between scenarios) is always unplaced.
 */
export function unplacedStepLabels(feature: FeatureAst): GherkinComment[] {
  const perScenario = feature.scenarios.map((scenario) => ({
    scenario,
    unplaced: new Set(
      scenarioProcedure(scenario, feature.comments).unplacedLabels,
    ),
  }));
  const out: GherkinComment[] = [];
  for (const comment of feature.comments) {
    if (!STEP_LABEL_RE.test(comment.text)) continue;
    const owner = perScenario.find(({ scenario }) =>
      comment.line >= scenario.range.start.line &&
      comment.line <= scenario.range.end.line
    );
    if (!owner || owner.unplaced.has(comment)) out.push(comment);
  }
  return out;
}
