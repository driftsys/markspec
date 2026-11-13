# Gherkin Case A (block role, role checks, step labels) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each `gherkin` / `feature` block inside an entry a role derived
from the host entry type (criteria, procedure, or illustration), and add the
checks that depend on that role, `# Step N` labels, and the two procedure info
diagnostics.

**Architecture:** The role is a pure function of the resolved entry type
(`blockRole(entry, profile)`), derived on demand inside each check, as
`checkProcedureSteps` and `validateLocators` do today. Nothing new is stored on
`Entry` and the compile output does not change. `FeatureAst` gains the block's
comments (from `GherkinDocument.comments`) so that `scenarioProcedure` can
attach `# Step` labels. All new diagnostics run in one new validator module,
called from `validateWithProfile` (pipeline) and `WorkspaceIndex.validateAll`
(LSP).

**Tech Stack:** Deno / TypeScript, `@cucumber/gherkin@42.0.1` (already pinned),
`@std/assert`.

**Spec:** `docs/wip/2026-11-13-gherkin-model-design.md` — §4.1 rule 7 (role),
§7.1 (first `And` / `But`), §7.3 (step without action), §7.4 (step labels), §9.1
(facet by core type), §13 (severities). Prior decisions: issue #915 comments
(locator slice, AST slice, procedure slice), ADR-037, ADR-038 and its 2026-11-14
amendment.

## Open decisions (recommendation first)

1. **Where the role lives.** (a) Derived on demand by
   `blockRole(entry,
   profile)`; no field on `Entry` or `FeatureAst`.
   **Recommended**: matches ADR-038 amendment decision 1, needs no
   compile-schema change, and cannot go stale. (b) Store `Entry.criteria` /
   `Entry.procedure` via `lowerFacets` (design §8.2–§8.3). Defer to the slice
   that needs the full facet records (coverage on procedures); this slice has no
   consumer for them.
2. **Facet lookup.** (a) Reuse `isCriteriaBearing` and `isTestEntry` from
   `core/criteria/scenarios.ts` inside `blockRole`. **Recommended**: one source
   of truth with the existing checks. (b) Add `facet` to `CoreTypeDef` and
   `facetForType` (design §9.1). Defer with option 1b.
3. **Codes.** **Recommended** (next free numbers in the body family, language.md
   §8.12; ADR-012 phased scheme):
   - `MSL-B064` warning — a scenario of a criteria block (Requirement /
     Contract) has no outcome (`Then`) step, after role resolution.
   - `MSL-B065` info — a procedure step (Test) has expected results and no
     action (design §7.3).
   - `MSL-B066` info — `And` / `But` is the first step of a scenario, read as an
     action (design §7.1). Applies to every role, because the role rule is the
     same everywhere.
   - `MSL-B067` info — a `# Step` label comment that labels nothing (design
     §7.4). Test entries only, because labels only mean something in a
     procedure.
   - `MSL-B068` info — a feature block in an entry whose type has no facet
     (design §13 row "Feature block in an entry whose type has no facet").
4. **Is MSL-B068 in this slice?** (a) Yes, only for typed entries (an entry with
   no resolved type is not reported, so a project with no profile sees nothing).
   **Recommended**: it is the only visible effect of the "illustration" role and
   it is info. (b) No, leave it for the facet-storage slice.
5. **"The two info diagnostics".** The procedure-slice decision 4 deferred "the
   two info diagnostics" without naming them. **Recommended reading**: B065
   (expected result, no action) and B066 (first `And` / `But`), the two info
   rows of design §7.1 and §7.3; B067 belongs to the label feature itself.
6. **Where comments are stored.** (a) `FeatureAst.comments: { line, text }[]`
   (block-relative line, synthetic line removed), and labels attached by
   `scenarioProcedure(scenario, comments?)`. **Recommended**: `FeatureAst` stays
   a pure function of `source`, so the ADR-015 gate is unaffected, and `bodyAst`
   is not in the compile output. (b) Resolve labels in `parseFeature` and store
   `label` on each step. Rejected: it duplicates procedure pairing in the
   parser.
7. **MSL-B064 and outlines / Given-only scenarios.** **Recommended**: a scenario
   with a `Given` and a `Then` and no action is valid (design §7.3, "a state
   that must hold"); only "no outcome step at all" warns. Outline `Examples` do
   not matter. A scenario with zero steps also warns (no outcome).

## Scope

In: role derivation, B064–B068, `# Step` labels in the procedure view, comments
in `FeatureAst`, docs (language.md §8.12, guide, ADR-038 amendment). Diagnostics
reach editors through the existing LSP cross-file validation only.

Out: `.feature` files (Case B), `lowerFacets` / stored facets, `facetForType`,
item-form criteria and the MSL-B044 redefinition (§9.3), new LSP features
(hover, code actions, semantic tokens for labels), VS Code, body-token changes
(§8.4), the git-style trailer (#914).

## Global Constraints

- No `CORE_SCHEMA_VERSION` change; no change to `markspec-compile-schema.json`
  or to compile output.
- Projects with no `gherkin` / `feature` fence: byte-identical output of
  `check`, `compile`, `export` and the LSP diagnostics. The new module returns
  `[]` before it classifies anything when no entry has a feature node.
- Determinism: every new check classifies the entry inside the check
  (`withType(entry, profile)` from `core/validator/locators.ts`), skips a block
  with `parseError` or without `feature`, and gives the same result whether the
  entry came from `parseFile` (parser loaded) or from `parse()` after a load.
  When the parser was never loaded, no new diagnostic fires (same rule as B062 /
  B063).
- Upstream entries are never reported (`emittableEntries`).
- Diagnostics are located at a file line from
  `featureFileLine(entry, node,
  line)`, column 1.
- Plain, literal English in code comments, messages and docs.
- The word `Step` in labels is fixed for every spoken language; match
  `/^#\s*Step\b.*$/` on the trimmed comment, `label` = text after `#`, trimmed.

## Review Focus

1. A Requirement block in a non-English language (`# language: fr`) with no
   `Alors` step must raise B064; a block with `Alors` must not. Test in Task 3.
2. A `# Step 1` comment inside a doc string is not a comment for the parser and
   must not label anything or raise B067. Test in Task 2.
3. A Requirement with a feature block nested in a list item: B064 must still be
   reported (checks use `featureNodes`, any depth), as B062 / B063 do. Test in
   Task 3.
4. Same text checked with the parser loaded in-process versus in a fresh
   process: identical diagnostics. Test in Task 5.
5. An entry with `Type: Test` and no profile: none of B064–B068 fire (untyped).
   Test in Task 3.

## File structure

- Modify `packages/markspec/core/gherkin/types.ts` — `GherkinComment`,
  `FeatureAst.comments`.
- Modify `packages/markspec/core/gherkin/parse.ts` — fill `comments`.
- Modify `packages/markspec/core/gherkin/procedure.ts` — `label?` on
  `ProcedureStep`, `unplacedLabels` on `ScenarioProcedure`, optional `comments`
  argument.
- Create `packages/markspec/core/gherkin/role.ts` — `BlockRole`, `blockRole`.
- Create `packages/markspec/core/validator/block_role.ts` — `checkBlockRoles`
  (B064–B068).
- Modify `packages/markspec/core/validator/pipeline.ts`,
  `packages/markspec/lsp/workspace.ts`, `packages/markspec/core/mod.ts`.
- Docs: `docs/spec/language/language.md`, `docs/guide/scenario-locators.md`,
  `docs/architecture/adr-038-gherkin-ast.md`.

---

### Task 1: Comments in `FeatureAst`

**Files:**

- Modify: `packages/markspec/core/gherkin/types.ts`,
  `packages/markspec/core/gherkin/parse.ts`
- Test: `packages/markspec/core/gherkin/parse_test.ts`

**Interfaces:**

- Produces:
  `interface GherkinComment { readonly line: number; readonly text:
  string }`
  (1-based block line, synthetic `Feature:` line removed; `text` is the comment
  line trimmed, including `#`).
  `FeatureAst.comments: readonly
  GherkinComment[]` in document order.

- [ ] **Step 1: Write failing tests** in `parse_test.ts`:
  - `parseFeature: keeps comments with block lines` — source
    `Scenario: S\n  # Step 1\n  * do\n  Then ok` (no `Feature:`); assert
    `feature.comments` equals `[{ line: 2, text: "# Step 1" }]`.
  - `parseFeature: comment line numbers with an explicit Feature line` — source
    `Feature: F\n# c\nScenario: S\n  Then ok`; assert
    `[{ line: 2, text: "# c" }]`.
  - `parseFeature: the language comment is kept` — `# language: fr` source;
    assert `comments[0]` is `{ line: 1, text: "# language: fr" }`.
- [ ] **Step 2:** Run
      `deno test -A packages/markspec/core/gherkin/parse_test.ts`; expect FAIL
      (`comments` undefined).
- [ ] **Step 3:** Map `document.comments` (`{ location, text }`) through the
      existing `shift`; trim `text`. Add `comments: []` wherever a `FeatureAst`
      is built in tests or fixtures that construct one by hand (`deno check`
      finds them).
- [ ] **Step 4:** Run the gherkin tests and
      `deno check packages/markspec/core/mod.ts`; expect PASS. Run
      `deno test -A packages/markspec/core/ast/` to confirm the equivalence gate
      tests still pass.
- [ ] **Step 5:** Commit `feat(core): keep Gherkin comments in the feature AST`.

### Task 2: `# Step` labels in the procedure view

**Files:**

- Modify: `packages/markspec/core/gherkin/procedure.ts`
- Test: `packages/markspec/core/gherkin/procedure_test.ts`

**Interfaces:**

- Consumes: `GherkinComment` (Task 1).
- Produces: `ProcedureStep.label?: string`;
  `ScenarioProcedure.unplacedLabels:
  readonly GherkinComment[]`; signature
  `scenarioProcedure(scenario:
  ScenarioAst, comments: readonly GherkinComment[] = []): ScenarioProcedure`.

Rule (design §7.4): a label comment applies to the `ProcedureStep` whose first
step line is the next step line after the comment, with only comments or blank
lines between them. Only comments whose line lies inside `scenario.range` are
considered (so Background comments and other scenarios' comments are never
seen). A label inside the scenario range that does not precede the first step of
a `ProcedureStep` goes to `unplacedLabels`. The first label wins when two labels
precede the same step; the second is unplaced.

- [ ] **Step 1: Write failing tests:**
  - `scenarioProcedure: labels the steps of the radar example` — the §7.4 radar
    scenario; assert `steps.map(s => s.label)` equals `["Step 1", "Step 2"]` and
    `unplacedLabels` is `[]`.
  - `scenarioProcedure: label before a leading Given is unplaced` — `# Step 0`
    above `Given`; assert it is in `unplacedLabels` and `steps[0].label` is
    `undefined`.
  - `scenarioProcedure: label before a non-first step is unplaced` — label
    between `When a` and `And b`; assert unplaced.
  - `scenarioProcedure: plain comments are ignored` — `# note` above a step; no
    label, nothing unplaced.
  - `scenarioProcedure: label text inside a doc string is not a label` — a doc
    string holding `# Step 9`; assert nothing labelled or unplaced.
  - `scenarioProcedure: without comments, labels are absent` — call with one
    argument; existing assertions unchanged (`label` key not present).
- [ ] **Step 2:** Run
      `deno test -A packages/markspec/core/gherkin/procedure_test.ts`; expect
      FAIL.
- [ ] **Step 3:** Implement. Do not add a `label` key when there is no label, so
      existing `assertEquals` tests stay unchanged.
- [ ] **Step 4:** Run the test file; expect PASS.
- [ ] **Step 5:** Commit
      `feat(core): attach Step labels to Gherkin procedure steps`.

### Task 3: Block role and MSL-B064 (criterion with no outcome)

**Files:**

- Create: `packages/markspec/core/gherkin/role.ts`,
  `packages/markspec/core/validator/block_role.ts`
- Test: `packages/markspec/core/gherkin/role_test.ts`,
  `packages/markspec/core/validator/block_role_test.ts`

**Interfaces:**

- Consumes: `isCriteriaBearing`, `isTestEntry` (`core/criteria/scenarios.ts`),
  `withType` (`core/validator/locators.ts`), `featureNodes`
  (`core/validator/feature_parse.ts`), `stepRoles`, `featureFileLine`.
- Produces: `type BlockRole = "criteria" | "procedure" | "illustration"`;
  `blockRole(entry: Entry, profile: EffectiveProfile | null): BlockRole |
  undefined`
  (`undefined` when the entry has no resolved type; criteria when
  `isCriteriaBearing`, procedure when `isTestEntry`, else illustration);
  `checkBlockRoles(entries: readonly Entry[], profile: EffectiveProfile |
  null): Diagnostic[]`.

`blockRole` does not classify; `checkBlockRoles` calls `withType` first, then
`blockRole`. `checkBlockRoles` returns `[]` immediately when no emittable entry
has a feature node (byte-identical constraint).

- [ ] **Step 1: Write failing tests** (`role_test.ts`): Requirement →
      `criteria`; Contract descendant (`SoftwareInterface`) → `criteria`; Test →
      `procedure`; Component → `illustration`; no type → `undefined`; a profile
      type extending Requirement → `criteria` (use the profile helper the
      existing `locators_test.ts` uses).
- [ ] **Step 2: Write failing tests** (`block_role_test.ts`), parsing with
      `parseFile` and a profile that types `REQ_` as Requirement, `TST_` as
      Test, `SWC_` as Component (copy the fixture style of `procedure_test.ts`):
  - `MSL-B064: scenario with no Then in a Requirement` — `Given a / When b`; one
    warning, code `MSL-B064`, line = file line of the `Scenario:` keyword,
    column 1, message
    `REQ_X_0001: scenario "S" has no outcome (no Then step);
    a criterion must state what has to hold`.
  - `MSL-B064: Given and Then without action is valid` — no diagnostic.
  - `MSL-B064: French block without Alors` — `# language: fr`; one warning.
  - `MSL-B064: block nested in a list item` — one warning.
  - `MSL-B064: not reported for Test or Component entries`.
  - `MSL-B064: untyped entry (no profile) is not checked` —
    `Type:
    Requirement` trailer, `profile = null`; no diagnostic.
  - `MSL-B064: block with a parse error is skipped` — only B062 (from
    `checkFeatureParse`), none from `checkBlockRoles`.
  - `checkBlockRoles: no feature fences returns []`.
- [ ] **Step 3:** Run both test files; expect FAIL (modules missing).
- [ ] **Step 4:** Implement `role.ts` and `checkBlockRoles` with B064 only. A
      scenario warns when `stepRoles(scenario.steps)` holds no `"outcome"`
      (Background steps are preconditions and never count).
- [ ] **Step 5:** Run the tests; expect PASS.
- [ ] **Step 6:** Commit
      `feat(core): derive the role of a Gherkin block and warn on criteria with no outcome`.

### Task 4: MSL-B065, MSL-B066, MSL-B067, MSL-B068

**Files:**

- Modify: `packages/markspec/core/validator/block_role.ts`
- Test: `packages/markspec/core/validator/block_role_test.ts`

**Interfaces:**

- Consumes: `scenarioProcedure(scenario, node.feature.comments)` (Task 2),
  `blockRole` (Task 3).

Positions (column 1 always): B065 at the first expected step of the step; B066
at the first step of the scenario; B067 at the comment line; B068 at the first
source line of the block (`featureFileLine(entry, node, 1)`), once per block.
All four are `severity: "info"`.

- [ ] **Step 1: Write failing tests:**
  - `MSL-B065: procedure step with a Then and no action` — Test,
    `Given a / Then b / When c / Then d`: one info at the `Then b` line, message
    `TST_X_0001: step 1 of scenario "S" has an expected result and no
    action`.
  - `MSL-B065: not reported in a Requirement`.
  - `MSL-B066: first And in a Test` and `MSL-B066: first But in a Requirement` —
    one info each, message
    `<id>: scenario "S" starts with "And"; the step is
    read as an action`.
  - `MSL-B066: a first And after a Background is still reported` (the scenario's
    own first step decides).
  - `MSL-B067: misplaced Step label in a Test` — label before a leading `Given`;
    one info at the comment line, message
    `<id>: "# Step 0" labels no procedure
    step; place it directly above the first action of a step`.
  - `MSL-B067: labels in a Requirement are not checked`.
  - `MSL-B068: feature block in a Component` — one info, message
    `<id>: Gherkin
    block in a Component entry is an illustration; only Requirement, Contract
    and Test entries give it a meaning`.
  - `MSL-B068: not reported for an untyped entry`.
  - `checkBlockRoles: diagnostics are sorted by file line within an entry`.
- [ ] **Step 2:** Run
      `deno test -A packages/markspec/core/validator/block_role_test.ts`; expect
      the new tests to FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit
      `feat(core): report Gherkin role info diagnostics and misplaced Step labels`.

### Task 5: Wire into `check` and the LSP; determinism

**Files:**

- Modify: `packages/markspec/core/validator/pipeline.ts` (after Stage 4.6),
  `packages/markspec/lsp/workspace.ts` (`validateAll`, next to
  `checkProcedureSteps`), `packages/markspec/core/mod.ts` (export
  `checkBlockRoles`, `blockRole`, `BlockRole`)
- Test: `packages/markspec/core/validator/block_role_load_order_test.ts`,
  `packages/markspec/core/validator/pipeline_test.ts`,
  `packages/markspec/lsp/workspace_test.ts`, `tests/e2e/` (new
  `gherkin_role_test.ts`)

- [ ] **Step 1: Write failing tests:**
  - `block_role_load_order_test.ts`, same pattern as
    `procedure_load_order_test.ts`: for one text holding a Requirement without
    `Then` and a Test with a misplaced label, (a) `parseFile` in a fresh
    process, (b) `loadGherkin()` then `parse()` in a fresh process, (c)
    `parse()` with no load in a fresh process. Assert (a) and (b) give the same
    `[code, line]` list (B064, B067), and (c) gives `[]`.
  - `pipeline_test.ts`: `validateWithProfile` reports `MSL-B064` with the
    classified entries; for unclassified input entries it gives the same result.
  - `workspace_test.ts`: `validateAll(profile)` includes `MSL-B064` for
    unclassified indexed entries.
  - e2e `gherkin_role_test.ts`: `markspec check` on a project with a profile and
    a Requirement without `Then` prints `MSL-B064` on stderr; exit code is the
    one `check` gives for warnings only (assert against the existing B063 e2e
    test's expectation).
  - e2e byte-identity: run `markspec compile` and `markspec check --format json`
    on `tests/fixtures` projects with no gherkin fence; assert output equals the
    output of the same command on `origin/main` recorded as a snapshot
    (`assertSnapshot`; the snapshot is created before Step 3 and must not
    change).
- [ ] **Step 2:** Run the new tests; expect FAIL (not wired).
- [ ] **Step 3:** Wire the calls; comment each call site in one line, as the
      B063 call sites are.
- [ ] **Step 4:** Run `just check`; expect all green, zero warnings.
- [ ] **Step 5:** Commit
      `feat(core): run the Gherkin block-role checks in check and the LSP`.

### Task 6: Documentation

**Files:**

- Modify: `docs/spec/language/language.md` (§8.12 body table: rows B064–B068,
  worded like the B063 row: scope, position, skip rules),
  `docs/guide/scenario-locators.md` (new section "Role of a Gherkin block",
  table of host type → role; "Step labels" subsection with the §7.4 radar
  example; one example per new code), `docs/architecture/adr-038-gherkin-ast.md`
  (new "Amendment 2026-11-14 — Case A block role" with decisions from the
  open-decisions list as ratified, Alternatives considered, trace line),
  `docs/spec/internal/markspec-core-data-model.md` (`FeatureAst.comments`,
  `ProcedureStep.label`, if the AST is described there).
- [ ] **Step 1:** Write the docs. Check every statement against the code from
      Tasks 1–5 (codes, severities, positions, untyped-entry rule, Test-only
      labels).
- [ ] **Step 2:** Run `just fmt` then `prim lint .` and `markspec check docs/`;
      expect no new diagnostics.
- [ ] **Step 3:** Commit
      `docs(docs): document the role of Gherkin blocks and Step labels`.

Before the PR: `just build`, `deno fmt --check`, and garden `docs/wip/` with
`sdd-gardening` (ADR-038 amendment is the durable record).

## Alternatives considered

- **Store facets on `Entry` now (`lowerFacets`).** Rejected for this slice: no
  consumer, and it adds compile-output keys and a schema-file change. See open
  decision 1.
- **Role from a profile setting instead of the core type.** Rejected: design
  §9.1 and ADR-009 keep the meaning of a facet in core.
- **B064 in every entry type.** Rejected: a Test scenario is a procedure (B063
  covers it), and an illustration has no rule.
- **Labels resolved by the parser.** Rejected: see open decision 6.
- **One code for all three procedure info cases.** Rejected: separate codes let
  a project silence one case, and each has a different fix.
- **Localized `Step` word.** Rejected: design §7.4 fixes `Step` for every
  language; a localized word would need a table outside `@cucumber/gherkin`.

## Trace links

- Epic #915 — Case A slice; procedure-slice decision 4 (labels and the info
  diagnostics deferred here).
- Design: `docs/wip/2026-11-13-gherkin-model-design.md` §4.1, §7.1, §7.3, §7.4,
  §9.1, §13.
- ADR-037 (criteria on Requirement / Contract), ADR-038 and its procedure-view
  amendment (`scenarioProcedure`, MSL-B062, MSL-B063), ADR-012 (codes), ADR-015
  (equivalence gate), ADR-009 (core / profile boundary).
- Code: `core/gherkin/{types,parse,procedure,role}.ts`,
  `core/validator/{block_role,procedure,locators,feature_parse,pipeline}.ts`,
  `core/criteria/scenarios.ts`, `lsp/workspace.ts`.
