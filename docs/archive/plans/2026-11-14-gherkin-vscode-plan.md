# Gherkin Case B: VS Code language registration and syntax highlighting — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Each task gets its own review before
> the next task starts (per-task review gate).

**Goal:** VS Code sends `.feature` buffers to the MarkSpec language server, and
`.feature` files show Gherkin syntax highlighting with MarkSpec header
highlighting (`# [ID] Title`, `# Key: value` trailers), without taking the
`.feature` file away from an installed Cucumber extension.

**Architecture:** The LSP side already handles `.feature` (PR #940, ADR-038
amendment "LSP support for `.feature` files"). This slice changes only
`editors/vscode/`: the client document selector and file watcher, a contributed
`feature` language with a TextMate grammar and a language configuration, and an
injection grammar that adds MarkSpec header scopes to the grammars of common
Cucumber extensions. Pure data (selector list, grammar patterns) lives in small
modules or JSON files so `node:test` can check it without a VS Code host.

**Tech stack:** TypeScript, `vscode-languageclient` 9, TextMate grammars (JSON),
`node:test` (the extension's existing `npm test`).

**Reference:** epic design `docs/wip/2026-11-13-gherkin-model-design.md`;
`docs/architecture/adr-038-gherkin-ast.md`; `docs/guide/editor-vscode.md` §
".feature files"; `docs/guide/feature-files.md` § "Known limitations".

## Current state (base `origin/main` 5a762433)

- `editors/vscode/src/extension.ts` ~line 135: `documentSelector` lists
  `markdown` and 10 source language ids by `language` only; the
  `synchronize.fileEvents` watcher is `**/*.md`.
- `package.json` `contributes` has no `languages` or `grammars` entry. VS Code
  has no built-in `feature` language. Cucumber extensions register their own
  ids: the official Cucumber extension (`CucumberOpen.cucumber-official`) uses
  the id `cucumber`; "Cucumber (Gherkin) Full Support"
  (`alexkrechik.cucumberautocomplete`) uses `feature`. Verified in Task 4
  (2026-11-14): alexkrechik's grammar scope is `text.gherkin.feature` and its
  `#` lines get `comment.line.number-sign`
  ([package.json at 7722cc9](https://github.com/alexkrechik/VSCucumberAutoComplete/blob/7722cc935f42416453aa403cfee9eacd9b960dc5/package.json));
  the official extension contributes no TextMate grammar and colors through
  semantic tokens
  ([package.json at 5c48d7e](https://github.com/cucumber/vscode/blob/5c48d7e54382621fc1570a4e3db4f4098f8ee3c6/package.json)),
  so the injection targets only `text.gherkin.feature`.
- Tests: `npm --prefix editors/vscode test` runs `tsc` then `node --test` on an
  explicit list of `out/*.test.js` files (new test files must be added to that
  list). CI: `.github/workflows/vsix-verify.yaml` runs `npm ci`,
  `npm run compile`, `npm test` on any `editors/vscode/**` change.
- `.vscodeignore` does not exclude new top-level folders, so a `syntaxes/`
  folder and `language-configuration.json` ship in the VSIX.
- The extension has no CHANGELOG; release notes come from the root
  `CHANGELOG.md` at release time (no per-PR entries). `README.md` is the
  marketplace overview.

## Tasks

### Task 1: Send `.feature` buffers to the server

**Files:** create `editors/vscode/src/documentSelector.ts`,
`editors/vscode/src/documentSelector.test.ts`; modify
`editors/vscode/src/extension.ts`, `editors/vscode/package.json` (`test` script
list).

- [ ] Failing test: `documentSelector.test.ts` asserts that
      `MARKSPEC_DOCUMENT_SELECTOR` contains
      `{ scheme: "file", pattern:
      "**/*.feature" }` and still contains
      every existing language entry, and that `WATCHED_FILE_GLOB` is
      `**/*.{md,feature}`. Add `out/documentSelector.test.js` to the `test`
      script. Run `npm --prefix editors/vscode test` → fails (module missing).
- [ ] Implement: move the selector array out of `extension.ts` into
      `documentSelector.ts`, add the `pattern` entry (matches the file whatever
      language id another extension assigns), export the watcher glob, use both
      in `extension.ts`. No `language` filter on the `.feature` entry.
- [ ] Verify: `npm --prefix editors/vscode test`,
      `npm --prefix editors/vscode run compile`,
      `npm --prefix editors/vscode run lint`.
- [ ] Commit.

### Task 2: Contribute the `feature` language and language configuration

**Files:** create `editors/vscode/language-configuration.json`; modify
`editors/vscode/package.json` (`contributes.languages`); create
`editors/vscode/src/contributes.test.ts`.

- [ ] Failing test: `contributes.test.ts` reads `package.json` and asserts a
      `languages` entry with `id: "feature"`, `extensions: [".feature"]`,
      `aliases` including `Gherkin`, and
      `configuration:
      "./language-configuration.json"`; reads the
      configuration and asserts `comments.lineComment === "#"`, and that `"` and
      `"""`-style docstrings are not auto-closed wrongly
      (brackets/autoClosingPairs for `"`, `<`/`>` for outline parameters). Add
      to the `test` list. Run → fails.
- [ ] Implement the contribution and the configuration (line comment `#`,
      autoClosingPairs `"`, `'`, `<`/`>`, `(`; folding by indentation markers
      off — VS Code indentation folding is enough).
- [ ] Verify: same three commands as Task 1.
- [ ] Commit.

### Task 3: Gherkin TextMate grammar with MarkSpec header scopes

**Files:** create `editors/vscode/syntaxes/feature.tmLanguage.json`
(`scopeName: source.feature.markspec` — decision D3), modify `package.json`
(`contributes.grammars`), create `editors/vscode/src/grammar.test.ts`.

- [ ] Failing test: `grammar.test.ts` loads the grammar JSON and, for each named
      pattern, runs its `match`/`begin` regex (converted from Oniguruma only
      where syntax differs; keep the patterns within the shared subset) against
      sample lines: `# [SWT_LIGHT_0001] Light turns on` → display ID captured as
      `entity.name.tag.markspec.display-id`, title as `markup.heading.markspec`;
      `#     Satisfies: SWE_0001` → key `keyword.other.markspec.trailer-key`,
      value `string.unquoted.markspec.trailer-value`; `# plain comment` → only
      `comment.line.number-sign`; `Feature:`, `Rule:`, `Background:`,
      `Scenario:`, `Scenario Outline:`, `Examples:`,
      `Given`/`When`/`Then`/`And`/`But`/`*` → `keyword` scopes; `@tag` →
      `entity.name.tag`; `"""` docstrings and `|` table cells; `<param>` →
      `variable.parameter`. Also assert the `grammars` contribution points at
      the file with `language: "feature"`. Run → fails.
- [ ] Implement the grammar. English keywords only (decision D5). Header
      patterns run before the generic comment rule. Header rules require the
      MarkSpec shape (bracketed display ID; `Key:` with a capitalized key after
      the `#`), so ordinary comments stay comments.
- [ ] Verify: three commands; then a manual check in an Extension Development
      Host (F5, see `DEVELOPMENT.md`) on `tests/fixtures` `.feature` files, with
      "Developer: Inspect Editor Tokens and Scopes".
- [ ] Commit.

### Task 4: Header injection grammar for Cucumber extensions

**Files:** create `editors/vscode/syntaxes/feature-injection.tmLanguage.json`;
modify `package.json` (`grammars` entry with `injectTo`); extend
`grammar.test.ts`.

- [ ] First, verify the scope names of the two Cucumber extensions from their
      published `package.json` (marketplace or GitHub source), and record them
      in the plan and in a comment in the test. Expected candidates:
      `source.cucumber` / `text.gherkin.feature` — do not hard-code until
      verified.
- [ ] Failing test: the injection grammar has `injectionSelector`
      `L:<verified scopes> comment.line` (or the scope those grammars give to
      `#` lines), reuses the same header patterns as Task 3 (single source: Task
      3 and Task 4 grammars are both checked against one shared sample table),
      and `package.json` lists it with `injectTo` set to the verified scope
      names. Run → fails.
- [ ] Implement. The injection only adds scopes to `#` lines; it never claims
      the file.
- [ ] Verify: three commands; manual check with the official Cucumber extension
      installed in the development host: header highlighting appears, Cucumber
      step highlighting and its features are unchanged, and MarkSpec
      diagnostics/hover work (Task 1 pattern selector).
- [ ] Commit.

### Task 5: Documentation and ADR-038 amendment

**Files:** modify `docs/guide/editor-vscode.md` (§ ".feature files", features
table), `docs/guide/feature-files.md` (§ "Editor support", "Known limitations"),
`docs/architecture/adr-038-gherkin-ast.md` (new amendment),
`editors/vscode/README.md` (feature list, if it lists supported files).

- [ ] Rewrite the `.feature` section of `editor-vscode.md`: the extension sends
      `.feature` buffers (selector by file pattern), contributes a `feature`
      language and grammar, and coexists with Cucumber extensions (which
      extension owns the file; how to choose with `files.associations`; header
      highlighting through the injection). Remove the sentences that say the
      extension does not send buffers.
- [ ] Update `feature-files.md` Known limitations: drop any statement this slice
      makes false; add new limits (English keywords only; injection covers only
      the verified Cucumber grammars).
- [ ] Add "## Amendment 2026-11-14 — VS Code client for `.feature` files" to
      ADR-038, after the LSP amendment, before "## Trace": selector by pattern,
      language id `feature`, grammar plus injection, alternatives considered
      (language-id-only selector; no language contribution; contributing
      `cucumber`).
- [ ] Check every edited statement against the code (task reviewer checks this
      too).
- [ ] Verify: `just fmt`, `prim fmt --check .`, `prim lint .`, `just check`.
- [ ] Commit.

### Task 6: Branch verification and packaging smoke test

- [ ] `npm --prefix editors/vscode ci && npm --prefix editors/vscode test &&
      npm --prefix editors/vscode run compile && npm --prefix editors/vscode
      run lint`.
- [ ] `cd editors/vscode && npx vsce ls` → lists `syntaxes/*.json` and
      `language-configuration.json`, and no test files.
- [ ] `just build` (lint + test + type-check + compile), then
      `deno fmt --check`.
- [ ] Squash to one commit (`feat(lsp): ...` scope per git-std list), garden
      `docs/wip/` with `sdd-gardening` before the PR.

## Open decisions (with recommendation)

- **D1 — How the client selects `.feature` documents.** Options: (a) add
  `language: "feature"` (misses files owned by the official Cucumber extension,
  id `cucumber`); (b) list `feature` and `cucumber`; (c) select by
  `pattern: "**/*.feature"`. **Recommend (c)**: it works whatever extension owns
  the language id, and needs no list of third-party ids.
- **D2 — Contribute a language at all.** Options: (a) contribute `feature` with
  `.feature`; (b) contribute nothing and only inject. Without a contribution, a
  user with no Cucumber extension gets plain text and no `#` comment toggling.
  **Recommend (a)** with id `feature` (the id the community already uses; when
  "Cucumber (Gherkin) Full Support" is installed the two contributions merge on
  the same id). With the official extension (`cucumber`), VS Code picks one id
  per file; document `files.associations` for the user's choice. Do not
  contribute `cucumber` — that would hijack another extension's id.
- **D3 — Grammar scope name.** Options: `source.feature` (may collide with a
  Cucumber grammar of the same name) or a namespaced `source.feature.markspec`.
  **Recommend `source.feature.markspec`** so two grammars never overwrite each
  other.
- **D4 — Header highlighting when another extension owns the file.** Options:
  (a) injection grammar into verified Cucumber scopes; (b) rely on LSP semantic
  tokens only. **Recommend (a) plus (b)**: semantic tokens already cover display
  IDs when the theme enables them; the injection gives highlighting without
  them. Verify scope names first (Task 4).
- **D5 — Gherkin i18n keywords (`# language: fr`).** **Recommend English only**
  in this slice, matching the parser scope in ADR-038; list as a known
  limitation.
- **D6 — Grammar test method.** Options: add `vscode-tmgrammar-test` (new dev
  dependency, real Oniguruma) or plain `node:test` regex checks. **Recommend
  `node:test`** (no new dependency, fits the existing `npm test`), plus the
  manual scope inspection step in Tasks 3 and 4.
- **D7 — Activation.** `activationEvents` is
  `workspaceContains:**/.markspec.yaml` only. **Recommend no change**: a
  `.feature` file outside a MarkSpec project must not start the server. The
  language and grammar contributions are declarative and work without
  activation.
