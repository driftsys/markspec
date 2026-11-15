# Plan: LSP code actions for `.feature` files (#943)

Branch `feat/feature-code-actions-943`, worktree `.claude/worktrees/feat-943`.
Implementation starts **after PR #951 (#938) merges**: rebase onto that main
first. With #951, `WorkspaceIndex.validateAll` runs the whole validator
pipeline, so MSL-T020 and MSL-M060 reach the editor. Resolves ADR-038 LSP
amendment item 7 (decision D6 there).

Decisions D1–D10 are recorded on #943.

## Findings that drive the design

1. The Markdown quick fixes already run on `.feature` files and misfire.
   `server.ts` `onCodeAction` calls `buildCodeActions` for every
   `isMarkspecFile` path. The A030, A013, A012, T020 and A011 builders scan
   `^\s{4,}Key:` from the diagnostic line to the end of the file. A `# Key:`
   header line never matches; an indented doc-string line further down does.
   Today "Remove 'Verified-by' line" deletes a doc-string line. Routing
   `.feature` away from those builders fixes this.
2. For a `.feature` file, `fmt` only stamps a missing `# Id:`
   (`core/formatter/feature_file.ts`). A fix must never remove an `Id:` line and
   must keep line endings. `fmt` does not drop empty `# Key:` lines in
   `.feature` files.
3. MSL-M060 positions are exact file positions on `.feature` text; the shared
   range-only builder works as is.
4. An empty `# Key:` line (MSL-P021) voids the whole trailer: `rawAttributes`
   becomes empty, so MSL-P020, MSL-R003 and MSL-I003 also fire although `# Id:`
   is present. Removing the empty line restores the trailer.

## Codes

In scope on `.feature`:

| Code     | Fix                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------- |
| MSL-A030 | Remove the `# Verified-by:`-style line in the header's trailer block                            |
| MSL-A013 | Keep the first `# Key:` line of the block, remove later ones                                    |
| MSL-A012 | Remove the line (`# Labels: ,`)                                                                 |
| MSL-A011 | Split into one `<prefix>Key: v` line per top-level value; keep the `#` prefix and line ending   |
| MSL-P021 | Empty `# Key:` only: remove every empty key line of the block; if all empty, the `#` line above |
| MSL-T020 | Replace the `# Type:` value with the closest core type (distance ≤ 3)                           |
| MSL-M060 | Shared range-only builder                                                                       |
| MSL-S010 | Shared stub                                                                                     |
| MSL-B069 | Blank-gap variant only: delete blank lines between header and node, offered only if a re-parse  |
|          | of the edited text yields an entry at the header line                                           |

Out of scope: B069 above Background/Examples/step or stacked header (target node
is a choice); B062, P030, B060–B068 (judgment or authored text); R003/I003
missing Id (Format Document stamps it; no Markdown fix either); R003/I004
multiple Id; P020 other shapes; P021 non-empty malformed; P022; A006 (no
Markdown fix); P023, L010, S002, S003 (never raised on `.feature`).

## Design

- New `packages/markspec/lsp/feature_code_actions.ts`:
  `buildFeatureCodeActions(uri, filePath, diagnostics, documentText): Promise<CodeAction[]>`.
- `code_actions.ts` keeps the Markdown path unchanged and exports the pure
  helpers (doc comments, no behaviour change): `quickFix`, `deleteLines`,
  `closestCoreType`, `splitCitationValues` (extracted from `buildA011Fix`),
  `buildM060Fix`, `buildS010Fix`, `ATTRIBUTE_KEY_RE`, `T020_VALUE_RE`,
  `EMPTY_TRAILER_RE`.
- Header locator: the header run starts at the diagnostic line (a comment whose
  text starts with `[ID]`) and goes down over consecutive comment lines,
  stopping before a non-comment line, the next header start, or a `# language:`
  line. The trailer block is, after skipping trailing `#`-only lines, the
  contiguous comment lines whose text (after `^\s*#[ \t]*`) matches
  `^[A-Z][A-Za-z-]*\s*:`. For P021 the diagnostic range is the line itself.
- D4: extract the run-end rule as `featureHeaderRunEnd(lines, titleIdx)` in
  `core/parser/feature_file.ts`, export from `core/mod.ts`, and use it in the
  formatter (`core/formatter/feature_file.ts`) and in the LSP.
- Routing: `server.ts` `onCodeAction` becomes async; `isFeatureFile(filePath)` →
  `buildFeatureCodeActions`, otherwise `buildCodeActions`. No `.feature`
  diagnostic reaches a Markdown line-scanning builder.

## Tasks

Per-task gate: record base SHA, sonnet implementer (TDD, `just check`, one
commit, no push, no stash, nothing left running), separate reviewer with the
diff file (two verdicts), fix findings, next task.

1. **Shared helpers + header locator.** Export the helpers; add
   `featureHeaderRunEnd` (D4) and the formatter switch to it; add `headerRun`,
   `trailerBlock`, `commentPrefix`, `trailerKey` in the new module. Tests first
   (`feature_code_actions_test.ts`): git-style header, indented `# [ID]`
   scenario header, indented `#     Key:` trailer, trailing `#` line, stop at
   next `# [ID]`, stop at `# language:`, never a step or doc-string line.
   `code_actions_test.ts` and `core/formatter/feature_file_test.ts` pass
   unchanged.
2. **Header-attribute fixes (A030, A012, A013, T020, A011).** Tests from real
   diagnostics (`parseFile` + `runPipeline` → `toLspDiagnostic`): each code in
   git-style and indented headers; regression: a later doc string holding
   `Verified-by:` or `Type: Requirment` is never edited; A011 on CRLF keeps
   `\r\n` and the prefix; A011 single value and T020 with no close match give no
   fix; fmt parity: `formatFeatureText(out).changed === false` when Ids are
   present, and re-parse shows the code gone. No `# Id:` line touched.
3. **P021 in `#` form.** `# Id` + `# Satisfies:` → only that line removed, entry
   then has Id and no P021/P020/R003/I003; all-empty block → block and `#` line
   above removed; several empty lines → all removed; non-empty malformed → no
   fix; range on a non-comment line → no fix; fmt parity.
4. **B069 blank-gap fix with re-parse check.** Header/blank/`Scenario:` → fix;
   header/`@tag`/blank/`Scenario:` → fix; header/blank/`Background:` → no fix;
   stacked header → no fix for the upper one; no gap above Background → no fix;
   two blank lines → both deleted; `# language: fr` file → fix offered. Title
   "Remove the blank line between the header and the node", preferred.
5. **Server routing + e2e.** Async `onCodeAction` with `isFeatureFile` routing.
   e2e in `tests/e2e/lsp_feature_test.ts` (keep the client open, wait on
   `latestPublishIsCrossFile`, request `textDocument/codeAction` with the
   published diagnostics): one A030 action deleting the header line, one B069
   action deleting the blank line, no edit touching a doc string. The existing
   "every handler is empty for a plain Cucumber file" test still passes.
6. **Docs.** `docs/guide/feature-files.md` (Quick fixes bullet; replace the "no
   quick fixes" limitation with the short out-of-scope list);
   `docs/guide/editor-vscode.md` quick-fix row; ADR-038 "Amendment 2026-11-15 —
   code actions for `.feature` files" with D1–D10 and alternatives, LSP item 7
   marked resolved by #943, Trace extended; `code_actions.ts` module doc points
   at the new module. Then garden this plan out of `docs/wip/`.

## Alternatives considered

1. File-kind switch inside `buildCodeActions`, or one locator for both syntaxes:
   changes the Markdown builders and does not fit the async B069 check.
2. Index `attributeLines`: can lag the buffer and omits empty-valued lines.
3. Re-parse for every code: only B069 needs the node kind.
4. B069 with English keyword regexes: wrong or no fix in `# language:` files.
5. B069 "move header above the enclosing Feature or Rule": intent unclear;
   deferred.
6. "Stamp Id" quick fix: Format Document covers it.
7. Leave `.feature` on the Markdown builders: they edit Gherkin text today.
