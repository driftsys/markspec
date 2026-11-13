# Gherkin Procedure View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking. A task reviewer runs after every task
> (per-task review gate).

**Goal:** Derive a procedure view (numbered steps, each with actions and
expected results) from the normalized Gherkin AST, and report a warning for a
procedure step that has actions but no expected result.

**Architecture:** One pure function in `core/gherkin/procedure.ts` maps a
`ScenarioAst` to a `ScenarioProcedure` (preconditions + `ProcedureStep[]`). It
is computed on demand from `FeatureNode.feature`; nothing new is stored on the
AST or on `Entry`. One validator module, `core/validator/procedure.ts`, walks
the feature blocks of Test entries and emits `MSL-B063`. The validator runs in
the `check` pipeline (next to `MSL-B062`) and in the LSP `validateAll`.

**Tech stack:** Deno / TypeScript, `@cucumber/gherkin@42.0.1` (already loaded
lazily by ADR-038), `@std/assert`.

Epic: #915, slice "Procedure view: step / expected-result pairing in the Gherkin
AST + lint for a step with no expected result".\
Design: `docs/wip/2026-11-13-gherkin-model-design.md` §7.1–§7.4, §9.\
Builds on: ADR-037 (scenario locators), ADR-038 (Gherkin AST).

---

## Open decisions (each with a recommended option)

1. **Where the view lives.**
   - (a) **Recommended.** A pure function `scenarioProcedure(scenario)` in
     `core/gherkin/procedure.ts`, called by consumers. `FeatureAst` and
     `ScenarioAst` do not change, so ADR-038's equivalence-gate exemption and
     parse output stay as they are.
   - (b) A `procedure` field added to `ScenarioAst` by `parseFeature`. Every
     parse pays for it, and the AST gains a second representation of the same
     steps.
2. **Lint rule or check diagnostic.**
   - (a) **Recommended.** A check diagnostic `MSL-B063` (warning, body family),
     beside `MSL-B060`–`MSL-B062`. The finding is structural (step order), not
     prose quality, and the B family already holds the Gherkin codes.
   - (b) An `MSL-Q` lint rule (ADR-021). Rejected as the default: MSL-Q rules
     analyse body prose tokens and roll up into `markspec score`; a missing
     `Then` is not a prose-quality signal, and `lint` is advisory.
3. **Which entries get `MSL-B063`.**
   - (a) **Recommended.** Entries whose type is, or extends, core `Test`
     (`isTestEntry`, `core/criteria/scenarios.ts`). The design (§7.3) raises the
     warning "in a procedure", and the `procedure` facet belongs to Test.
   - (b) Every entry type. Rejected: in a Requirement the block is a criterion;
     "a criterion with no Then step" is the Case A slice's check.
4. **The two info diagnostics and step labels of §7.3–§7.4** ("no action step in
   a procedure", "conjunction as the first step", `# Step N` labels).
   - (a) **Recommended.** Implement the role rules (a first `And`/`But` becomes
     an action), but defer both info codes and `label` to the Case A slice.
     Labels need the parser's comment list in `parseFeature`, and they never
     change numbering. `ProcedureStep.label` is not added in this slice.
   - (b) Include them now. Adds two codes and a change to `parse.ts` to a slice
     whose title names one lint.
5. **Location of `MSL-B063`.**
   - (a) **Recommended.** The file line of the last action step of the step with
     no expected result (`featureFileLine`), column 1, as `MSL-B062` does.
   - (b) The scenario line. Less precise when a scenario has several steps.

The tasks below assume every recommended option. If a decision changes, only the
task that names it changes.

## Scope

In scope:

- `ProcedureStep`, `ScenarioProcedure`, role resolution, pairing (design
  §7.1–§7.3), outlines, backgrounds, Rules.
- `MSL-B063` in `check` and in the LSP `validateAll` (published like every other
  diagnostic; no other LSP feature).
- `language.md` §8 row, guide note, ADR-038 amendment draft for gardening.

Out of scope (later slices): Case A roles by host type, `Entry.procedure` /
`lowerFacets`, `facet` on core types, `.feature` files, LSP hover / symbols,
`# Step N` labels, the two info diagnostics, procedure tables.

## Data shapes

```ts
// core/gherkin/procedure.ts
export type StepRole = "precondition" | "action" | "outcome";

export interface ProcedureStepRef {
  readonly step: StepAst; // from core/gherkin/types.ts, unchanged
  readonly role: StepRole;
  readonly origin: "background" | "scenario";
}

export interface ProcedureStep {
  readonly n: number; // 1-based position in the scenario
  readonly setup: readonly ProcedureStepRef[]; // Given after the first action
  readonly actions: readonly ProcedureStepRef[];
  readonly expected: readonly ProcedureStepRef[];
}

export interface ScenarioProcedure {
  readonly preconditions: readonly ProcedureStepRef[];
  readonly steps: readonly ProcedureStep[];
}

export function stepRoles(steps: readonly StepAst[]): StepRole[];
export function scenarioProcedure(scenario: ScenarioAst): ScenarioProcedure;
```

`ProcedureStepRef` wraps the existing `StepAst` instead of adding fields to it,
so `types.ts` and `parse.ts` do not change (decision 1).

## Rules

Role resolution (design §7.1), on `StepAst.normalized`:

| `normalized`             | role                                  |
| ------------------------ | ------------------------------------- |
| any background step      | `precondition`                        |
| `given`                  | `precondition`                        |
| `when`                   | `action`                              |
| `then`                   | `outcome`                             |
| `step` (`*`)             | `action`, in every position           |
| `and` / `but`            | the role of the step before it        |
| `and` / `but` when first | `action` (info code deferred, dec. 4) |

Pairing (design §7.2–§7.3):

1. `preconditions` = `scenario.background` (origin `background`), then the
   leading scenario steps whose role is `precondition`.
2. The remaining scenario steps are read in order, one open step at a time:
   - `precondition`: if the open step has actions or expected results, close it
     and open a new one; add to `setup`.
   - `action`: if the open step has expected results, close it and open a new
     one; add to `actions`.
   - `outcome`: add to `expected`.
3. At the end, close the open step if it is not empty. Number steps 1..n.

Consequences: `Given … Then …` gives one step with empty `actions`; an action
run at the end gives a step with empty `expected`; a `Scenario Outline` gives
one procedure (examples are not expanded); Rules change nothing (the scenario
already carries its Rule background).

`MSL-B063` (warning): for each emittable entry whose type extends `Test`, for
each `FeatureNode` with a `feature` (top level or nested in a list item, as
`MSL-B062`), for each scenario, for each `ProcedureStep` with
`actions.length >
0` and `expected.length === 0`: message
`<ID>: step <n> of scenario "<name>" has no expected result (no Then step)`,
location per decision 5.

## Determinism and byte-identical output

- The view is a pure function of `FeatureAst`. `MSL-B063` exists only when a
  block has `feature`. `parseFile` (used by `check`, `compile`, LSP, MCP) loads
  the parser whenever a gherkin/feature fence exists (ADR-038 Decision 2), so
  these paths always agree. The synchronous `parse()` without preloading gives
  no `feature`, hence no `MSL-B063`: the same rule as `MSL-B062`, documented,
  and pinned by a test that preloads and one that does not.
- No scanner fallback for the procedure: the ADR-037 scanner knows only scenario
  names, not steps, so a fallback would give different results by load order. A
  block with `parseError` gives `MSL-B062` and no `MSL-B063`.
- Projects without gherkin/feature fences: no entry has a `FeatureNode`, the
  validator yields `[]`, and no output changes. Pinned by an e2e test that runs
  `check --format json` on a fixture without fences and compares with the output
  on `origin/main` (snapshot).
- No change to `Entry`, compiled JSON, `CORE_SCHEMA_VERSION`, or `fmt`.

## Alternatives considered

- Store the procedure on `ScenarioAst` (decision 1b) — rejected, see above.
- MSL-Q lint rule (decision 2b) — rejected, see above.
- Report on every entry type (decision 3b) — belongs to Case A.
- Let `*` inherit the previous role, like `And` — rejected by design §7.1: a `*`
  after a `Then` must open the next step.
- Expand Scenario Outline examples into one procedure per row — rejected by
  design D2 (no pickles).

## Trace links

- Satisfies epic #915 slice 5; design D3, §7.1–§7.3.
- Related: ADR-037, ADR-038, ADR-012 (diagnostic codes), ADR-021 (not used).
- Garden into: an ADR-038 amendment (procedure view + MSL-B063) and
  `language.md` §8.

## File map

| File                                                 | Change             |
| ---------------------------------------------------- | ------------------ |
| `packages/markspec/core/gherkin/procedure.ts`        | new                |
| `packages/markspec/core/gherkin/procedure_test.ts`   | new                |
| `packages/markspec/core/validator/procedure.ts`      | new                |
| `packages/markspec/core/validator/procedure_test.ts` | new                |
| `packages/markspec/core/validator/pipeline.ts`       | Stage 4.4 call     |
| `packages/markspec/lsp/workspace.ts`                 | `validateAll` call |
| `packages/markspec/core/mod.ts`                      | exports            |
| `tests/e2e/gherkin_procedure_test.ts`                | new                |
| `docs/spec/language/language.md`                     | §8 row             |
| `docs/guide/scenario-locators.md`                    | short section      |

---

## Task 1: Role resolution

**Files:** create `core/gherkin/procedure.ts`, `core/gherkin/procedure_test.ts`.

- [ ] Write failing tests for `stepRoles` with `StepAst` fixtures built through
      `loadGherkin()` + `parseFeature` (as `parse_test.ts` does):
      `Given/When/
      Then`; `And` after each role; `But` after `Then`; `*`
      after `Then` is an action; `*` after `Given` is an action; first step
      `And` is an action; French keywords (`Soit/Quand/Alors`).
- [ ] Run `deno test packages/markspec/core/gherkin/procedure_test.ts` — fails
      (module missing).
- [ ] Implement `StepRole` and `stepRoles`.
- [ ] Run the test — passes. Commit `feat(core): resolve Gherkin step roles`.

## Task 2: Pairing

**Files:** `core/gherkin/procedure.ts`, `procedure_test.ts`.

- [ ] Failing tests for `scenarioProcedure`: the issue's radar example gives 2
      steps (1 precondition); `Given … Then` gives 1 step with empty actions;
      trailing action gives a step with empty expected; `Given` after an action
      opens a new step as `setup`; `When`+`*`+`Then`+`And` is one step; empty
      scenario gives 0 steps; `n` is 1..k.
- [ ] Implement `ProcedureStepRef`, `ProcedureStep`, `ScenarioProcedure`,
      `scenarioProcedure`.
- [ ] Tests pass. Commit `feat(core): derive the Gherkin procedure view`.

## Task 3: Backgrounds, Rules, outlines

- [ ] Failing tests: Feature background steps come first in `preconditions` with
      `origin: "background"`; a Rule background follows the Feature one; a
      Background `When` is still a precondition; a Scenario Outline gives one
      procedure and its step texts keep `<placeholders>`; a block without
      `Feature:` (synthetic) gives the same procedure as with it.
- [ ] Implement whatever fails (expected: background origin handling).
- [ ] Tests pass. Commit
      `test(core): pin procedure view for backgrounds and outlines`.

## Task 4: Purity and determinism of the view

- [ ] Failing test: `scenarioProcedure` returns deep-equal results on two calls
      and does not mutate its input (`Object.freeze` the scenario deeply in the
      test); results are identical for the same source parsed twice.
- [ ] Fix if needed. Export `scenarioProcedure`, `stepRoles` and the types from
      `core/mod.ts`; `deno check packages/markspec/core/mod.ts`.
- [ ] Commit `feat(core): export the Gherkin procedure view`.

## Task 5: `MSL-B063` validator

**Files:** create `core/validator/procedure.ts`, `procedure_test.ts`.

- [ ] Failing tests with `parseFile` on Markdown fixtures plus a profile where
      `TST` maps to a `Test` descendant (copy the setup of
      `feature_parse_test.ts` / locator tests):
  - Test entry with a trailing action → one `MSL-B063`, warning, file line of
    the last action, column 1, message as in Rules.
  - Same block on a Requirement entry → none.
  - Test entry, all steps paired → none.
  - Block nested in a list item → reported.
  - Block with a parse error → `MSL-B062` only, no `MSL-B063`.
  - Source doc comment (Rust fixture) → line mapped through `LineMap`.
  - Upstream entry → none (`emittableEntries`).
- [ ] Implement `checkProcedureSteps(entries, profile)` reusing `isTestEntry`,
      `featureFileLine`, and the nested walk of `feature_parse.ts` (extract
      `featureNodes` into a shared helper if both modules need it; no other
      refactor).
- [ ] Tests pass. Commit
      `feat(core): warn on a procedure step with no expected result`.

## Task 6: Wire into `check` and the LSP

**Files:** `core/validator/pipeline.ts`, `lsp/workspace.ts`.

- [ ] Failing tests: pipeline test that a Test entry fixture yields `MSL-B063`
      via `validate`/the pipeline on classified entries (types must be resolved,
      so call it beside `validateLocators` with `finalEntries`, not beside
      `checkFeatureParse` on raw entries); `WorkspaceIndex.validateAll` with a
      profile returns `MSL-B063`.
- [ ] Add the call in both places, with a one-line comment naming the code.
- [ ] Tests pass. Commit `feat(core): run MSL-B063 in check and the LSP`.

## Task 7: Load-order determinism and byte-identical output (e2e)

**Files:** `tests/e2e/gherkin_procedure_test.ts`, a unit test in
`core/validator/procedure_test.ts`.

- [ ] Unit: the same entry built by synchronous `parse()` before any load gives
      no `MSL-B063`; built after `loadGherkin()` gives one. Run this test in its
      own file or with the reset hook of `core/gherkin/lazy_test.ts` so the
      cached module does not leak between tests.
- [ ] e2e (blackbox, `markspec()` helper): `check` on a project with a Test
      entry and a trailing action exits with the warning code and prints
      `MSL-B063`; `check --format json` on a project with no feature fences
      matches a committed snapshot taken before Task 5 (create the snapshot
      first and confirm it on `origin/main`).
- [ ] Commit `test(e2e): pin MSL-B063 and unchanged output without Gherkin`.

## Task 8: Docs

**Files:** `docs/spec/language/language.md`, `docs/guide/scenario-locators.md`,
`docs/wip/2026-11-14-gherkin-procedure-plan.md` (amendment notes).

- [ ] Add the `MSL-B063` row to the §8 body table (warning; Test entries only;
      location; only when the block parses).
- [ ] Add a short "Procedure steps" section to the guide: the pairing rule, `*`
      is always an action, the radar example, the warning.
- [ ] Draft the ADR-038 amendment text at the end of this plan for gardening
      (decisions 1–5).
- [ ] `just fmt`, `markspec check` on changed docs, `just build`. Commit
      `docs(docs): document the Gherkin procedure view and MSL-B063`.

## Final verification

- [ ] `just build` passes; `deno fmt --check` passes.
- [ ] Whole-branch `/review` before the PR; garden `docs/wip/` with
      `sdd-gardening`.
