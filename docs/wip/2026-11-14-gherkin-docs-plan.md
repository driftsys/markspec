# Gherkin epic docs: implementation plan

> For agentic workers: execute task by task with
> `superpowers:subagent-driven-development`. Each task gets its own review
> before the next task starts.

**Goal:** Close the last item of epic #915, "Docs: spec + guide chapter, ADR for
the Gherkin AST and the `.feature` entry convention", by documenting the Case A
behaviour that is shipped but has no spec section or chapter of its own.

**Base:** `origin/main` at `44fc75f1`. Design reference:
`docs/wip/2026-11-13-gherkin-model-design.md`. That file is working memory only.
Describe shipped behaviour only. Check every statement against the code in
`packages/markspec/core/gherkin/`, `core/criteria/`, `core/parser/` and
`core/validator/`.

## What is already done (no task)

- ADR-037 (scenario locators) and ADR-038 (Gherkin AST, with amendments for
  procedure view, Case A role, Case B, LSP and VS Code) exist with status
  Accepted, implemented. Both are in the AGENTS.md ADR list and in
  `docs/architecture/overview.md`.
- `language.md` §1.3 §7 (entries in `.feature` files, step 6a) and the MSL-B062
  to MSL-B069 rows in §8.12 exist.
- The guide has `feature-files.md` (Case B) and `scenario-locators.md`, and both
  are in `docs/guide/SUMMARY.md`. `editor-vscode.md` and `cli.md` cover
  `.feature` files.

## Gaps

1. `language.md` defines block role (criteria, procedure, illustration),
   procedure steps and `# Step` labels only inside the MSL-B064 to MSL-B068
   table rows. There is no normative §1.3 section for Gherkin blocks in entries
   (Case A).
2. `docs/spec/language/ast.md` does not describe the Gherkin AST on
   `FeatureNode` (the normalized `FeatureAst`, comments, the scanner fallback).
3. The guide has no Gherkin authoring chapter. Case A authoring (writing
   scenarios, role, procedure steps, step labels) lives inside the chapter
   "Scenario locators", so the chapter title hides it.
4. `skills/markspec-gherkin/SKILL.md` describes only `Verified-by:`. It does not
   mention scenario locators, block roles, procedure steps or `.feature`
   entries.
5. Known gaps to state as limitations (not to fix here): #937 (`.feature` body
   tokens, description lists, Q401 noise), #938 (LSP does not publish MSL-L006
   and MSL-T014), ADR-038 LSP decision D3 (scenario-name rename is not
   implemented), D6 (no code actions for `.feature`), #932 (Windows test).

## Task 1: spec section for Gherkin blocks in entries

- **File:** `docs/spec/language/language.md`.
- **Scope:** add `#### §8 Gherkin blocks in entries` after §7 in §1.3. Cover:
  which fences count as feature blocks (`gherkin`, `feature`, nested ones too);
  the role taken from the entry type (Requirement or Contract gives criteria,
  Test gives procedure, any other type gives illustration, no type gives no
  role); the procedure-step rule (Given precondition, When and `*` action, Then
  outcome, And or But take the previous role, when a new step opens); `# Step`
  labels; scenario names as locator targets (link to §-locator text and
  ADR-037); parse failure behaviour (MSL-B062, English-only scanner fallback).
  Link each rule to its MSL-B row and to ADR-038.
- **Check against:** `core/gherkin/role.ts`, `core/gherkin/procedure.ts`,
  `core/criteria/scenarios.ts`, `core/gherkin/load.ts`.
- **Verify:** `just check`; `prim fmt --check docs/spec/language/language.md`;
  `prim lint docs/spec/language/`.

## Task 2: Gherkin AST in the AST spec

- **File:** `docs/spec/language/ast.md`.
- **Scope:** add a section for the Gherkin AST attached to a feature block node:
  the fields of the normalized AST (feature, rules, backgrounds, scenarios,
  steps with keyword type, examples, comments, file-relative positions), the
  pinned parser `@cucumber/gherkin@42.0.1`, lazy loading, and what is present
  when parsing fails. For `.feature` files, `FeatureNode.source` is the span of
  the owning node. Use the field names exactly as in the type declarations.
- **Check against:** `core/gherkin/` types and `project.ts`, `core/model/`.
- **Verify:** as Task 1, on `docs/spec/language/`.

## Task 3: guide chapter "Gherkin scenarios"

- **Files:** new `docs/guide/gherkin.md`; `docs/guide/scenario-locators.md`;
  `docs/guide/SUMMARY.md`; every file that links to a moved anchor (8 links to
  `scenario-locators.md#…` today, including `language.md` §8.12 and
  `feature-files.md`).
- **Scope:** move the sections "Write the scenarios", "Procedure steps in a Test
  entry", "Role of a Gherkin block" and "Step labels" into `gherkin.md`, plus a
  short section that points to `feature-files.md` for Case B. Keep addressing,
  diagnostics for locators, coverage and criteria in `scenario-locators.md`. Add
  `gherkin.md` to SUMMARY.md before "Scenario locators". Update every moved
  anchor link. Move text, do not rewrite it, except where a statement is false.
- **Verify:** `just check`; `prim lint docs/` (anchor check);
  `grep -rn 'scenario-locators.md#' docs` returns only anchors that still exist.

## Task 4: update the markspec-gherkin skill

- **File:** `skills/markspec-gherkin/SKILL.md` (and its bundle manifest only if
  the description field lives there).
- **Scope:** keep the `Verified-by:` content. Add short sections: scenario
  locators `ID [Scenario name]` on `Satisfies` / `Verifies`; block role per
  entry type and MSL-B064; procedure steps and `# Step` labels for Test entries;
  `.feature` files with `# [ID]` headers, linking to the guide. Update the
  frontmatter description to name these.
- **Verify:** `just check`; `prim fmt --check skills/`; `upskill lint` if the
  repo uses it.

## Task 5: limitations and epic close-out

- **Files:** `docs/guide/feature-files.md` "Known limitations",
  `docs/guide/gherkin.md`.
- **Scope:** check that #937, #938, D3 rename and the `# language:` limit are
  listed where a reader meets them; add the ones missing, each with its issue
  number. File a follow-up issue for D6 (code actions for `.feature`) if none
  exists, and reference it. No code change.
- **Verify:** `just check`; `prim lint docs/guide/`.

After Task 5: garden `docs/wip/` (sdd-gardening: this plan and the design doc go
to `docs/archive/`), `just build`, one commit, PR with `Closes #915.` only if
the user wants the epic closed by this PR.
