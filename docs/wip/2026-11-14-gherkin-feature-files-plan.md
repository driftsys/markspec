# Gherkin `.feature` Files (Case B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read entries from `.feature` files: a `Feature`, `Rule` or `Scenario`
with a `# [ID] Title` header comment becomes an entry, `.feature` files are
discovered by `check`, `lint`, `compile`, `fmt` and `lock`, and `fmt` stamps a
missing `# Id:` line.

**Architecture:** A new extractor `core/parser/feature_file.ts` parses the whole
file with the lazily loaded `@cucumber/gherkin` parser, finds header comment
blocks from `GherkinDocument.comments`, turns each header into a wrapped list
item that `parseMarkdown` reads with a `LineMap` (so the #914 trailer rule and
file-relative positions come for free), and appends a `FeatureNode` holding the
projected `FeatureAst` of the scenarios the entry owns. `parseFile` routes the
`.feature` extension to it. Discovery adds `.feature`. Case A validators
(criteria, MSL-B063..B068) work unchanged because they read `FeatureNode`s from
`bodyAst`.

**Tech Stack:** Deno / TypeScript, `@cucumber/gherkin@42.0.1`,
`@cucumber/messages@34.2.1` (already pinned, ADR-038).

**Spec:** `docs/wip/2026-11-13-gherkin-model-design.md` §5 (Case B), §6, §8,
§13; issue #915 (Summary Case B, Example Case B, Tooling, Decisions); #914
(trailer rule); ADR-038 and its amendments; ADR-037; ADR-027.

**Trace links:** Satisfies epic #915 slice "Case B: `.feature` extractor +
discovery". Supersedes the tag-based proposal of #584. Related: #914 (trailer
rule), #925 (source-file `Id:` stamping), ADR-038, ADR-037, ADR-027, ADR-016.

## Open decisions (recommended option first)

1. **Header-comment source.** (a, recommended) Use `GherkinDocument.comments`
   from the parser and group consecutive comment lines; the header is the group
   that ends on the line directly above the node (or above its first tag line).
   (b) Scan lines with a regex. Rejected: duplicates the parser and miscounts
   comments inside doc strings.
2. **How a header becomes an entry.** (a, recommended) Strip `#` plus one space,
   wrap with `wrapAsListItem`, parse with `parseMarkdown` and a
   `buildBlockLineMap` line map, as `parseSource` does. The #914 trailer rule,
   P-family diagnostics and body tokens apply unchanged. (b) A dedicated header
   parser. Rejected: a second trailer implementation.
3. **Position of the `FeatureNode`.** (a, recommended) `FeatureNode.source` is
   the authored text of the owning node's span (first tag or keyword line to its
   last line); `feature` ranges are rebased so line 1 is the first span line;
   `FeatureNode.range` is set so that `featureFileLine(entry, node, l)` returns
   the file line. Inherited Background steps keep rebased lines, which can be
   less than 1; no diagnostic is reported on them from the entry. (b) `source` =
   whole file. Rejected: every entry would carry the whole file text and the
   procedure of other entries.
4. **Entry source kind.** (a, recommended) Add
   `{ kind: "feature-file"; node: "feature" | "rule" | "scenario" }` to
   `EntrySource`. It is additive, appears only on entries from `.feature` files,
   and does not bump `CORE_SCHEMA_VERSION` (same policy as `Entry.criteria`).
   (b) Reuse `doc-comment` with a new language. Rejected: the language union is
   tree-sitter languages.
5. **Type default step 6a.** (a, recommended) Implement now in
   `core/validator/type_resolution.ts` after step 6:
   `source.kind ===
   "feature-file"` → `feature`/`rule` → `Requirement`,
   `scenario` → `Test`. (b) Defer. Rejected: a headed scenario with an
   unrecognised prefix would stay untyped and lose its role.
6. **`fmt` for `.feature` files.** (a, recommended) Build it in this slice:
   `fmt` stamps a missing `Id:` in a `.feature` header (design §5.5) and changes
   nothing else; MSL-F010 for `.feature` covers only the missing `Id:`. This is
   a separate code path from #925 (tree-sitter doc comments), which stays open.
   (b) Wait for #925. Rejected: a `.feature` entry with no `Id:` cannot become
   valid, because hand-written ULIDs are forbidden.
7. **#584.** (a, recommended) Close #584 as superseded by #915 Case B when this
   slice merges. No code exists for the tag approach (`grep -rn "\.feature"`
   finds none in `core` or `cli`), so nothing is removed. Tags stay in the AST
   only (#915 Decision "Tags are not labels").
8. **Header on a non-entry node** (`Background`, `Examples`, step). (a,
   recommended) New `MSL-B069`, warning, body family, at the header line: "a
   `# [ID]` header stands above a <kind>, which cannot be an entry". (b) Silent.
   Rejected: design §5.2 requires a warning.
9. **Parse error in a `.feature` file.** (a, recommended) No entries from the
   file, one `MSL-B062` warning at the parser's file line and column, the file
   reported as parse-error-only. (b) Fall back to a line scanner. Rejected: Case
   B has no fenced block to fall back on, and a partial entry set is wrong.
10. **Parser load failure.** (a, recommended) `parseFile` returns no entries and
    one `MSL-B062` warning "Gherkin parser unavailable" for the file. (b) Throw.
    Rejected: ADR-038 Decision 4 says a failed load is not fatal.

## Global Constraints

- Lazy loading: the Gherkin parser is loaded only for a file with a
  gherkin/feature fence or a `.feature` extension (`AGENTS.md`, ADR-038).
- Projects with no `.feature` file produce byte-identical `compile`, `export`,
  `check --format json`, `fmt` and `markspec.lock` output.
- `core/mod.ts` is the library boundary; Node-compatible library code, no
  `Deno.*` in `core/`.
- `fmt` on a `.feature` file is lossless: only inserted `#` / `# Id:` lines
  differ (design §5.5).
- Tags are never mapped to `Labels`. Nesting creates no relation (no `Part-of`).
- No LSP features beyond what already works generically; no VS Code language
  registration (later slices). LSP `isMarkspecFile` must stay false for
  `.feature` in this slice.
- Commit scope ∈ {core, cli, docs}; plain English; one commit per task.

## Review Focus

1. A scenario with no header under a headed `Rule` under a headed `Feature`: it
   belongs to the `Rule` only (§5.4 rule 4). Tested in Task 3.
2. A header separated from its node by a blank line is not a header (§5.1 rule
   4); a header followed only by tag lines is. Tested in Task 2.
3. CRLF `.feature` files: positions and `fmt` output keep line endings. Tested
   in Tasks 2 and 6.
4. A `# language: fr` file: keywords in French still give Feature/Rule/Scenario
   nodes. Tested in Task 3.
5. A `.feature` file with no headers: zero entries, no diagnostics, and `fmt`
   leaves it byte-identical. Tested in Tasks 3 and 6.

## File structure

- Create `packages/markspec/core/parser/feature_file.ts` — the extractor:
  `parseFeatureFile(text, { file, api })`.
- Create `packages/markspec/core/gherkin/project.ts` —
  `projectFeature(ast,
  scenarios, span)`: the rebased sub-AST for one entry.
- Modify `packages/markspec/core/parser/mod.ts` — route `.feature`.
- Modify `packages/markspec/core/model/mod.ts` — `EntrySource` kind.
- Modify `packages/markspec/core/validator/type_resolution.ts` — step 6a.
- Modify `packages/markspec/core/discovery/mod.ts` — `FEATURE_EXTENSIONS`.
- Create `packages/markspec/core/formatter/feature_file.ts` — `Id:` stamping.
- Modify `packages/markspec/core/formatter/mod.ts`, `cli/commands/fmt.ts`.
- Tests colocated plus `tests/e2e/feature_file_test.ts`.

---

### Task 1: Header comment blocks

**Files:**

- Create: `packages/markspec/core/parser/feature_file.ts`
- Test: `packages/markspec/core/parser/feature_file_test.ts`

**Interfaces:**

- Produces:
  `export interface FeatureHeader { readonly startLine: number; readonly endLine:
  number; readonly column: number; readonly lines: readonly string[]; readonly
  prefixWidths: readonly number[] }`
  (1-based file lines; `lines` with `#` and one following space removed) and
  `export function findHeaders(document: GherkinDocument, text: string):
  Map<number, FeatureHeader>`
  keyed by the file line of the node keyword it heads.

- [ ] **Step 1: Write failing tests** in `feature_file_test.ts` (load the real
      parser with `await loadGherkin()`):
  - `findHeaders: header directly above a Scenario` — key = scenario line,
    `lines[0] === "[SRS_BRK_0011] Stop before a stationary obstacle"`.
  - `findHeaders: tag lines between header and node are allowed`.
  - `findHeaders: a blank line between header and node drops the header`.
  - `findHeaders: a comment group not starting with "# [" is not a header`.
  - `findHeaders: "# language:" is never part of a header`.
  - `findHeaders: empty comment line "#" maps to an empty string`.
- [ ] **Step 2: Run**
      `deno test -A packages/markspec/core/parser/feature_file_test.ts` — expect
      FAIL (module missing).
- [ ] **Step 3: Implement** `findHeaders`: group `document.comments` into runs
      of consecutive lines; a run is a header when its first stripped line
      matches `^\[[^\]]+\]\s` and the next non-tag line after the run is a node
      keyword line of a Feature, Rule, Scenario, Background or Examples (collect
      node lines from the raw document, including Rule children).
- [ ] **Step 4: Run** the tests — expect PASS.
- [ ] **Step 5: Commit**
      `feat(core): find # [ID] header comments in .feature files`.

### Task 2: Header to entry (trailer rule, positions)

**Files:** Modify `core/parser/feature_file.ts`; test the same file.

**Interfaces:**

- Consumes: `findHeaders`, `wrapAsListItem` (`core/parser/source.ts`),
  `buildBlockLineMap` (`core/parser/line_map.ts`), `parseMarkdown`.
- Produces:
  `function headerEntry(header: FeatureHeader, file: string):
  { entry?: Entry; diagnostics: Diagnostic[] }`.

- [ ] **Step 1: Write failing tests:**
  - `headerEntry: git-style trailer becomes rawAttributes` — header
    `[SRS_BRK_0011] Stop`, `""`, `Id: 01J…` (use a ULID produced by `@std/ulid`
    in the test), `Satisfies: SYS_BRK_0003` → `rawAttributes` keys
    `["Id","Satisfies"]`, no diagnostics (no MSL-P023 for `.feature`).
  - `headerEntry: a final paragraph with "Note: x" stays body` (#914 rule).
  - `headerEntry: location is the header line and column of "#"` — header at
    file line 7, column 3 → `location {line: 7, column: 3}`.
  - `headerEntry: body prose lines are file-relative in bodyTokens`.
  - `headerEntry: CRLF input gives the same locations`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: wrap, parse with the line map; set
      `source: { kind: "feature-file", node }` later in Task 3. Suppress the
      Markdown-only trailer warning (MSL-P023) for `.feature` the same way
      source files do (check how `parseSource` avoids it and reuse that option).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(core): read .feature header comments as entries`.

### Task 3: Ownership, projected FeatureNode, `parseFeatureFile`

**Files:**

- Create: `packages/markspec/core/gherkin/project.ts` (+ `project_test.ts`)
- Modify: `core/parser/feature_file.ts`, `core/model/mod.ts` (`EntrySource`)

**Interfaces:**

- Produces:
  `export function projectFeature(ast: FeatureAst, scenarioIndexes: readonly
  number[], span: { startLine: number; endLine: number }): FeatureAst`
  (ranges and comment lines rebased to `span.startLine`; `scenarios` filtered;
  `sections` and `comments` limited to the span).
  `export function parseFeatureFile(text: string, options: { file: string; api:
  GherkinApi }): { entries: Entry[]; diagnostics: Diagnostic[] }`.
  `EntrySource` gains
  `{ readonly kind: "feature-file"; readonly node:
  "feature" | "rule" | "scenario" }`.

- [ ] **Step 1: Write failing tests** (`feature_file_test.ts`) using the design
      §5.6 worked example as a fixture string:
  - `parseFeatureFile: §5.6 gives REQ_BRK_0011 and TST_BRK_0013` — locations
    lines 2 and 22.
  - `parseFeatureFile: unheaded scenarios belong to the headed Feature` —
    `buildCriteria(entry)` of REQ_BRK_0011 has names
    `["Brake at 20 m","No braking beyond 40 m"]` with file lines 13 and 17.
  - `parseFeatureFile: a headed scenario is not owned by its Feature`.
  - `parseFeatureFile: headed Rule owns its scenarios, not the Feature`.
  - `parseFeatureFile: unheaded scenario with no headed ancestor is dropped`.
  - `parseFeatureFile: Background steps are preconditions` — `scenarioProcedure`
    of TST_BRK_0013 has background step text `"the vehicle speed is 60 km/h"`.
  - `parseFeatureFile: Gherkin description joins the body after header prose`.
  - `parseFeatureFile: tags are not labels` — `@wip` scenario → no `Labels`.
  - `parseFeatureFile: # language: fr` fixture → entry with node `scenario`.
  - `parseFeatureFile: no headers → no entries, no diagnostics`.
  - `parseFeatureFile: header above Background → MSL-B069 warning at header line`.
  - `parseFeatureFile: syntax error → no entries, MSL-B062 at the parser line`.
  - `projectFeature: rebases ranges and filters scenarios` (unit test).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: parse with `api.parse(text)` and `parseFeature`
      (`core/gherkin/parse.ts`) for the normalized AST; walk the raw document
      tree to assign each scenario to its nearest headed ancestor (§5.4); for
      each headed node build the entry (Task 2), append prose from the node
      description, append a `FeatureNode` (`kind: "feature"`, `source` = span
      text, `feature` = `projectFeature(...)`, `range` per Open decision 3).
      Register `MSL-B069` in the diagnostic catalogue where MSL-B068 lives.
- [ ] **Step 4: Run** the new tests plus
      `deno test -A packages/markspec/core/gherkin packages/markspec/core/validator`
      — PASS.
- [ ] **Step 5: Commit** `feat(core): build Case B entries from .feature files`.

### Task 4: `parseFile` routing, lazy load, type step 6a

**Files:** Modify `core/parser/mod.ts`, `core/validator/type_resolution.ts`,
`core/mod.ts` (export `parseFeatureFile` only if a non-core caller needs it —
none in this slice, so do not export). Tests: `core/parser/mod_test.ts`,
`core/gherkin/lazy_test.ts`, `core/validator/type_resolution_test.ts`.

- [ ] **Step 1: Write failing tests:**
  - `parseFile: .feature loads the parser even with no fence` — inject
    `gherkinLoader` spy; called once.
  - `parseFile: .md without fences never calls the loader` (existing lazy test,
    extend with a `.feature` sibling in the same run to prove the Markdown file
    still does not trigger a load).
  - `parseFile: loader failure on .feature → no entries, one MSL-B062`.
  - `type resolution step 6a: headed Scenario with prefix unknown to profile
    → Test; Feature → Requirement; Verifies on a Feature → Test (step 6 wins);
    REQ_ prefix on a Scenario → Requirement (step 4 wins)`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: in `parseFile`, before the tree-sitter branch,
      `if (ext === ".feature")` await the loader, then
      `parseFeatureFile(normalised, { file, api: loadedGherkin()! })`. Add step
      6a after step 6 in `type_resolution.ts`.
- [ ] **Step 4: Run** `deno test -A packages/markspec/core` — PASS.
- [ ] **Step 5: Commit**
      `feat(core): parse .feature files and default their types`.

### Task 5: Discovery, check, compile, lock parity

**Files:** Modify `core/discovery/mod.ts`; tests `core/discovery/mod_test.ts`,
create `tests/e2e/feature_file_test.ts`.

**Interfaces:** Produces
`export const FEATURE_EXTENSIONS: ReadonlySet<string>
= new Set([".feature"])`,
included in `RELEVANT_EXTENSIONS`. `SOURCE_EXTENSIONS` is unchanged (it drives
tree-sitter and the LSP).

- [ ] **Step 1: Write failing tests:**
  - unit `discoverFiles: finds .feature, honours .gitignore and exclude:`.
  - e2e `check: bare run finds a .feature entry` (project with `.markspec.yaml`
    and §5.6 fixture plus a Markdown file defining `STK_BRK_0001`) → exit 0,
    stderr scope announcement counts the file.
  - e2e `check: explicit .feature path` and `check: directory argument`.
  - e2e `check: MSL-B063 on a headed Test scenario with an action and no Then`
    at the file line of the last action.
  - e2e
    `check: Verifies locator to an unheaded scenario resolves (no
    MSL-L007)`.
  - e2e `compile: entries from .feature carry source.kind "feature-file"`.
  - e2e `compile: a project without .feature files is byte-identical` — compare
    against a snapshot taken from `origin/main` output of the `tests/fixtures`
    project (commit the snapshot in this step).
  - e2e
    `lock then check: adding a .feature entry changes the edges hash
    (MSL-L212) until relocked; a project without .feature keeps its lock`.
  - e2e `lint: runs on .feature entries without crash`.
- [ ] **Step 2: Run** `deno test -A tests/e2e/feature_file_test.ts` — FAIL.
- [ ] **Step 3: Implement** the extension set; confirm
      `core/lock/acquire_compile.ts` and `core/collect` use
      `RELEVANT_EXTENSIONS` (fix any hard-coded list found).
- [ ] **Step 4: Run** the e2e file and
      `deno test -A packages/markspec/core/discovery packages/markspec/core/lock`
      — PASS.
- [ ] **Step 5: Commit**
      `feat(core): discover .feature files in every project command`.

### Task 6: `fmt` stamps `# Id:` in `.feature` headers

**Files:** Create `core/formatter/feature_file.ts` (+ test); modify
`core/formatter/mod.ts` (dispatch on `.feature` before the Markdown path),
`cli/commands/fmt.ts` only if it filters by extension; e2e in
`tests/e2e/feature_file_test.ts`.

**Interfaces:** Produces
`export function formatFeatureFile(text: string,
entries: readonly Entry[], generateUlid: () => string): { output: string;
changed: boolean }`.

- [ ] **Step 1: Write failing tests:**
  - `formatFeatureFile: inserts "# Id: <ULID>" as first trailer line`.
  - `formatFeatureFile: no trailer → appends "#" and "# Id: <ULID>" at the end
    of the header, with the header line's indentation`.
  - `formatFeatureFile: entry with Id unchanged; file byte-identical`.
  - `formatFeatureFile: file with no headers byte-identical`.
  - `formatFeatureFile: CRLF preserved`.
  - `formatFeatureFile: Gherkin steps and tables untouched` (diff only inserted
    lines).
  - e2e `fmt then check: no MSL-F010`;
    `check before fmt reports MSL-F010 only
    for the missing Id`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; the generic entry formatter and the ADR-029 prose
      pass must never run on `.feature` text.
- [ ] **Step 4: Run**
      `deno test -A packages/markspec/core/formatter tests/e2e/feature_file_test.ts`
      — PASS.
- [ ] **Step 5: Commit**
      `feat(core): stamp a missing Id in .feature header trailers`.

### Task 7: Documentation

**Files:** `docs/spec/language/language.md` (Case B entries, MSL-B069),
`docs/guide/cli.md` (`.feature` in discovery and `fmt`), `docs/guide/` Gherkin
recipe if present, `docs/architecture/adr-038-gherkin-ast.md` (amendment "Case B
.feature entries" with Options considered from this plan's decisions),
`AGENTS.md` (layout line for `core/parser/feature_file.ts`; discovery text),
`docs/architecture/overview.md` if it lists file kinds.

- [ ] **Step 1:** Write the changes; check every statement against the code of
      Tasks 1–6.
- [ ] **Step 2: Run** `just fmt && prim lint . && markspec check` on the repo —
      clean.
- [ ] **Step 3: Commit** `docs(docs): document .feature entries`.
- [ ] **Step 4:** Run `just build` (timeout 600000) — all green.

## Alternatives considered

- **Tags carry ID and type (#584).** Rejected by #915: tags such as `@wip` fail
  label validation, and a tag cannot hold a title, body or trailer.
- **Every scenario is an entry.** Rejected: entries need stable IDs; unheaded
  scenarios are criteria or procedures of the nearest headed node (§5.4).
- **Generate `Part-of` from nesting.** Rejected: `Part-of` is declared only on
  Component and Unit (§5.4 rule 6).
- **Treat `.feature` as a tree-sitter source language.** Rejected: there is no
  pinned grammar, and the Cucumber parser already gives the AST we need.
- **Reformat Gherkin in `fmt`.** Rejected: design §5.5 limits `fmt` to `Id:`.

## Out of scope

LSP features for `.feature` (diagnostics, hover, rename, completions, symbols),
VS Code language registration and grammar, #925 (doc-comment `Id:` stamping),
`# Step N` behaviour beyond what Case A already provides.
