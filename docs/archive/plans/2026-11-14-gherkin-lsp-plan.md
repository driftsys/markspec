# Gherkin Case B: LSP support for `.feature` files — implementation plan

> For agentic workers: execute with `superpowers:subagent-driven-development`
> (one implementer and one task reviewer per task, per the per-task review
> gate). Steps use checkbox syntax for tracking.

**Goal:** The LSP server indexes `.feature` files that carry MarkSpec header
comments (ADR-038 Case B), publishes their diagnostics, and offers the editor
features of other source files on `# [ID]` headers. A `.feature` file with no
header gives no entries, no diagnostics, no symbols, no edits.

**Tracks:** epic #915, slice "Case B: LSP support for `.feature` files". Design:
`docs/wip/2026-11-13-gherkin-model-design.md` §5, §8.2, §10.3.

**Architecture:** `.feature` becomes a MarkSpec file for the LSP
(`isMarkspecFile`), but stays out of `isSourceFile` handling where that means
"doc-comment source". A new predicate `isFeatureFile` selects the Case B paths.
`WorkspaceIndex.parseAndUpdateFile` already calls core `parseFile`, which routes
`.feature` to `parseFeatureFile` and loads the Gherkin parser lazily. Formatting
calls core `formatFeatureText`. Display-ID handlers (hover, definition,
references, highlights, rename) work on raw lines, so they need only the fence
guard and the context guard adjusted for `.feature`.

**Out of scope:** VS Code `documentSelector` registration for the `feature`
language (`editors/vscode/src/extension.ts:135`) — next slice. Rename of a
scenario name that rewrites locators (design §10.3) — see decision D3.

**Tech stack:** Deno/TypeScript, `vscode-languageserver`, `@cucumber/gherkin`
(lazy, via core).

---

## Task 1: `.feature` is a MarkSpec file for the LSP

**Files:**

- Modify: `packages/markspec/lsp/context.ts` (`isMarkspecFile`, new
  `isFeatureFile`, `fencedLinesForFile`)
- Test: `packages/markspec/lsp/context_test.ts`

- [ ] Failing tests: `isMarkspecFile("a/b.feature")` is `true`;
      `isFeatureFile("a/b.FEATURE")` is `true`; `isSourceFile("a/b.feature")` is
      `false`; `fencedLinesForFile(text, "x.feature")` returns an empty set for
      a feature file that contains a `"""` doc string (Gherkin doc strings are
      not Markdown fences, and IDs inside them are not references — see decision
      D5 for the alternative).
- [ ] Implement using core `FEATURE_EXTENSIONS`.
- [ ] Verify: `deno test packages/markspec/lsp/context_test.ts`, then
      `just check`.

## Task 2: Index `.feature` files in the project walk

**Files:**

- Modify: `packages/markspec/lsp/project_context.ts` (`LSP_EXTENSIONS` adds
  `FEATURE_EXTENSIONS`; remove the "LSP does not handle `.feature`" comment)
- Test: `packages/markspec/lsp/project_context_test.ts`

- [ ] Failing test: an in-memory host with `docs/a.md` and `tests/login.feature`
      (one `# [TST_0001] Login` header above a `Scenario`) — after
      `indexProject`, `index.getEntryByDisplayId("TST_0001")` is defined and its
      `location.file` is the `.feature` path. Second test: a headerless
      `plain.feature` is indexed with zero entries and `publishAllDiagnostics`
      sends no non-empty diagnostics for it.
- [ ] Implement.
- [ ] Verify: `just check`.

## Task 3: Document sync and diagnostics for `.feature` buffers

**Files:**

- Modify: `packages/markspec/lsp/server.ts` (no code change expected beyond Task
  1, since sync handlers gate on `isMarkspecFile`; confirm the
  `isDocCommentContext` guards are skipped for `.feature` because `isSourceFile`
  is false)
- Test: `tests/e2e/lsp_feature_test.ts` (new; drives `markspec lsp` over stdio
  like existing LSP e2e tests)

- [ ] Failing e2e test: `didOpen` of a header `.feature` with a header above a
      `Background` publishes `MSL-B069`; a header file that does not parse
      publishes `MSL-B062`; a headerless file that does not parse publishes an
      empty list.
- [ ] Failing e2e test: cross-file `Satisfies:` in a `.feature` trailer to a
      Markdown entry resolves (no `MSL-L006`), and a broken one reports it at
      the trailer line of the `.feature` file.
- [ ] Implement any gap found (expected: none, or a position fix-up).
- [ ] Verify: `just check`.

## Task 4: Navigation on `# [ID]` headers — symbols, folding, hover, definition, references, highlights

**Files:**

- Modify: `packages/markspec/lsp/folding.ts` (use header-to-node ranges for
  `.feature`: fold from the header line to the end of the owned Gherkin node,
  not "to the next entry")
- Modify: `packages/markspec/lsp/highlights.ts` (declaration heuristic: an ID
  preceded by `[` on a `#` comment line is `Write` — already true; add test)
- Test: `folding_test.ts`, `symbols_test.ts`, `highlights_test.ts`,
  `tests/e2e/lsp_feature_test.ts`

- [ ] Failing tests: document symbols for a file with a Feature header and a
      nested Scenario header list both IDs; definition from a Markdown
      `Verified-by: TST_0001` lands on the `#` of the `.feature` header line;
      references to a Markdown requirement include a `.feature` entry whose
      trailer names it; folding of a Feature entry does not stop at the nested
      Scenario header (see D4).
- [ ] Implement.
- [ ] Verify: `just check`.

## Task 5: Rename of display IDs across `.feature` files

**Files:**

- Modify: `packages/markspec/lsp/rename.ts` only if the fence/locator guards
  misfire on `#` comment lines
- Test: `rename_test.ts`, `tests/e2e/lsp_feature_test.ts`

- [ ] Failing tests: renaming `REQ_0001` from Markdown rewrites
      `# Satisfies: REQ_0001` in a `.feature` header and the `# [REQ_0001]`
      header itself; an ID inside a step line or a doc string is not rewritten
      (D5); an ID inside a scenario locator `Verified-by: TST_0001[Login]` keeps
      the locator text intact while the ID is rewritten.
- [ ] Implement. This closes the ADR-038 §11 gap ("a rename in the editor does
      not update `.feature` files").
- [ ] Verify: `just check`.

## Task 6: Formatting — Id stamping only

**Files:**

- Modify: `packages/markspec/lsp/server.ts` (`onDocumentFormatting`: for
  `isFeatureFile`, call `formatFeatureText(text, filePath)` and return
  `buildFormattingEdits`; never load the Markdown prose formatter)
- Test: `tests/e2e/lsp_feature_test.ts`, `formatting_test.ts`

- [ ] Failing tests: a header without `Id:` gets one stamped Id line in the
      trailer position defined by `formatFeatureFile`; a headerless file returns
      `[]`; a file that does not parse returns `[]`; a fully stamped file
      returns `[]` (idempotent).
- [ ] Implement.
- [ ] Verify: `just check`.

## Task 7: Headerless parity guarantee

**Files:**

- Test: `tests/e2e/lsp_feature_test.ts`, `project_context_test.ts`

- [ ] Tests (should pass after tasks 1–6; written to pin the guarantee): for a
      plain Cucumber file — no entries, empty diagnostics, empty document
      symbols, empty folding ranges, empty semantic tokens, empty inlay hints
      and code lenses, `[]` from formatting, `null` from hover on a step word,
      and the Gherkin parser is not loaded when no `.feature` file has a header
      line (check via `hasFeatureHeaderLine` short-circuit, if core exposes it;
      otherwise assert on behaviour only).
- [ ] Fix any leak.
- [ ] Verify: `just check`.

## Task 8: Documentation

**Files:**

- Modify: `docs/guide/feature-files.md` (editor support section),
  `docs/guide/editor-vscode.md` (note that VS Code registration comes in the
  next slice, if the guide would otherwise be false),
  `docs/architecture/adr-038-gherkin-ast.md` (amend item 11 "Tools": the LSP
  indexes `.feature` files; rename now updates them; scenario-name rename status
  per D3), `AGENTS.md` (LSP module notes: `context.ts` now covers `.feature`;
  `formatting` handles `.feature` Id stamping)
- [ ] Each changed sentence checked against the code by the task reviewer.
- [ ] `just fmt`, `just build`.

---

## Open decisions (recommendation in bold)

- **D1 — Is `.feature` a "source file" in the LSP?** Options: reuse
  `isSourceFile` (gets `isDocCommentContext` 20-line radius guard) or add a
  separate `isFeatureFile`. **Recommend separate predicate**: the radius guard
  is a heuristic for code; in `.feature` the header grammar is exact, and the
  guard would hide hover on a `Verified-by` value far from a marker.
- **D2 — Semantic tokens and inlay hints for `.feature`.** **Recommend: emit
  them only for header lines (entries exist) and nothing else**; the token
  builder works from entries, so this costs no new code. No Gherkin keyword
  highlighting — the editor grammar does that.
- **D3 — Scenario-name rename that rewrites locators (design §10.3).**
  **Recommend: defer to its own slice.** It needs the scenario AST position
  under the cursor, scope resolution by owning entry, and locator escaping;
  bundling it here doubles the slice. Record in ADR-038 amendment as pending.
- **D4 — Folding range of a Case B entry.** Options: keep the generic "to the
  next entry" heuristic, or fold from header to the end of the owned node.
  **Recommend owned-node range** when the parser exposes the node end line (it
  does for `source`); otherwise fall back to the generic heuristic.
- **D5 — Are IDs inside steps, doc strings or data tables references?**
  **Recommend no**: only header comment lines are MarkSpec; rename, highlights
  and references operate on header lines only for `.feature` files (restrict
  `walkProseLines` via a fenced-lines set that marks every non-header line).
  This is stricter than a Markdown fence model and matches the Case B rule that
  MarkSpec adds only comments.
- **D6 — Code actions on `.feature` diagnostics.** Existing quick fixes assume
  indented trailers (`^\s{4,}Key:`). **Recommend no code actions for `.feature`
  in this slice**; return `[]` and file a follow-up.
- **D7 — Gherkin parser load cost in the LSP.** **Recommend accept the lazy load
  on first headed `.feature` parse** (design §6.1); add no cache now, since the
  design allows a per-text cache later if profiling shows need.
