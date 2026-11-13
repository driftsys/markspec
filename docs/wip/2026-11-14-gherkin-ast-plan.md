# Gherkin AST Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse every fenced `gherkin` / `feature` block with
`@cucumber/gherkin` into a normalized `FeatureAst` on `FeatureNode.feature`,
with file-relative lines, one warning for a block that does not parse, body
tokens taken from the AST, and `Entry.criteria` rebuilt from the AST.

**Architecture:** A new core module `core/gherkin/` owns the parser load, the
synthetic-Feature wrap, and the normalize step (`GherkinDocument` →
`FeatureAst`). `parseFile` loads the parser once, before the synchronous
Markdown / source parse, only when the text holds a `gherkin` or `feature`
fence. The synchronous AST build then fills `FeatureNode.feature`. Body tokens
and criteria read the AST instead of regular expressions.

**Tech Stack:** Deno / TypeScript, `npm:@cucumber/gherkin@42.0.1`,
`npm:@cucumber/messages@34.2.1`.

**Spec:** `docs/wip/2026-11-13-gherkin-model-design.md` §6 (parsing), §7
(normalized AST), §8.1 (`FeatureNode`), §8.4 (body tokens), §13 (validation row
"Gherkin text does not parse"). Also ADR-014, ADR-015, ADR-016, ADR-037.

**Tracks:** epic #915 (slice "Gherkin AST").\
**Trace links:** Satisfies epic #915 decision 1 ("`@cucumber/gherkin` comes with
the Gherkin AST slice") and design D4, D5; keeps ADR-037 D-criteria shape
unchanged; amends ADR-016 (token source for `gherkin-section` / `gherkin-step`);
respects ADR-015 (equivalence gate ignores `range` and the new field is a pure
function of `source`).

## Open decisions (each with a recommendation)

1. **How the parser is loaded while `parse()` and the AST build stay
   synchronous.**
   - (A, recommended) A module-level cached loader `loadGherkin()` (dynamic
     `import()`). `parseFile` awaits it only when the text matches
     ``/^\s*(```|~~~)\s*(gherkin|feature)\b/m``; the synchronous build then
     calls the cached parser. The synchronous `parse()` export fills `feature`
     only when the parser was already loaded; it is exported as `loadGherkin`
     from `core/mod.ts` so a caller of `parse()` can preload. Projects with no
     Gherkin never load it.
   - (B) Static import in `core/gherkin/`. Simplest and always deterministic,
     but every command (`check`, `lsp`, `mcp`) loads 1.2 MB of extra JS. Breaks
     design D4.
   - (C) Make the Gherkin step an async post-pass in `parseFile` that rewrites
     `bodyAst` and `bodyTokens` after the build. Duplicates the body-token walk
     and the source `LineMap` translation.
2. **Criteria for a block that does not parse.**
   - (A, recommended) Fall back to the existing `scanScenarioNames` for that
     block only. Locators keep resolving while the author fixes the block;
     `MSL-B062` already reports the problem. `scanScenarioNames` stays, used
     only as the fallback.
   - (B) No criteria from that block (design §8.1 literal reading). A typo in a
     step makes every `Verifies: X [name]` locator fail with `MSL-L007`, a
     second, misleading diagnostic.
3. **Version pin.** (A, recommended) `@cucumber/gherkin@42.0.1` (2026-08-05)
   with `@cucumber/messages@34.2.1` (2026-08-05), exact pins as for `@dprint/*`.
   43.0.0 / 35.0.0 were published 2026-11-12/13, less than two weeks ago;
   upgrade in a later chore. (B) `43.0.0` now.
4. **Code for the parse-error warning.** (A, recommended) `MSL-B062`, warning,
   body family next to `MSL-B060` / `MSL-B061` (design §13). Reported on any
   entry type, at the file line of the first parser error. (B) A P-family code.
   The P family is for entry structure, not body content.

## Scope

In scope: parser dependency; `FeatureAst` on `FeatureNode` for Markdown and
source doc comments; synthetic Feature wrap (§6.2); `# language:`; normalized
step keywords; `MSL-B062`; body tokens from the AST; `Entry.criteria` from the
AST.

Out of scope (later slices): `procedure` facet and step pairing (§7.3, §7.4;
`ProcedureStep` is not built), role diagnostics (§13 rows on outcome / `And`
first), `facetForType`, item-form criteria and MSL-B044 change, `.feature` files
(Case B), `Criterion.scenario` / `Criterion.range` shape change. The `Criterion`
shape stays as ADR-037 defined it.

## Global Constraints

- Invariant: a project without fenced `gherkin` / `feature` blocks gets
  byte-identical output from `compile`, `export json|yaml|csv`, `check`,
  `report`, `fmt`, and LSP semantic tokens. The parser module is not loaded.
- Library code under `core/` runs on Node.js: no `Deno.*` in `core/gherkin/`.
- `core/mod.ts` is the library boundary; other packages import from it.
- `FeatureNode.source` always holds the authored text, never the wrapped text.
- No `CORE_SCHEMA_VERSION` change; `feature` is optional (ADR-030 D2).
- Compile JSON does not gain `feature` in this slice: `bodyAst` is not in the
  compile output today; verify in Task 6 and keep it that way.
- Normalized step keyword: `given | when | then | and | but | step`, from
  `keywordType` (`Context`→given, `Action`→when, `Outcome`→then,
  `Conjunction`→`and` or `but` by the English-independent rule below,
  `Unknown`→step). `Conjunction` split: the parser does not separate And from
  But; use the dialect tables (`dialects[lang].and` / `.but`) to decide.
- Commits: Conventional Commits, plain English, trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A block with tags or comments before the first `Scenario:` and no `Feature:`
   line — the synthetic line must go after the `# language:` line only, and
   lines after it shift by 1. Test in Task 3.
2. A fence indented inside a list item in a source doc comment — the column must
   include the comment prefix through `LineMap`. Test in Task 4.
3. A doc string containing `Scenario: x` — no criterion, no token. Test in Task
   5 and Task 6.
4. A block in `# language: fr` with `Scénario:` — one criterion named by the
   French scenario; the English scanner gave none. Test in Task 6.
5. LSP edit loop: a document that first has no Gherkin and then gets a fence
   typed in — `parseFile` must load the parser on that parse. Test in Task 4.

## File map

| File                                                | Responsibility                                         |
| --------------------------------------------------- | ------------------------------------------------------ |
| `packages/markspec/deno.json`                       | two exact npm pins                                     |
| `packages/markspec/core/gherkin/types.ts` (new)     | `FeatureAst`, `ScenarioAst`, `ExamplesAst`, `StepAst`  |
| `packages/markspec/core/gherkin/load.ts` (new)      | `loadGherkin()`, `loadedGherkin()`                     |
| `packages/markspec/core/gherkin/parse.ts` (new)     | wrap, parse, normalize; `parseFeature(source)`         |
| `packages/markspec/core/ast/nodes.ts:129`           | `FeatureNode.feature?`                                 |
| `packages/markspec/core/ast/build.ts:483`           | fill `feature` when the parser is loaded               |
| `packages/markspec/core/parser/mod.ts:125`          | preload gate in `parseFile`                            |
| `packages/markspec/core/parser/body_tokens.ts:98`   | `emitGherkin` reads `feature`                          |
| `packages/markspec/core/criteria/scenarios.ts`      | `buildCriteria` reads `feature`, scanner fallback      |
| `packages/markspec/core/validator/feature_parse.ts` | `MSL-B062` (new)                                       |
| `packages/markspec/core/mod.ts`                     | export `loadGherkin`, AST types                        |
| docs                                                | language.md, core-data-model, ADR-016 note, guide, ADR |

---

### Task 1: Dependency and loader

**Files:**

- Modify: `packages/markspec/deno.json` (imports)
- Create: `packages/markspec/core/gherkin/load.ts`,
  `packages/markspec/core/gherkin/load_test.ts`

**Interfaces:**

- Produces: `loadGherkin(): Promise<GherkinApi>` (cached; a failed load is not
  cached), `loadedGherkin(): GherkinApi | undefined`, where
  `GherkinApi = { parse(text: string): GherkinDocument; dialects: Record<string, Dialect> }`.
  `parse` builds a new
  `Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher())`
  per call (the parser is stateful). It throws the library's composite error.

- [ ] **Step 1: Write the failing test** —
      `loadGherkin: parses French and
      reports keywordType`:
      `loadedGherkin()` is `undefined` before the call; after it, parsing
      `"# language: fr\nFonctionnalité: x\n  Scénario: y\n    Soit a\n    * b\n"`
      gives `feature.language === "fr"` and step keyword types
      `["Context", "Unknown"]`. Second test: two calls return the same object.
- [ ] **Step 2: Run** `deno test packages/markspec/core/gherkin/load_test.ts` —
      expected FAIL (module not found).
- [ ] **Step 3: Add imports**
      `"@cucumber/gherkin": "npm:@cucumber/gherkin@42.0.1"`,
      `"@cucumber/messages": "npm:@cucumber/messages@34.2.1"`; implement
      `load.ts` with `await import("@cucumber/gherkin")`.
- [ ] **Step 4: Run test** — PASS. Then `just compile` and check
      `dist/markspec --version` runs; record binary size before/after in the
      commit message (probe: +1.19 MB).
- [ ] **Step 5: Lazy-load guard test** in `tests/e2e/`: none needed; instead add
      `load_test.ts` case "core/mod.ts import does not load the parser": import
      `../mod.ts`, assert `loadedGherkin() === undefined`.
- [ ] **Step 6: Commit** `feat(core): add the lazy Gherkin parser loader`.

### Task 2: Normalized AST types and normalize step

**Files:**

- Create: `core/gherkin/types.ts`, `core/gherkin/parse.ts`,
  `core/gherkin/parse_test.ts`

**Interfaces:**

- Produces (types, subset of design §7 without `ProcedureStep`):

```ts
type StepKeyword = "given" | "when" | "then" | "and" | "but" | "step";
interface StepAst {
  readonly keyword: string; // as authored, trailing space removed
  readonly normalized: StepKeyword;
  readonly text: string;
  readonly docString?: { mediaType?: string; content: string };
  readonly dataTable?: readonly (readonly string[])[];
  readonly range: SourceRange; // relative to source: line 1 = first source line
}
interface ScenarioAst {
  name; keyword; tags; ruleName?; description; isOutline: boolean;
  background: readonly StepAst[]; // Feature then Rule background, in order
  steps: readonly StepAst[]; examples: readonly ExamplesAst[]; range;
}
interface ExamplesAst { name; keyword; tags; header; rows; range }
interface FeatureAst {
  name; keyword; synthetic: boolean; language: string; description;
  tags: readonly string[]; scenarios: readonly ScenarioAst[];
  sections: readonly { keyword: string; range: SourceRange }[]; // for tokens
}
type FeatureParse =
  | { ok: true; feature: FeatureAst }
  | { ok: false; line: number; column: number; message: string };
```

- `parseFeature(api: GherkinApi, source: string): FeatureParse` — pure.
  `ScenarioAst.name` is the parser name, trimmed, not locator-normalized
  (criteria normalize). `sections` lists every Feature/Background/Rule/
  Scenario/Examples keyword with its range, in document order, excluding the
  synthetic line.

- [ ] **Step 1: Failing tests** in `parse_test.ts`:
  - `wraps a block with no Feature line`: source
    `"@smoke\nScenario: Stop\n  Given a\n  When b\n  Then c\n"` →
    `synthetic: true`, `name: ""`, scenario `range.start.line === 2`, tag
    `"@smoke"`, normalized keywords `["given","when","then"]`.
  - `wraps after the language line`:
    `"# language: de\nSzenario: S\n  Angenommen a\n"` → `language: "de"`,
    scenario line 2, `normalized: "given"`.
  - `keeps a real Feature`: no wrap, `synthetic: false`, name kept.
  - `normalizes And, But, *`: `Given a / And b / But c / * d` →
    `["given","and","but","step"]`; same with French `Et` / `Mais`.
  - `outline, examples and rule`: `Rule: R` with `Background` and a
    `Scenario Outline` with two `Examples` → `ruleName: "R"`, `isOutline: true`,
    two `ExamplesAst` with header and rows unexpanded, background steps present.
  - `doc string and data table`: content and rows kept; a doc string holding
    `Scenario: fake` adds no scenario and no section.
  - `parse error`: `"Scenario: x\n  Given a\n  Feature: y\n"` → `ok: false`,
    `line` is the source line of the first error (1-based, after removing the
    synthetic offset).
- [ ] **Step 2: Run** `deno test packages/markspec/core/gherkin/` — FAIL.
- [ ] **Step 3: Implement** wrap per design §6.2 (first line not empty, not `#`,
      not `@`; compare against `dialects[lang].feature`), parse, subtract 1 from
      lines after the synthetic line, map `keywordType` per Global Constraints;
      `Conjunction` → `but` when the trimmed keyword is in `dialects[lang].but`,
      else `and`. On a thrown composite error read `errors[0].location` (fall
      back to line 1).
- [ ] **Step 4: Run** — PASS. `deno check packages/markspec/core/mod.ts`.
- [ ] **Step 5: Commit**
      `feat(core): normalize the Gherkin document into FeatureAst`.

### Task 3: `FeatureNode.feature` and the parse gate

**Files:**

- Modify: `core/ast/nodes.ts:129`, `core/ast/build.ts:483`,
  `core/parser/mod.ts:125`, `core/mod.ts`
- Test: `core/ast/build_test.ts`, `core/parser/mod_test.ts` (or the existing
  `parse_file` test file), `core/ast/equivalence_test.ts`

**Interfaces:**

- Consumes: `loadedGherkin()`, `parseFeature()`.
- Produces: `FeatureNode.feature?: FeatureAst` and
  `FeatureNode.parseError?: { line: number; column: number; message: string }`
  (source-relative, line 1 = first content line). Exactly one of them is set
  when the parser is loaded; neither when it is not. `core/mod.ts` exports
  `loadGherkin` and the `core/gherkin/types.ts` types.

- [ ] **Step 1: Failing tests:**
  - `parseFile fills FeatureNode.feature for a gherkin fence` (Markdown entry
    with one block) → `bodyAst[i].feature.scenarios.length === 1`.
  - `parseFile sets parseError for a broken block` → `feature` absent,
    `parseError.line === 3`.
  - `parseFile does not load the parser without a gherkin fence`: fresh process
    test via `Deno.Command` running a small script that calls `parseFile` on
    plain Markdown and prints `loadedGherkin() === undefined`.
  - `astEquivalent ignores the feature field ranges`: two builds of the same
    block at different body offsets compare equal (ADR-015).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the field; in `build.ts` call `loadedGherkin()` and
      `parseFeature` when a feature node is created; in `parseFile` await
      `loadGherkin()` when the content matches the gate regex (Decision 1A), for
      both the Markdown and the source branch.
- [ ] **Step 4: Run** `deno test packages/markspec/core/` — PASS; equivalence
      and fidelity-matrix tests unchanged.
- [ ] **Step 5: Commit** `feat(core): attach the Gherkin AST to feature blocks`.

### Task 4: File-relative positions (Markdown and source doc comments)

**Files:**

- Modify: `core/parser/translate.ts` (translate `FeatureAst` ranges through the
  `LineMap`), `core/parser/markdown.ts` (no change expected; verify)
- Test: `core/parser/translate_test.ts`, `tests/e2e/source_body_tokens_test.ts`,
  `packages/markspec/lsp/server` path via `lsp/workspace_test.ts`

**Interfaces:**

- Produces: helper
  `featureFileLine(entry: Entry, node: FeatureNode, sourceLine: number): number`
  in `core/gherkin/position.ts` =
  `(entry.bodyStartLine ?? entry.location.line + 1) + node.range.start.line + sourceLine - 1`,
  matching `buildCriteria` today. For source files the result goes through the
  entry's existing translation (bodyStartLine is already file-relative after
  `translateEntryLocations`); verify and pin with a test.

- [ ] **Step 1: Failing tests:**
  - Markdown: entry at line 10, block whose scenario is the second content line
    → `featureFileLine` returns the file line of `Scenario:`.
  - Rust doc comment (`///`) with a fenced `gherkin` block → the same helper
    gives the file line of `/// Scenario:`; column of a token includes the `///`
    prefix (Review Focus 2).
  - LSP: `WorkspaceIndex.parseAndUpdateFile` on text without a fence, then with
    a fence typed in → second result has `feature` set (Review Focus 5).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the helper; no translation of ranges stored inside
      `FeatureAst` (they stay source-relative, like `bodyAst`).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(core): map Gherkin positions to file lines`.

### Task 5: Body tokens from the AST (ADR-016)

**Files:**

- Modify: `core/parser/body_tokens.ts:57-140`
- Test: `core/parser/body_tokens_test.ts`,
  `tests/e2e/parse_body_tokens_test.ts`,
  `tests/e2e/lsp_semantic_tokens_test.ts`, their `__snapshots__`

**Interfaces:**

- Consumes: `FeatureNode.feature.sections`, `ScenarioAst.steps`, `background`,
  `ExamplesAst` keywords.
- Produces: unchanged `BodyToken` kinds. `gherkin-section.text` is the authored
  keyword (e.g. `Scénario`); `gherkin-step.text` is the authored keyword without
  trailing space (`*` included).

- [ ] **Step 1: Failing tests** (design §8.4):
  - `*` step gives a `gherkin-step` token with text `*`.
  - French block gives `Scénario` section and `Soit` step tokens.
  - `Then` inside step text, a description, or a doc string gives no token.
  - Broken block (`parseError`) gives no Gherkin tokens.
  - English block from the existing test at line 102 keeps the same `Feature`,
    `Scenario` tokens and positions.
- [ ] **Step 2: Run** — FAIL on the new cases.
- [ ] **Step 3: Implement** `emitGherkin` from the AST; delete
      `GHERKIN_SECTION_RE` / `GHERKIN_STEP_RE`. A node with neither `feature`
      nor `parseError` (parser not loaded, sync `parse()` path) emits no Gherkin
      tokens. Background steps are emitted once, at their own position (not per
      scenario).
- [ ] **Step 4: Run**
      `deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/parse_body_tokens_test.ts tests/e2e/lsp_semantic_tokens_test.ts packages/markspec/core/parser/`;
      update snapshots with `-- --update` only for the listed behaviour changes,
      and review the snapshot diff line by line.
- [ ] **Step 5: Commit** `feat(core): take Gherkin body tokens from the AST`.

### Task 6: `Entry.criteria` from the AST

**Files:**

- Modify: `core/criteria/scenarios.ts`
- Test: `core/criteria/scenarios_test.ts`, `tests/e2e/locator_coverage_test.ts`

**Interfaces:**

- Consumes: `FeatureNode.feature`, `featureFileLine`, `scanScenarioNames`
  (fallback, Decision 2A).
- Produces: `buildCriteria(entry): readonly Criterion[]` — same signature and
  shape as ADR-037.

- [ ] **Step 1: Failing / pinning tests:**
  - Parity: run every existing `scenarios_test.ts` and `locator_coverage_test`
    English fixture through both the scanner and the AST path; assert equal
    `Criterion[]` (names, `addressable`, `location`). Write this as a table test
    over the fixtures.
  - `# language: fr` block with `Scénario: Arrêt` → one criterion `Arrêt`
    (scanner gave zero).
  - `Scenario:` text inside a description or doc string → no criterion.
  - Broken block → criteria from the scanner fallback.
  - Scenario Outline and a scenario inside a `Rule` → one criterion each, the
    rule name is not part of the name.
- [ ] **Step 2: Run** — FAIL on the language and description cases.
- [ ] **Step 3: Implement**: per feature node, use `feature.scenarios` (`name` →
      `normalizeLocator`, line via `featureFileLine` on `range.start.line`,
      `column: 1`); else scanner fallback.
- [ ] **Step 4: Run** full `just test`; then the invariant check: run
      `markspec compile` and `markspec export json` on `docs/product` and on
      `tests/fixtures` before and after the branch (`git stash` is not allowed —
      build `main` binary in a second worktree) and `diff` the outputs —
      expected identical for fixtures with no Gherkin fence; for
      `docs/examples/entry-rendering.md` only token / criteria changes listed in
      this plan.
- [ ] **Step 5: Commit**
      `feat(core): build scenario criteria from the Gherkin AST`.

### Task 7: `MSL-B062` parse-error warning

**Files:**

- Create: `core/validator/feature_parse.ts`, `feature_parse_test.ts`
- Modify: `core/validator/pipeline.ts` (register), `core/mod.ts` if needed
- Test: `tests/e2e/validate_test.ts`

**Interfaces:**

- Produces: `checkFeatureParse(entries: readonly Entry[]): Diagnostic[]` — one
  `MSL-B062` warning per feature node with `parseError`, location
  `{ file, line: featureFileLine(entry, node, parseError.line), column: parseError.column }`,
  message `Gherkin block does not parse: <first line of the parser message>`.
  Runs for every entry type. Not in the LSP-only path: it goes through
  `validate`, so CLI and LSP both get it.

- [ ] **Step 1: Failing tests**: one broken block → one warning at the exact
      file line; two broken blocks → two; a valid block → none; e2e `check`
      exits 2 (warnings only) with `MSL-B062` on stderr.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** and register.
- [ ] **Step 4: Run** — PASS; `just check`.
- [ ] **Step 5: Commit** `feat(core): warn when a Gherkin block does not parse`.

### Task 8: Documentation

**Files:**

- Modify: `docs/spec/language/language.md` (feature block section: parsed with
  Gherkin, `# language:`, synthetic Feature; Part 8 table: `MSL-B062` next to
  wherever B-family rows are listed, adding a body (MSL-B) table if §8 has
  none), `docs/spec/internal/markspec-core-data-model.md` (§ next to the
  `MSL-B060`/`B061` rows: `MSL-B062`; `FeatureNode.feature`),
  `docs/guide/scenario-locators.md` (other spoken languages; broken-block
  fallback), `docs/architecture/adr-016-body-token-ast.md` (amendment paragraph:
  Gherkin tokens come from the AST),
  `docs/architecture/adr-037-scenario-locators.md` (the scanner is now the
  fallback only), `docs/guide/cli.md` if `check` lists codes,
  `packages/markspec/core/criteria/scenarios.ts` module comment.
- Test: `prim lint .`, `prim fmt --check .`

- [ ] **Step 1:** Check every sentence that the change makes false:
      `grep -rn "English keywords only\|minimal scanner\|not parsed\|verbatim" docs packages/markspec/core`.
- [ ] **Step 2:** Edit the files above; plain English.
- [ ] **Step 3:** `just fmt && just build` — PASS.
- [ ] **Step 4: Commit** `docs(docs): document the Gherkin AST and MSL-B062`.

## Dependency evidence (probe, 2026-11-13)

- `@cucumber/gherkin@42.0.1`: published 2026-08-05, unpacked 1,128,229 B, one
  dependency `@cucumber/messages >=34.0.0 <35`. `@cucumber/messages@34.2.1`:
  published 2026-08-05, unpacked 100,310 B, no dependencies. Plain JavaScript,
  no native code.
- Deno (`npm:` specifiers): parsing `# language: fr` gives `language: fr`,
  keywords `Soit |Context`, `* |Unknown`; a block without `Feature:` throws
  `Parser errors:` (confirms the need for the §6.2 wrap).
- `deno compile`: probe binary 69,415,010 B vs 68,226,146 B for an empty program
  (+1.19 MB); the compiled binary runs the parse.
- Node v26.4.0 with `npm i`: same API (`Parser`, `AstBuilder`,
  `GherkinClassicTokenMatcher`, `IdGenerator`) works; step keywordType `Unknown`
  for `*`.

## Alternatives considered

- **In-house parser** (extend the minimal scanner). Rejected: must follow the
  Gherkin grammar and 70+ dialects by hand (design §6.1).
- **Pickles** as the AST. Rejected: expand outlines and merge backgrounds, so
  one scenario has no single address (design §6.3).
- **Static import** (Decision 1B) and **async post-pass** (Decision 1C): see
  Open decisions.
- **Store ranges in file coordinates inside `FeatureAst`.** Rejected: breaks the
  rule that `feature` is a pure function of `source` apart from ranges, and the
  LSP would re-parse on every line shift; a helper converts on use.

## Self-review notes

- Spec coverage: §6.1 (T1), §6.2 (T2), §6.3/§7 subset (T2), §6.4 (T4), §8.1
  (T3), §8.4 (T5), §13 parse row (T7). §7.1-§7.4, §9, Case B deferred.
- Task count: 8.
