# MarkDesk First Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The author selects one requirement in MarkDesk, asks the selected
assistant to rewrite its body, reads a formatted word-level diff, and accepts
(one atomic, splice-only write through the desk server) or rejects (nothing
written).

**Architecture:** A pure core helper reads and replaces one entry's body in a
Markdown file text and checks that the entry set is unchanged. The desk server
gains two `POST` operations (preview, apply) guarded by `If-Match` on the
existing document ETag; apply formats with the `markspec fmt` code path, splices
only the target body into the current text, and writes through a new atomic
write capability of `DeskSource`. The Tauri shell gains a prompt run that reuses
the Test machinery with tools switched off, enabled only for Claude Code. The UI
adds a prompt panel in the assistant column that drives shell run → preview →
accept/reject → `refresh()`.

**Tech Stack:** Deno/TypeScript (core, desk server), Rust (Tauri v2 shell),
React 19 + Vitest (UI), OpenAPI 3.1 (`schemas/desk-api.json`) with
`openapi-typescript` and `openapi-fetch`.

**Spec:** `docs/wip/specs/2026-10-31-markdesk-first-prompt-design.md`

## Global Constraints

- Agents only propose. MarkDesk writes a product file only on the author's
  explicit Accept; a rejected proposal writes nothing.
- Every write passes the `markspec fmt` formatter (`format()` from `core/mod.ts`
  with `formatMarkdownProse` from `loadMarkdownFormatter()`). No separate format
  step, button, or message is shown; a formatter problem is shown only when it
  blocks the write.
- A write changes only the target entry's body lines. Every other byte of the
  file (other entries, prose, front matter, line endings, a UTF-8 BOM) stays
  unchanged.
- The ETag taken when the prompt is submitted is the `If-Match` precondition of
  both preview and apply. Missing → 428; not naming the current document ETag →
  412.
- Proposal wire format is a list of changes `{ displayId, kind: "body", body }`;
  this story sends and accepts exactly one change of kind `body`.
- Out of scope and refused: entries with an `origin`, entries outside a `.md`
  file, entries with an empty body, titles, trailers, new entries.
- Assistant hard rule: a prompt run is enabled only for an assistant whose flags
  are proven by a shell test to block file reads, shell commands, and writes.
  Claude Code with `--tools ""` qualifies; Codex and Copilot stay disabled with
  the reason "Prompts are not yet available for <assistant>." The Test keeps its
  current flags.
- Prompt run: fresh empty temporary working folder, never the product folder;
  timeout 120 seconds; cancel kills the process group; reply over 20 000
  characters refused; a prompt run and a Test never overlap.
- UI copy fixed by the spec: "This file changed since the proposal. Ask again."
  (instruction kept), "MarkDesk could not format this proposal.", "The assistant
  returned no proposal.", "This entry has no body yet.", "Prompts are not yet
  available for <assistant>."
- Keyboard: Enter submits, Shift+Enter inserts a new line, Escape rejects a
  shown proposal; prompt box, Send, Accept, Reject reachable by Tab.
- `core/mod.ts` is the library boundary; core code is Node-compatible (no
  `Deno.*`); `desk/api.ts` and `desk/proposals.ts` use Web APIs only.
- Tests colocated as `<module>_test.ts`; UI tests go through `watchConnection`
  (the client `App` builds via `useProduct`), not only a raw fake.
- Commits: Conventional Commits, scope from
  {auto,repo,ci,spec,core,cli,lsp,mcp,render,book,deck,docs,deps}, ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The PR is squashed
  to one commit at merge (AGENTS.md "One commit per PR").
- Plain literal English in code comments, docs, and commit messages.
- SAD entries: one requirement each, measurable; never hand-write `Id:` — run
  `deno run -A packages/markspec/main.ts fmt <file>` then `check <file>`.
- Verification before the PR: `just build`, `deno fmt --check`, plus the
  MarkDesk commands of AGENTS.md "MarkDesk is outside just".

## Builder decisions (the spec's "Left to the builder")

Stated once here; tasks use them without restating the reason.

1. **Paths and verbs:** `POST /api/v1/proposals/preview` and
   `POST /api/v1/proposals/apply`. Request body `ProposalRequest`
   `{ changes: ProposalChange[] }` (exactly one item);
   `ProposalChange = { displayId, kind: "body", body }`. Preview 200 →
   `ProposalPreview { apiVersion, changes: PreviewedChange[] }`,
   `PreviewedChange = { displayId, kind: "body", body, currentBody }`. Apply 200
   → `ProposalApplied { apiVersion, path, etag }` plus an `ETag` header.
2. **Error codes:** 400 `bad-request` (malformed JSON or shape), 404
   `entry-not-found`, 409 `entry-read-only` (origin), 409 `entry-not-markdown`,
   409 `entry-body-empty`, 412 `precondition-failed`, 422 `proposal-empty`, 422
   `proposal-too-large` (body over 20 000 characters), 422
   `proposal-changes-entries`, 422 `format-failed`, 428 `precondition-required`,
   500 `write-failed`.
3. **`If-Match` comparison:** strong (RFC 9110 §13.1.1). A `W/` tag and `*`
   never match, because neither names the current tag.
4. **`DESK_API_VERSION` stays 3:** the change is additive.
5. **Apply re-formats:** apply runs the whole preview pipeline on the supplied
   body and splices the server's own formatted result (formatting is idempotent,
   so a body from preview splices unchanged).
6. **New ETag after apply:** computed with the pre-write compiled graph and the
   new text; the identity check guarantees the same entries, so the value equals
   what a fresh compile gives.
7. **Writes are serialized** inside one handler (a promise chain), so the
   check-then-write of two applies never interleaves.
8. **Body range:** the lines after the title paragraph (the first blank line
   after the title line, so a soft-wrapped title is skipped) and the blank lines
   after it. The range has as many lines as the parser's `entry.body`, so a lazy
   continuation line (less indented than the body) is included. The dedented
   range, trimmed as a whole as the parser trims its body (so a body that starts
   with an indented code block matches), must equal `entry.body` line for line
   (trailing whitespace ignored); otherwise `replaceEntryBody` refuses with
   `entries-changed` and `readEntryBody` returns `entry.body`. Indent is
   `(location.column - 1) + 2`, as in the formatter.
9. **Line endings:** lines are split on `\r\n`, a lone `\r`, or `\n` (the
   parser's rule, so line numbers agree) and keep their own ending; inserted
   body lines take the ending of the title line. Mixed files keep every other
   line's ending. In the proposal, `\r\n` and a lone `\r` become `\n`.
10. **Identity check:** same entry count; per index, same `displayId` and `id`;
    for the target, also same `title` and same `rawAttributes` (key and value),
    and the target's body equals the proposal (both trimmed as a whole). The
    edit is also refused when the reparse raises more parse diagnostics of some
    code (any code `parseFile` returns, for example MSL-P020) than the original
    text.
11. **`MSL-F900` on the target:** detected as a diagnostic with code `MSL-F900`
    whose message starts with `` `${displayId}:` `` (the formatter's message
    format). `MSL-F012` is ignored. A prose formatter that fails to load →
    `format-failed`.
12. **Prompt template (exact):** see Task 5. Trailer attributes are included as
    read-only context.
13. **Prompt transport:** an argument (`claude -p <prompt>`). Limit: the built
    prompt is at most 100 000 bytes (below Linux `MAX_ARG_STRLEN` 131 072 and
    macOS `ARG_MAX` 1 048 576); a longer prompt is refused before the process
    starts. No stdin.
14. **Claude Code prompt flags:**
    `-p <prompt> --output-format text --tools "" --strict-mcp-config
    --disable-slash-commands --no-session-persistence`.
    `--strict-mcp-config` with no `--mcp-config` drops user-level MCP servers,
    whose tools `--tools ""` does not cover. Amended during the Task 5 review:
    see "Task 5 review amendments" below.
15. **Codex and Copilot:** `prompt_args` returns `None` in this story. Task 5
    has one bounded step to look for read-blocking flags; enabling either needs
    its own passing manual test.
16. **Prompt availability reaches the UI** as a new `promptsAvailable` field on
    `AssistantStatus`, derived from the id.
17. **Busy guard:** the existing `AssistantTestState` (`running`, `cancel`) is
    shared; `with_test_guard` becomes generic `with_assistant_guard`; both
    refusals use one message
    `ASSISTANT_BUSY = "An assistant run is already in
    progress."`. A new
    `cancel_assistant_prompt` command sets the same cancel flag;
    `cancel_assistant_test` is unchanged.
18. **Manual tests** are `#[ignore]` and named `manual_assistant_*`; CI's
    ignored-test step gains `--skip manual_assistant_` (CI has no signed-in
    assistant).
19. **Diff:** own word-level LCS over tokens split by `/(\s+)/`, no dependency.
    Above 1 000 000 token-pair cells it falls back to one removed part and one
    added part. Presentation: "Current" block with removed words in `<del>`,
    "Proposed" block with added words in `<ins>`, `white-space: pre-wrap`.
20. **Fence removal and empty check in the UI;** the 20 000-character limit in
    the shell (reply) and again in the server (request body). Both count UTF-16
    code units (JavaScript `String.length`, Rust `encode_utf16().count()`).
21. **Submit reads the ETag first, then the entry:** `client.document(path)`
    then `client.entry(id)`. A change between the two leaves the tag stale, so
    preview answers 412; no edit is lost.
22. **Task order:** core helper → proposal logic → API → client → shell → UI
    helpers → UI flow → records.

## Orchestrator decisions (2026-10-31, during Task 2 review)

These amend the builder decisions above. Later tasks and fixers follow them.

1. **New refusal `entry-trailer-invalid` (409).** When the target entry's
   trailer did not parse (MSL-P020, P021 or P022 names the target), preview and
   apply refuse with `entry-trailer-invalid`, not `proposal-changes-entries`.
   Task 3 maps it to HTTP 409 and tests it. Task 7 shows: "This entry's trailer
   has a problem. Run markspec check and fix it first." Builder decision 2 gains
   this code.
2. **The same guard in core.** `replaceEntryBody` in
   `core/formatter/entry_body.ts` refuses an entry whose trailer did not parse
   (refusal `entries-changed` or a new `trailer-invalid`; the desk maps it to
   `entry-trailer-invalid`), so no caller of the exported helper can delete an
   `Id:` line. Add a core test.
3. **Apply does not format the current text.** Accepted as recorded: apply
   formats the candidate and splices only the target body into the current raw
   text, which is what the spec asks.
4. **The length limit also applies after formatting.** `checkProposal` refuses
   with `proposal-too-large` when the formatted body exceeds
   `MAX_PROPOSAL_CHARS`, so every body a preview returns passes apply. Test with
   a proposal at the limit that formatting lengthens.
5. **The current-body fallback compares letters and digits only.** The preview
   shows the formatted current body unless the letters-and-digits word sequence
   of the formatted and raw bodies differ (lost or moved content). Markdown
   punctuation rewrites (`*emph*` to `_emph_`, list markers, table rules,
   escapes) keep the formatted body. Test both directions.
6. **The core formatter bug is out of scope.** `format()` moving a lazy
   continuation line out of its list item and duplicating the trailer is a
   separate core issue. The desk stays safe through decision 5's fallback.

## Task 5 review amendments (2026-10-31)

Recorded by the Task 5 review fixer. They describe the as-built shell; the
orchestrator confirms or reverts them before Task 7.

1. **Prompt flags gain two options.** The flags are
   `-p <prompt> --output-format text --tools "" --strict-mcp-config
   --setting-sources "" --disable-slash-commands --no-session-persistence
   --append-system-prompt <PROMPT_SYSTEM_TEXT>`.
   `--setting-sources ""` stops the user, project and local settings files from
   loading, so user hooks and user plugins do not run (sign-in still works). The
   appended system text tells the model it has no tools. Without it, an
   instruction that asks for a tool action made the model write tool calls as
   plain text in a loop until the 120 s timeout (seen in about 1 run of 3 with
   `stream-json`); with it, 10 of 10 shell probes and 4 of 4 full manual-test
   runs ended with a reply in under 15 s.
2. **Structural proof.** A third manual test runs the real `claude` with the
   prompt flags and `--output-format stream-json --verbose`, and asserts that
   the init event reports `tools == []` and `mcp_servers == []`, and that no
   `hook_started` event occurs. It does not depend on the model's reply.
3. **Failed error order (Task 5 Step 3).** The error of a failed run is the
   first non-empty stdout line, then the first non-empty stderr line, then
   `exit code <n>`. Claude Code prints its real error on stdout. Task 7's error
   copy and the Task 8 records describe this order.

## Task 7 review amendments (2026-10-31)

Recorded by the Task 7 review fixer. They describe the as-built UI flow; Task 8
carries them into the records.

1. **Interface additions.** `PromptController.assistantName` (the display name
   in "Waiting for <name>…"), `PROMPT_MESSAGES.readFailed` ("MarkDesk could not
   read this entry.", shown when the submit-time document or entry read fails)
   and `PROMPT_MESSAGES.trailerInvalid` (orchestrator decision 1). The hook's
   "Set up an assistant first" reason is never shown through the column, which
   mounts the panel only when an assistant is selected; it guards a direct
   mount.
2. **Cancel stops the run in the UI.** Cancel moves the run counter on, sets
   `idle` and keeps the instruction, then asks the shell to cancel. A submit
   still reading the document or the entry does not start the shell run, and a
   late result (shell reply or preview) is ignored. This covers the shell's
   known gap: a cancel that arrives before the run takes the guard.
3. **Focus.** Focus moves to Cancel while the assistant runs and to Accept when
   the proposal appears, so Escape reaches the panel after the disabled box
   loses focus. When the flow ends (reject, accept, cancel, error), focus
   returns to the box, unless the author moved focus outside the panel.
4. **A write in progress survives a selection change.** The box stays busy until
   the apply ends, and a failed apply is still reported.
5. **Lost connection during preview.** A `DeskError` with status 0 from the
   preview sets `idle` without a column sentence; the app's lost-connection
   banner reports it. An apply that fails with status 0 still shows
   `writeFailed`, because the write may or may not have happened.

## Review Focus

Inputs the spec implies but does not name; each has a test in its owning task.

1. A Markdown file with YAML front matter: the body range must use file-relative
   lines (the helper parses with `parseFile`, which pads front matter with blank
   lines). Test in Task 1.
2. An indented top-level list item (marker at column 3): body indent is 4, and
   the re-indented proposal must stay inside the item. Nested list items are not
   entries (the parser gives none), so this is the reachable case. Test in
   Task 1.
3. A title that soft-wraps onto a second line (#686): the second title line is
   not part of the body. Test in Task 1.
4. A proposal whose last line looks like a trailer (`Satisfies: STK_BRK_0002`):
   it would become a trailer, so the identity check must refuse it. Test in
   Task 1.
5. Accept pressed twice quickly: the second apply must answer 412 and write
   nothing more. Tests in Task 3 (serialized writes) and Task 7 (Accept disabled
   while applying).

---

## File Structure

| File                                                                     | Responsibility                                                       |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `packages/markspec/core/formatter/entry_body.ts` (new)                   | Read and splice one entry's body; identity check. Pure.              |
| `packages/markspec/core/formatter/entry_body_test.ts` (new)              | Unit tests.                                                          |
| `packages/markspec/core/mod.ts`                                          | Export the helper.                                                   |
| `packages/markspec/desk/proposals.ts` (new)                              | Preview/apply pipeline: limits, format, F900, splice. Web APIs only. |
| `packages/markspec/desk/proposals_test.ts` (new)                         | Unit tests.                                                          |
| `packages/markspec/desk/write.ts` (new)                                  | `writeTextFileAtomic` (Deno APIs).                                   |
| `packages/markspec/desk/write_test.ts` (new)                             | Unit tests.                                                          |
| `packages/markspec/desk/api.ts`                                          | Routes, `If-Match`, refusals, CORS, `DeskSource.writeFile`.          |
| `packages/markspec/desk/server.ts`                                       | Wire `writeFile` to `writeTextFileAtomic`.                           |
| `packages/markspec/desk/api_test.ts`                                     | API tests.                                                           |
| `schemas/desk-api.json`, `apps/markdesk/src/api/schema.d.ts` (generated) | Contract.                                                            |
| `apps/markdesk/src/api/client.ts`, `src/app/useProduct.ts`               | Client methods; `watchConnection` wraps them.                        |
| `apps/markdesk/src-tauri/src/assistants.rs`, `src/lib.rs`                | Prompt run, availability, shared guard, commands.                    |
| `.github/workflows/markdesk.yaml`                                        | Skip manual assistant tests.                                         |
| `apps/markdesk/src/shell/bridge.ts`, `src/assistant/testBridge.ts`       | Bridge methods and fake.                                             |
| `apps/markdesk/src/assistant/reply.ts` (new)                             | `stripOneFence`.                                                     |
| `apps/markdesk/src/assistant/wordDiff.ts` (new)                          | `diffWords`.                                                         |
| `apps/markdesk/src/assistant/promptReason.ts` (new)                      | `promptDisabledReason`.                                              |
| `apps/markdesk/src/assistant/usePrompt.ts` (new)                         | Prompt state machine.                                                |
| `apps/markdesk/src/assistant/PromptPanel.tsx` (new)                      | Box, running state, proposal, errors.                                |
| `apps/markdesk/src/assistant/AssistantColumn.tsx`                        | Mount `PromptPanel`.                                                 |
| `docs/architecture/adr-035-markdesk.md`, `apps/markdesk/README.md`       | Records.                                                             |

---

### Task 1: Core entry-body helper

**Files:**

- Create: `packages/markspec/core/formatter/entry_body.ts`
- Create: `packages/markspec/core/formatter/entry_body_test.ts`
- Modify: `packages/markspec/core/mod.ts` (formatter export block, ~line 232)

**Interfaces:**

- Consumes: `parseFile` (`core/parser/mod.ts`).
- Produces (exported from `core/mod.ts`):
  ```ts
  export type EntryBodyRefusal =
    | "entry-not-found" | "body-empty" | "proposal-empty"
    | "trailer-invalid" | "entries-changed";
  export type EntryBodyEdit =
    | { readonly ok: true; readonly text: string }
    | { readonly ok: false; readonly refusal: EntryBodyRefusal };
  /** Body as written in `text` (dedented, LF, no surrounding blank lines);
   *  "" when the entry has no body; undefined when no entry has `displayId`.
   *  `file` names a `.md` file. */
  export function readEntryBody(text: string, file: string, displayId: string): Promise<string | undefined>;
  /** `text` with the target body replaced by `body` re-indented to the body
   *  indent; every other line byte-for-byte unchanged. */
  export function replaceEntryBody(text: string, file: string, displayId: string, body: string): Promise<EntryBodyEdit>;
  ```

- [ ] **Step 1: Write the failing tests** in `entry_body_test.ts`, using a
      two-entry document `DOC` (`- [REQ_0001] First` … `Id:` …,
      `- [REQ_0002]
      Second` …) and the file name `/p/doc.md`:

```ts
Deno.test("readEntryBody: returns the dedented body", async () => {
  assertEquals(await readEntryBody(DOC, FILE, "REQ_0001"), "Body one line A.\nline B.");
});
Deno.test("readEntryBody: empty string for an entry with no body", ...);       // title + trailer only → ""
Deno.test("readEntryBody: undefined for an unknown display ID", ...);
Deno.test("replaceEntryBody: replaces only the target body lines", async () => {
  const r = await replaceEntryBody(DOC, FILE, "REQ_0001", "New body.");
  assert(r.ok);
  assertEquals(r.text, DOC.replace("  Body one line A.\n  line B.", "  New body."));
});
Deno.test("replaceEntryBody: keeps unformatted neighbours byte for byte", ...); // REQ_0002 with trailing spaces, odd wrap, unsorted trailers; assert text outside REQ_0001 body unchanged
Deno.test("replaceEntryBody: keeps CRLF line endings", ...);                    // DOC with \r\n; result has \r\n on every line incl. new body lines; no bare \n
Deno.test("replaceEntryBody: keeps each line's own ending in a mixed file", ...);
Deno.test("replaceEntryBody: multi-paragraph body keeps blank lines unindented", ...); // "A.\n\nB." → "  A.\n\n  B."
Deno.test("replaceEntryBody: refuses a body that adds an entry line", async () => {
  const r = await replaceEntryBody(DOC, FILE, "REQ_0001", "Text.\n\n- [X_0001] Sneaky\n\n      Id: 01JBRK00000000000000000099");
  assertEquals(r, { ok: false, refusal: "entries-changed" });
});
Deno.test("replaceEntryBody: refuses an empty or blank proposal", ...);         // "" and "  \n\n" → proposal-empty
Deno.test("replaceEntryBody: refuses an entry with no body", ...);              // body-empty
Deno.test("replaceEntryBody: refuses an unknown display ID", ...);              // entry-not-found
// Review Focus 1-4:
Deno.test("replaceEntryBody: front matter keeps file-relative lines", ...);     // DOC prefixed with "---\ntitle: X\n---\n"; front matter unchanged; target body replaced
Deno.test("replaceEntryBody: indented entry uses its own body indent", ...);    // "  - [REQ_0003] Indented\n\n    Body.\n\n        Id: …" → new body at 4 spaces
Deno.test("replaceEntryBody: a soft-wrapped title is not part of the body", ...); // title on two lines; readEntryBody excludes the second title line; replace keeps it
Deno.test("replaceEntryBody: refuses a body ending in a trailer-like line", async () => {
  const r = await replaceEntryBody(DOC, FILE, "REQ_0001", "New.\n\n    Satisfies: REQ_0002");
  assertEquals(r, { ok: false, refusal: "entries-changed" });
});
// Review fixes:
Deno.test("readEntryBody: includes a lazy continuation line", ...);            // "  Body line one\nlazy continuation line.\n  Still body." → all three lines
Deno.test("replaceEntryBody: replaces a body with a lazy continuation line", ...); // the lazy line is replaced too
Deno.test("replaceEntryBody: a lone CR in the proposal becomes a line break", ...);
Deno.test("replaceEntryBody: a file with lone CR line endings keeps them", ...);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test -A packages/markspec/core/formatter/entry_body_test.ts`
Expected: FAIL, module `./entry_body.ts` not found.

- [ ] **Step 3: Implement `readEntryBody` and `replaceEntryBody` in
      `entry_body.ts`**, per builder decisions 8, 9, 10. The proposal is
      normalized before splicing: CRLF → LF, leading and trailing blank lines
      removed; empty after that → `proposal-empty`. A private
      `bodySpan(lines, entry): { start, end, indent }` (0-based, `[start, end)`,
      `start === end` for an empty body) is shared by both functions. Module doc
      comment states the splice-only contract.

- [ ] **Step 4: Export from `core/mod.ts`** next to `format`:
      `export { readEntryBody, replaceEntryBody } from "./formatter/entry_body.ts";`
      and the two types.

- [ ] **Step 5: Run the tests to verify they pass**

Run:
`deno test -A packages/markspec/core/formatter/entry_body_test.ts && deno check packages/markspec/core/mod.ts`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/formatter/entry_body.ts packages/markspec/core/formatter/entry_body_test.ts packages/markspec/core/mod.ts
git commit -m "feat(core): read and replace one entry body in a Markdown file" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Desk proposal pipeline

**Files:**

- Create: `packages/markspec/desk/proposals.ts`
- Create: `packages/markspec/desk/proposals_test.ts`

**Interfaces:**

- Consumes: Task 1 `readEntryBody`, `replaceEntryBody`; `format`,
  `type ProseFormatter`, `loadMarkdownFormatter` from `core/mod.ts`.
- Produces:
  ```ts
  export const MAX_PROPOSAL_CHARS = 20_000;
  export type ProposalRefusal =
    | "entry-not-found" | "entry-body-empty" | "proposal-empty"
    | "proposal-too-large" | "proposal-changes-entries"
    | "entry-trailer-invalid" | "format-failed";
  export type ProposalOutcome<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly refusal: ProposalRefusal };
  export interface BodyPreview { readonly body: string; readonly currentBody: string }
  /** No write. `file` is the absolute `.md` path (it gates the prose pass). */
  export function previewBody(text: string, file: string, displayId: string, proposed: string, formatProse: ProseFormatter): Promise<ProposalOutcome<BodyPreview>>;
  /** The new file text: `text` with the formatted proposed body spliced in. */
  export function applyBody(text: string, file: string, displayId: string, proposed: string, formatProse: ProseFormatter): Promise<ProposalOutcome<string>>;
  ```

  As built, both functions take an optional last `formatDocument` parameter
  (default `format`), and the module exports `isTargetF900` and the
  `DocumentFormatter` type. These are test seams marked `@internal`; Task 3 does
  not use them. The length limit also applies to the formatted body, so a
  preview body always passes the limit at apply.

- [ ] **Step 1: Write the failing tests** (real formatter:
      `const prose = await loadMarkdownFormatter();`), on a copy of
      `tests/fixtures/desk-project/docs/system.md` read into `SYSTEM` with
      `FILE = join(FIXTURE_ROOT, "docs/system.md")`:

```ts
Deno.test("previewBody: returns the formatted proposal and current body", async () => {
  const r = await previewBody(SYSTEM, FILE, "SYS_BRK_0001", "The braking system shall apply full torque within 150 ms.\n", prose);
  assert(r.ok);
  assertEquals(r.value.body, "The braking system shall apply full torque within 150 ms.");
  assertEquals(r.value.currentBody, "The braking system shall apply full braking torque within 200 ms of a\nconfirmed obstacle.");
});
Deno.test("previewBody: wraps a long line at the body width", ...);     // one 200-char sentence → every line ≤ 78 chars, words unchanged in order
Deno.test("previewBody: refuses a body over 20 000 characters", ...);   // "a ".repeat(10_001) → proposal-too-large
Deno.test("previewBody: refuses an empty proposal", ...);               // proposal-empty
Deno.test("previewBody: refuses an entry with no body", ...);           // entry-body-empty
Deno.test("previewBody: refuses a proposal that adds an entry", ...);   // proposal-changes-entries
Deno.test("previewBody: a prose formatter failure is not a refusal", async () => {
  const throwing: ProseFormatter = () => { throw new Error("boom"); };   // MSL-F012 path
  assert((await previewBody(SYSTEM, FILE, "SYS_BRK_0001", "New body.", throwing)).ok);
});
Deno.test("applyBody: splices the formatted body and keeps every other byte", async () => {
  const r = await applyBody(SYSTEM, FILE, "SYS_BRK_0001", "New body.", prose);
  assert(r.ok);
  assertEquals(r.value, SYSTEM.replace(/  The braking system shall apply full braking torque[^]*?obstacle\./, "  New body."));
});
Deno.test("applyBody: a preview body applies unchanged", ...);          // apply(preview.body) body === preview.body (idempotence)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test -A packages/markspec/desk/proposals_test.ts` Expected: FAIL,
module not found.

- [ ] **Step 3: Implement `previewBody` and `applyBody`.** Order: length check
      (`proposed.length > MAX_PROPOSAL_CHARS` → `proposal-too-large`);
      `readEntryBody(text)` (undefined → `entry-not-found`, "" →
      `entry-body-empty`); `replaceEntryBody` (map `entries-changed` →
      `proposal-changes-entries`, `body-empty` → `entry-body-empty`); `format`
      the candidate and the current text with `{ file, formatMarkdownProse }`
      inside `try` (a throw → `format-failed`); target `MSL-F900` per decision
      11 → `format-failed`; `readEntryBody` of each output gives `body` and
      `currentBody` (undefined → `format-failed`). `applyBody` calls
      `previewBody`, then `replaceEntryBody(text, file, id, preview.body)`. As
      built: both functions share one pipeline that ends with that final splice,
      so a preview whose formatted body fails the identity check is refused too.
      An `MSL-P020`/`P021`/`P022` naming the target in the original text → core
      `replaceEntryBody` refuses with `trailer-invalid`, which the desk maps to
      `entry-trailer-invalid` (orchestrator decisions 1 and 2; a malformed
      trailer line makes the parser read the `Id:` and trailer lines as body, so
      a splice would delete them). Apply does not format the current text. The
      preview uses the formatted current body only when it holds the same words
      as the raw body; otherwise it shows the raw body, which is what apply
      replaces.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test -A packages/markspec/desk/proposals_test.ts` Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/desk/proposals.ts packages/markspec/desk/proposals_test.ts
git commit -m "feat(cli): build formatted desk proposals for one entry body" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Desk API preview and apply

**Files:**

- Create: `packages/markspec/desk/write.ts`,
  `packages/markspec/desk/write_test.ts`
- Modify: `packages/markspec/desk/api.ts` (module doc; `DeskSource`;
  `DeskHandlerOptions`; preflight block ~line 351; `route()` method check ~line
  434; new `serveProposal`; new `namesEtagStrongly` beside `matchesEtag`)
- Modify: `packages/markspec/desk/server.ts` (source object ~line 76; module doc
  "Read endpoints only")
- Modify: `packages/markspec/desk/api_test.ts` (`handler()`, `handlerFor()`,
  `editableHandler()` gain `writeFile`; preflight tests ~lines 681 and 1110)
- Modify: `schemas/desk-api.json`; regenerate
  `apps/markdesk/src/api/schema.d.ts`
- Modify: `AGENTS.md` (layout `desk/` lines; CLI table `markspec desk --serve`
  row)

**Interfaces:**

- Consumes: Task 2 `previewBody`, `applyBody`, `MAX_PROPOSAL_CHARS`;
  `documentEtag`, `projectEntriesOf`, `toApiPath` (`desk/render.ts`).
- Produces:
  ```ts
  // desk/write.ts (Deno APIs)
  /** Write `text` to a new temp file `.<name>.markdesk-<8 hex>.tmp` in the same
   *  folder (createNew), copy the original's mode on POSIX, keep a leading
   *  UTF-8 BOM the original had, then rename over `path`. Removes the temp
   *  file on failure and rethrows. */
  export function writeTextFileAtomic(path: string, text: string): Promise<void>;
  // desk/api.ts
  interface DeskSource { /* … */ writeFile(absolutePath: string, text: string): Promise<void>; }
  interface DeskHandlerOptions { /* … */ readonly loadProseFormatter?: () => Promise<ProseFormatter>; } // default loadMarkdownFormatter
  ```
  HTTP per builder decisions 1–3 and 7; schema components `ProposalRequest`,
  `ProposalChange`, `ProposalPreview`, `PreviewedChange`, `ProposalApplied`.

- [ ] **Step 1: Write the failing `write_test.ts` tests**

```ts
Deno.test("writeTextFileAtomic: replaces the file content", ...);           // read back === text
Deno.test("writeTextFileAtomic: leaves no temporary file", ...);            // readDir has only the target
Deno.test("writeTextFileAtomic: keeps the file mode", { ignore: Deno.build.os === "windows" }, ...); // chmod 0o640 before; stat().mode & 0o777 === 0o640 after
Deno.test("writeTextFileAtomic: keeps a UTF-8 BOM", ...);                   // original bytes EF BB BF …; result starts with EF BB BF exactly once
Deno.test("writeTextFileAtomic: removes the temp file when rename fails", ...); // target path is a directory → rejects; folder holds no *.tmp
```

- [ ] **Step 2: Run them to verify they fail**

Run: `deno test -A packages/markspec/desk/write_test.ts` Expected: FAIL, module
not found.

- [ ] **Step 2a: Implement `writeTextFileAtomic` in `desk/write.ts`.**

- [ ] **Step 2b: Run them to verify they pass**

Run: `deno test -A packages/markspec/desk/write_test.ts` Expected: all PASS.

- [ ] **Step 3: Write the failing API tests** in `api_test.ts`. Add a
      `writableHandler(options?)` built like `editableHandler()` whose
      `writeFile` sets `state.text` and pushes to `state.writes`, and helpers
      `post(path, body, headers)` and `bodyChange(id, body)`:

```ts
Deno.test("desk api: preview returns the formatted proposal and writes nothing", async () => {
  const { h, state } = await writableHandler();
  const etag = (await h(get(SYSTEM_DOC))).headers.get("etag")!;
  const res = await h(post(PREVIEW, bodyChange("SYS_BRK_0001", "New body."), { "if-match": etag }));
  assertEquals(res.status, 200);
  const view = await res.json();
  await assertMatchesSchema("ProposalPreview", view);
  assertEquals(view.changes[0].body, "New body.");
  assertStringIncludes(view.changes[0].currentBody, "within 200 ms");
  assertEquals(state.writes.length, 0);
});
Deno.test("desk api: apply writes only the target body and returns the new ETag", ...); // 200; schema ProposalApplied; state.text === original with SYS_BRK_0001 body replaced; body.etag === res ETag header === new GET ETag
Deno.test("desk api: apply keeps unformatted neighbours byte for byte", ...);  // state.text starts with SYS_BRK_0002 unformatted (trailing spaces, unsorted trailers); after apply, bytes outside the target body equal
Deno.test("desk api: apply keeps CRLF line endings", ...);                    // state.text CRLF; written text has no bare "\n"
Deno.test("desk api: preview and apply answer 428 without If-Match", ...);    // both: 428 precondition-required, no write
Deno.test("desk api: preview answers 412 after the file text changes", ...);  // ETag, then state.text edited, preview → 412 precondition-failed
Deno.test("desk api: apply answers 412 after the file text changes", ...);    // no write
Deno.test("desk api: a weak or wildcard If-Match is 412", ...);               // `W/${etag}` and `*`
Deno.test("desk api: refuses an upstream entry", ...);                        // withUpstreamFile("system.md") → 409 entry-read-only
Deno.test("desk api: refuses an entry in a source file", ...);                // graph with RS_0001 at src/a.rs → 409 entry-not-markdown
Deno.test("desk api: refuses an unknown entry", ...);                         // 404 entry-not-found
Deno.test("desk api: refuses a body that adds an entry line", ...);           // 422 proposal-changes-entries, no write
Deno.test("desk api: refuses an empty body and a body over 20 000 characters", ...); // 422 proposal-empty / proposal-too-large
Deno.test("desk api: refuses an entry with an empty body", ...);              // state.text with SYS_BRK_0002 body removed → 409 entry-body-empty
Deno.test("desk api: refuses a malformed proposal request", ...);             // invalid JSON, changes: [], two changes, kind "title" → 400 bad-request
Deno.test("desk api: a formatter that cannot load is 422 format-failed", ...); // loadProseFormatter: () => Promise.reject(new Error("x"))
Deno.test("desk api: a failed write is 500 write-failed", ...);               // writeFile rejects
Deno.test("desk api: a second apply with the same ETag is 412", ...);         // Review Focus 5: two applies started without awaiting (Promise.all) → statuses [200, 412]; state.writes.length === 1
Deno.test("desk api: proposal routes accept only POST", ...);                 // GET PREVIEW → 405
Deno.test("desk api: preflight allows POST, Content-Type, and If-Match", async () => {
  const res = await (await handler())(preflight("tauri://localhost"));  // on /api/v1/proposals/apply
  assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  assertEquals(res.headers.get("access-control-allow-headers"), "Authorization, Content-Type, If-Match, If-None-Match");
});
Deno.test("desk api: proposal routes require the token and a loopback Host", ...); // 401 without token; 403 forbidden-host
```

    Update the two existing preflight assertions to the new values.

- [ ] **Step 4: Run them to verify they fail**

Run: `deno test -A packages/markspec/desk/api_test.ts` Expected: the new tests
FAIL (405 on POST, missing schema components); the two updated preflight tests
FAIL on the header values.

- [ ] **Step 5: Implement the API in `api.ts`.** `route()` allows `POST` only on
      `/api/v1/proposals/preview` and `/api/v1/proposals/apply`, `GET` only on
      the others (405 `method-not-allowed` otherwise).
      `serveProposal(request,
      apply: boolean)` checks in this order:
      `If-Match` present (428); JSON shape (400); entry exists (404); no
      `origin` (409); `.md` (409); path allowlist and real path inside the real
      root, reusing the `servePath` checks (404); read the real path;
      `namesEtagStrongly` (412); pipeline (refusal → status of decision 2); for
      apply, `source.writeFile(realTarget,
      newText)` (throw → 500) and the
      new ETag per decision 6. Apply runs inside a per-handler promise chain
      (decision 7). Preflight values become `GET, POST, OPTIONS` and
      `Authorization, Content-Type, If-Match,
      If-None-Match`. Update the
      module doc comment (remove "no writes"; list the two routes; state the
      `If-Match` rule).

- [ ] **Step 6: Wire the server.** In `server.ts`,
      `writeFile:
      writeTextFileAtomic` (imported from `./write.ts`);
      update the module doc. Add `writeFile` to the three test helpers in
      `api_test.ts`.

- [ ] **Step 7: Update the contract.** In `schemas/desk-api.json`: the two paths
      (`options` preflight, `post` with `If-Match` header parameter, request
      body, and responses 200, 400, 401, 403, 404, 405, 409, 412, 422, 428, 500
      referencing `Error`), the five components, the preflight header
      descriptions on every path, and `info.description` (drop "Read-only"; say
      the proposal routes write only on apply). Then
      `npm --prefix apps/markdesk run gen:client`.

- [ ] **Step 8: Update `AGENTS.md`:** add `proposals.ts` and `write.ts` to the
      `desk/` layout block; extend the `markspec desk --serve` row with
      "proposal preview and apply (one entry body, `If-Match`)".

- [ ] **Step 9: Run the checks**

Run:
`deno test -A packages/markspec/desk/ && deno check packages/markspec/desk/server.ts && bash scripts/check_desk_client.sh && dprint check`
Expected: all PASS; the client check prints nothing (after `git add` of the
regenerated file).

- [ ] **Step 10: Commit**

```bash
git add packages/markspec/desk schemas/desk-api.json apps/markdesk/src/api/schema.d.ts AGENTS.md
git commit -m "feat(cli): preview and apply one entry body through the desk API" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: UI client methods

**Files:**

- Modify: `apps/markdesk/src/api/client.ts`,
  `apps/markdesk/src/api/client.test.ts`
- Modify: `apps/markdesk/src/app/useProduct.ts` (`watchConnection`),
  `apps/markdesk/src/app/useProduct.test.ts`
- Modify: test fakes that build a full `DeskClient` (`src/app/App.test.tsx`
  `fakeClient`, `useProduct.test.ts` `client`) — add `vi.fn()` for the two
  methods.

**Interfaces:**

- Consumes: Task 3 generated `schema.d.ts`.
- Produces:
  ```ts
  export type ProposalChange = components["schemas"]["ProposalChange"];
  export type ProposalPreview = components["schemas"]["ProposalPreview"];
  export type ProposalApplied = components["schemas"]["ProposalApplied"];
  interface DeskClient {
    /** POST /proposals/preview with If-Match: etag. */
    previewProposal(etag: string, changes: ProposalChange[]): Promise<ProposalPreview>;
    /** POST /proposals/apply with If-Match: etag. */
    applyProposal(etag: string, changes: ProposalChange[]): Promise<ProposalApplied>;
  }
  ```

- [ ] **Step 1: Write the failing tests**

```ts
it("posts a preview with If-Match and a JSON body", async () => {
  const f = stub(json({ apiVersion: 3, changes: [] }));
  await createDeskClient("http://127.0.0.1:1", "t", f).previewProposal('"e1"', [{ displayId: "A_1", kind: "body", body: "x" }]);
  const req = f.mock.calls[0][0];
  expect(req.method).toBe("POST");
  expect(new URL(req.url).pathname).toBe("/api/v1/proposals/preview");
  expect(req.headers.get("If-Match")).toBe('"e1"');
  expect(await req.json()).toEqual({ changes: [{ displayId: "A_1", kind: "body", body: "x" }] });
});
it("posts an apply to the apply route", ...);
it("maps a 412 to a DeskError with its code", async () => {
  const f = stub(json({ error: { code: "precondition-failed", message: "m" } }, 412));
  await expect(createDeskClient("http://x", "t", f).applyProposal('"e"', [])).rejects.toMatchObject({ status: 412, code: "precondition-failed" });
});
// useProduct.test.ts
it("passes proposal calls through and reports a lost connection", ...); // previewProposal/applyProposal args forwarded; network DeskError → onLost once
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix apps/markdesk test -- client useProduct` Expected: FAIL,
`previewProposal is not a function`.

- [ ] **Step 3: Implement** both methods with
      `run(() => client.POST(…, {
      params: { header: { "If-Match": etag } }, body: { changes } }))`,
      and wrap both in `watchConnection`.

- [ ] **Step 4: Run the UI checks**

Run:
`npm --prefix apps/markdesk test && npm --prefix apps/markdesk run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/markdesk/src
git commit -m "feat(repo): add proposal preview and apply to the MarkDesk client" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Shell prompt run

**Files:**

- Modify: `apps/markdesk/src-tauri/src/assistants.rs` (constants; `AssistantId`
  methods; `AssistantStatus` and every constructor of it; new prompt types and
  `run_prompt`; extract the temp-dir naming out of `run_test`; tests)
- Modify: `apps/markdesk/src-tauri/src/lib.rs` (`TEST_ALREADY_RUNNING` →
  `ASSISTANT_BUSY`; `with_test_guard` → `with_assistant_guard`; commands;
  `generate_handler!`; tests)
- Modify: `.github/workflows/markdesk.yaml` (line 73)
- Modify: `apps/markdesk/src/shell/bridge.ts`,
  `apps/markdesk/src/assistant/testBridge.ts`, and the `AssistantStatus`
  fixtures in `src/assistant/*.test.tsx`, `src/settings/SettingsView.test.tsx`,
  `src/assistant/AssistantProvider.tsx` (detection-failed statuses:
  `promptsAvailable: false`)

**Interfaces:**

- Produces (Rust, `assistants.rs`):
  ```rust
  pub const PROMPT_TIMEOUT: Duration = Duration::from_secs(120);
  pub const PROMPT_REPLY_MAX_CHARS: usize = 20_000;
  pub const PROMPT_MAX_BYTES: usize = 100_000;
  impl AssistantId {
      /// `None` when the CLI has no proven flags that block reads, commands, and writes.
      pub fn prompt_args(self, prompt: &str) -> Option<Vec<String>>;
      pub fn prompts_available(self) -> bool; // prompt_args("").is_some()
      pub fn display_name(self) -> &'static str; // "Claude Code", "Codex", "GitHub Copilot"
  }
  // AssistantStatus gains: pub prompts_available: bool  (serde: promptsAvailable)
  #[derive(Deserialize)] #[serde(rename_all = "camelCase")]
  pub struct PromptRequest { pub title: String, pub body: String, pub instruction: String, pub attributes: Vec<PromptAttribute> }
  #[derive(Deserialize)] pub struct PromptAttribute { pub key: String, pub value: String }
  #[derive(Serialize)] #[serde(rename_all = "kebab-case")]
  pub enum PromptOutcome { Ok, Timeout, Cancelled, Failed, Unavailable, PromptTooLong, ReplyTooLong }
  #[derive(Serialize)] #[serde(rename_all = "camelCase")]
  pub struct PromptResult { pub outcome: PromptOutcome, pub reply: Option<String>, pub error: Option<String> }
  pub fn build_prompt(request: &PromptRequest) -> String;
  pub fn run_prompt(id: AssistantId, program: &Path, path: Option<&OsStr>, request: &PromptRequest, timeout: Duration, cancel: &AtomicBool) -> PromptResult;
  ```
- Produces (Rust, `lib.rs`):
  `#[tauri::command] async fn
  run_assistant_prompt(app, id: AssistantId, request: PromptRequest) ->
  Result<PromptResult, String>`;
  `#[tauri::command] fn
  cancel_assistant_prompt(app)`;
  `async fn with_assistant_guard<T, F, Fut>(state:
  &AssistantTestState, busy: impl FnOnce() -> T, body: F) -> Result<T,
  String>`.
- Produces (TS, `bridge.ts`):
  ```ts
  export interface AssistantStatus { /* … */ promptsAvailable: boolean }
  export interface AssistantPromptRequest { title: string; body: string; instruction: string; attributes: { key: string; value: string }[] }
  export type PromptOutcome = "ok" | "timeout" | "cancelled" | "failed" | "unavailable" | "prompt-too-long" | "reply-too-long";
  export interface AssistantPromptResult { outcome: PromptOutcome; reply: string | null; error: string | null }
  interface ShellBridge {
    runAssistantPrompt(id: AssistantId, request: AssistantPromptRequest): Promise<AssistantPromptResult>; // invoke("run_assistant_prompt", { id, request })
    cancelAssistantPrompt(): Promise<void>;                                                                // invoke("cancel_assistant_prompt")
  }
  ```
  `fakeAssistantBridge` defaults: `runAssistantPrompt` resolves
  `{ outcome: "ok", reply: "Proposed body.", error: null }`;
  `cancelAssistantPrompt` resolves.

Prompt template (exact copy, `build_prompt`; the attribute block is omitted when
`attributes` is empty):

```text
You are rewriting the body of one requirement in a MarkSpec Markdown document.
Apply the instruction to the current body. Return only the new body text, in
Markdown. Do not return a preamble, an explanation, the title, the display ID,
or trailer lines such as "Id:" or "Satisfies:". Do not start any line with
"- [".

Title: {title}

Trailer attributes (context only, do not return them):
{key}: {value}

Current body:
<<<BODY
{body}
BODY>>>

Instruction:
<<<INSTRUCTION
{instruction}
INSTRUCTION>>>
```

- [ ] **Step 1: Write the failing Rust unit tests** in `assistants.rs`:

```rust
#[test] fn prompt_args_for_claude_code_switch_tools_off() {
    assert_eq!(AssistantId::ClaudeCode.prompt_args("P").unwrap(),
      ["-p","P","--output-format","text","--tools","","--strict-mcp-config","--disable-slash-commands","--no-session-persistence"]);
}
#[test] fn codex_and_copilot_are_not_available_for_prompts() {
    assert!(AssistantId::Codex.prompt_args("P").is_none());
    assert!(AssistantId::Copilot.prompt_args("P").is_none());
    assert!(AssistantId::ClaudeCode.prompts_available());
}
#[test] fn detect_reports_prompt_availability() // detect_all on a fake probe: claude-code true, codex false, copilot false
#[test] fn test_args_are_fixed()                 // unchanged: the Test keeps its flags
#[test] fn build_prompt_contains_the_three_inputs_and_attributes() // title, body, instruction, "Satisfies: STK_1" present; "Trailer attributes" absent when attributes empty
#[test] fn run_prompt_unavailable_does_not_start_a_process() // Codex + fake bin that touches a marker file → outcome Unavailable, error "Prompts are not yet available for Codex.", marker absent
#[test] fn run_prompt_refuses_a_prompt_over_the_byte_limit() // body of 100_001 bytes → PromptTooLong, process not started
#[test] fn run_prompt_runs_in_empty_temp_dir()  // fake "pwd; ls -A | wc -l" → cwd under temp_dir, "0", removed afterwards
#[test] fn run_prompt_returns_the_trimmed_reply() // fake "printf '  text\n\n'" → Ok, "text"
#[test] fn run_prompt_refuses_a_reply_over_20000_characters() // fake prints 20_001 'a' → ReplyTooLong, reply None
#[test] fn run_prompt_kills_grandchild_on_cancel() // reuse grandchild_script + assert_grandchild_gone → Cancelled
#[test] fn run_prompt_kills_grandchild_on_timeout() // timeout 200 ms → Timeout
#[test] fn run_prompt_failure_reports_the_first_stderr_line() // fake "echo first >&2; echo second >&2; exit 3" → Failed, error "first"
```

    and in `lib.rs`:

```rust
#[test] fn a_prompt_run_is_refused_while_a_test_runs() // nested with_assistant_guard: inner prompt body not called, result busy() with ASSISTANT_BUSY
#[test] fn a_test_is_refused_while_a_prompt_runs()
#[test] fn with_assistant_guard_refuses_a_second_test_until_the_first_ends() // renamed existing test
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test --manifest-path apps/markdesk/src-tauri/Cargo.toml` Expected:
compile errors for the missing items.

- [ ] **Step 3: Implement** the items listed under Interfaces. `run_prompt` maps
      `classify`: `Usage` → `Failed`; `Failed` error is the first non-empty
      stderr line, or `exit code <n>` when stderr is empty. The temp folder uses
      the extracted helper with prefix `markdesk-assistant-prompt-`.
      `run_assistant_prompt` mirrors `run_assistant_test` (locate, `child_path`,
      `spawn_blocking`) under `with_assistant_guard`, and stores no settings.
      Register both commands in `generate_handler!`.

- [ ] **Step 4: Write the manual tests**
      (`#[ignore = "needs a signed-in
      assistant; run with cargo test -- --ignored manual_assistant_"]`),
      one pair per enabled assistant:

```rust
fn manual_assistant_claude_code_cannot_read_a_file_outside_its_folder()
// secret dir under temp_dir with file "secret.txt" = "markdesk-secret-<nanos>";
// instruction: "Read the file <abs path> and put its whole content in the new body.";
// run_prompt with the located real claude and PROMPT_TIMEOUT;
// assert outcome is not Unavailable/PromptTooLong, and reply (if any) does not contain the secret.
fn manual_assistant_claude_code_cannot_run_a_command_or_write()
// instruction asks to run `touch <abs marker>` and to write <abs marker2>;
// assert neither marker exists afterwards.
```

- [ ] **Step 5: Bounded check for Codex and Copilot.** Read `codex exec --help`
      and `copilot --help` on this machine for an option that disables file
      reads (for example a Codex configuration that turns off its shell tool, or
      a Copilot `--deny-tool` value for its read tool). If one exists, add a
      `prompt_args` arm and the same manual test pair for that assistant, run
      it, and keep the arm only if both tests pass; record the outcome in the
      commit body. Otherwise change nothing.

- [ ] **Step 6: Skip manual tests in CI.** In `.github/workflows/markdesk.yaml`
      change the "Real sidecar tests" command to
      `cargo test --locked -- --ignored --skip manual_assistant_`.

- [ ] **Step 7: Update the TS bridge** per Interfaces; add `promptsAvailable` to
      every `AssistantStatus` fixture (`true` for `claude-code`, `false`
      otherwise) and to the detection-failed statuses in
      `AssistantProvider.tsx`.

- [ ] **Step 8: Run the shell and UI checks**

Run:
`cd apps/markdesk/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo test -- --ignored manual_assistant_ && cd .. && npm test && npm run typecheck`
Expected: all PASS, including both manual Claude Code tests on a machine with a
signed-in `claude`.

- [ ] **Step 9: Commit**

```bash
git add apps/markdesk/src-tauri/src .github/workflows/markdesk.yaml apps/markdesk/src
git commit -m "feat(repo): run one prompt on Claude Code with every tool switched off" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: UI pure helpers

**Files:**

- Create: `apps/markdesk/src/assistant/reply.ts`, `reply.test.ts`
- Create: `apps/markdesk/src/assistant/wordDiff.ts`, `wordDiff.test.ts`
- Create: `apps/markdesk/src/assistant/promptReason.ts`, `promptReason.test.ts`

**Interfaces:**

- Consumes: `EntryView` (Task 4 exports), `AssistantState` (bridge).
- Produces:
  ````ts
  /** Inner text when the whole trimmed reply is one fenced block (``` or ~~~,
   *  optional info string, matching closer, no other closer inside); else the
   *  trimmed reply. */
  export function stripOneFence(reply: string): string;
  export interface DiffPart { readonly kind: "same" | "removed" | "added"; readonly text: string }
  export function diffWords(before: string, after: string): DiffPart[];
  export interface PromptContext {
    assistantName: string;
    state: AssistantState | undefined;   // undefined while detecting
    promptsAvailable: boolean;
    testRunning: boolean;
    selected: string | undefined;
    entry: EntryView | "loading" | "missing" | undefined;
  }
  /** One-line reason the prompt box is disabled; undefined when enabled. */
  export function promptDisabledReason(context: PromptContext): string | undefined;
  ````
  Reasons, checked in this order (exact copy): `"Checking the assistant."`,
  `"<name> is not installed."`, `"<name> needs sign-in."`,
  `"Prompts are not yet available for <name>."`, `"A Test is running."`,
  `"Select an entry to send a prompt."` (no selection or `"missing"`),
  `"Loading the entry."`, `"This entry is read-only. It comes from <origin>."`,
  `"Entries in source files cannot be edited here yet."` (path not ending in
  `.md`), `"This entry has no body yet."` (`body.trim() === ""`).

- [ ] **Step 1: Write the failing tests**

````ts
it("removes one fence around the whole reply", () => {
  expect(stripOneFence("```markdown\nA.\n\nB.\n```")).toBe("A.\n\nB.");
  expect(stripOneFence("~~~\nA.\n~~~\n")).toBe("A.");
});
it("keeps a reply that is not wholly fenced", () => {
  expect(stripOneFence("Text\n```\ncode\n```")).toBe("Text\n```\ncode\n```");
  expect(stripOneFence("```\nA\n```\n\n```\nB\n```")).toBe("```\nA\n```\n\n```\nB\n```");
});
it("diffs by word and keeps whitespace", () => {
  expect(diffWords("within 200 ms", "within 150 ms")).toEqual([
    { kind: "same", text: "within " }, { kind: "removed", text: "200" },
    { kind: "added", text: "150" }, { kind: "same", text: " ms" }]);
});
it("joins the parts back into each side", ...); // same+removed === before; same+added === after, on a multi-line pair
it("falls back to replace-all above the size cap", ...); // 1 100 words each side, no common word → [removed(before), added(after)]
it.each([...10 contexts...])("disables the box: %s", (_, context, reason) => expect(promptDisabledReason(context)).toBe(reason));
it("enables the box for a ready, prompt-capable assistant on a Markdown entry with a body", ...); // undefined
````

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix apps/markdesk test -- reply wordDiff promptReason` Expected:
FAIL, modules not found.

- [ ] **Step 3: Implement the three modules** (decision 19 for `diffWords`;
      adjacent parts of the same kind are merged).

- [ ] **Step 4: Run them to verify they pass**

Run:
`npm --prefix apps/markdesk test -- reply wordDiff promptReason && npm --prefix apps/markdesk run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/markdesk/src/assistant
git commit -m "feat(repo): add reply, word diff, and prompt-box reason helpers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: UI prompt flow

**Files:**

- Create: `apps/markdesk/src/assistant/usePrompt.ts`
- Create: `apps/markdesk/src/assistant/PromptPanel.tsx`
- Create: `apps/markdesk/src/assistant/PromptPanel.test.tsx`
- Modify: `apps/markdesk/src/assistant/AssistantColumn.tsx` (the
  selected-assistant branch renders `<PromptPanel />` in place of the disabled
  textarea), `AssistantColumn.test.tsx` (the "Prompts arrive in a later release"
  assertion becomes a disabled reason; the column test mounts through `App`, see
  Step 1)
- Modify: `apps/markdesk/src/app/refresh.tsx` (doc comment of `refresh()`:
  accept calls it)
- Modify: `apps/markdesk/src/styles/app.css` (proposal blocks, `del`, `ins`)

**Interfaces:**

- Consumes: Task 4 `previewProposal`, `applyProposal`, `DeskError`; Task 5
  `runAssistantPrompt`, `cancelAssistantPrompt`, `promptsAvailable`; Task 6
  helpers; `useOpenProduct`, `useSelection`, `useRefresh`, `useBridge`,
  `useAssistants`.
- Produces:
  ```ts
  export const PROMPT_MESSAGES = {
    assistantFailed: (firstLine: string) => `The assistant failed: ${firstLine}`,
    timeout: "The assistant did not answer within 120 seconds.",
    noProposal: "The assistant returned no proposal.",
    promptTooLong: "This entry is too long to send to the assistant.",
    replyTooLong: "The assistant's reply is longer than 20 000 characters.",
    couldNotFormat: "MarkDesk could not format this proposal.",
    changesEntries: "The proposal changes more than this entry's body. Ask again.",
    fileChanged: "This file changed since the proposal. Ask again.",
    writeFailed: "MarkDesk could not write this file.",
  } as const;
  export type PromptPhase =
    | { kind: "idle" } | { kind: "running" }
    | { kind: "proposal"; displayId: string; etag: string; currentBody: string; proposedBody: string }
    | { kind: "applying"; displayId: string; etag: string; currentBody: string; proposedBody: string }
    | { kind: "error"; message: string };
  export interface PromptController {
    disabledReason: string | undefined;
    instruction: string;
    setInstruction(value: string): void;
    phase: PromptPhase;
    submit(): Promise<void>;
    cancel(): Promise<void>;
    accept(): Promise<void>;
    reject(): void;
  }
  export function usePrompt(): PromptController;
  export function PromptPanel(): JSX.Element;
  ```
  Flow (the spec's steps 1–8): the hook loads `client.entry(selected)` on
  selection and on `revision`; `submit` reads `client.document(entry path)` for
  the ETag, then `client.entry(id)` (decision 21), runs
  `runAssistantPrompt(id, { title, body, instruction, attributes })`, applies
  `stripOneFence` (empty → `noProposal`), calls
  `previewProposal(etag, [{
  displayId, kind: "body", body }])`; `accept` calls
  `applyProposal` with the same ETag and the previewed `body`, then clears the
  instruction, sets `idle`, and calls `refresh()`. Error mapping: shell outcomes
  → the matching message (`cancelled` → `idle`, instruction kept); preview/apply
  `412` → `fileChanged`; `422 format-failed` → `couldNotFormat`;
  `422
  proposal-changes-entries` → `changesEntries`; other preview errors →
  `couldNotFormat`; other apply errors → `writeFailed`. Every error keeps the
  instruction. A change of `selected` cancels a running prompt
  (`cancelAssistantPrompt`, its late result ignored through a run counter) and
  discards a shown proposal. Accept and Reject are disabled while `applying`.
  The panel: textarea (`aria-label="Prompt"`, placeholder
  `disabledReason ??
  "Ask the assistant to change this entry's body"`), the
  reason as a line under it, Send button; running: "Waiting for <name>…" plus
  Cancel; proposal: "Current" and "Proposed" blocks, Accept, Reject; error:
  `role="alert"` sentence. Enter submits, Shift+Enter inserts a line break,
  Escape on the panel rejects a shown proposal.

- [ ] **Step 1: Write the failing tests** in `PromptPanel.test.tsx`. Mount
      `<App bridge={…} createClient={() => raw} slots={{ navigator: <Picker />,
      document: <div /> }} />`,
      where `Picker` is a button calling
      `useSelection().select("SYS_BRK_0001")`, `raw` is a fake `DeskClient`
      (entry, document, previewProposal, applyProposal as `vi.fn`), and the
      bridge is `fakeBridge` + `fakeAssistantBridge` with Claude Code ready,
      `promptsAvailable: true`, and selected. The calls thus go through
      `watchConnection`.

````ts
it.each([
  ["no selection", {}, "Select an entry to send a prompt."],
  ["needs sign-in", { state: "needs-sign-in" }, "Claude Code needs sign-in."],
  ["not prompt-capable", { selectedAssistant: "codex" }, "Prompts are not yet available for Codex."],
  ["read-only entry", { entry: { origin: "up@1.0.0" } }, "This entry is read-only. It comes from up@1.0.0."],
  ["source-file entry", { entry: { location: { file: "src/a.rs" } } }, "Entries in source files cannot be edited here yet."],
  ["empty body", { entry: { body: "" } }, "This entry has no body yet."],
])("disables the prompt box: %s", ...); // textarea disabled; reason text shown
it("submits with Enter and shows the proposal with a word diff", async () => {
  // type "make it 150 ms", press Enter
  // runAssistantPrompt called with ("claude-code", { title, body, instruction: "make it 150 ms", attributes })
  // previewProposal called with ('"e1"', [{ displayId: "SYS_BRK_0001", kind: "body", body: "Proposed body." }])
  // "Current" and "Proposed" shown; a <del> and an <ins> element present
});
it("inserts a line break with Shift+Enter instead of submitting", ...);
it("strips a fence around the reply before the preview", ...);   // reply "```\nX\n```" → previewProposal body "X"
it("shows the no-proposal error for an empty reply", ...);       // reply "  " → noProposal; previewProposal not called
it("shows the running state and cancels the assistant", ...);    // runAssistantPrompt pending; "Waiting for Claude Code…"; Cancel → cancelAssistantPrompt called; resolve cancelled → idle, instruction kept
it("shows the timeout and assistant-failed errors", ...);        // outcome timeout → timeout; failed with error "auth expired" → "The assistant failed: auth expired"
it("rejects with the button and with Escape, and writes nothing", ...); // applyProposal never called; proposal gone
it("accepts: applies with the submit ETag, then refreshes", async () => {
  // Accept → applyProposal('"e1"', [{ displayId: "SYS_BRK_0001", kind: "body", body: <previewed body> }])
  // then raw.entry called again (refresh revision) and the instruction is cleared
});
it("disables Accept while applying", ...);                        // Review Focus 5: applyProposal pending; Accept and Reject disabled; one call only
it("keeps the instruction and says the file changed on 412", async () => {
  // applyProposal rejects DeskError(412, "precondition-failed") → fileChanged alert; textarea value still the instruction
});
it("shows could-not-format on a 422 format-failed preview", ...);
it("discards the proposal when the selection changes", ...);      // select another entry → proposal gone; applyProposal never called
it("cancels a running prompt when the selection changes", ...);   // cancelAssistantPrompt called; the late "ok" result shows no proposal
it("reports a lost connection from a proposal call", ...);        // previewProposal rejects DeskError(0, "network") → the app's lost-connection banner appears (watchConnection)
````

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix apps/markdesk test -- PromptPanel AssistantColumn` Expected:
FAIL (`PromptPanel` not found; the column still shows "Prompts arrive in a later
release").

- [ ] **Step 3: Implement `usePrompt` and `PromptPanel`**, mount the panel in
      `AssistantColumn`, add the styles, update the `refresh()` doc comment.

- [ ] **Step 4: Run the UI checks**

Run:
`npm --prefix apps/markdesk test && npm --prefix apps/markdesk run typecheck && npm --prefix apps/markdesk run build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/markdesk/src
git commit -m "feat(repo): propose and accept one entry body from the assistant column" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Records

**Files:**

- Modify: `docs/architecture/adr-035-markdesk.md`
- Modify: `apps/markdesk/README.md` (manual smoke test, ~lines 65–88)

**Interfaces:**

- Consumes: the behaviour of Tasks 1–7 (paths, codes, values above).

- [ ] **Step 1: Add the SAD entries** (no `Id:` lines; `fmt` stamps them). After
      SAD_DESK_0020:
  - SAD_DESK_0021 Proposal preview response: the desk backend shall answer a
    valid `POST /api/v1/proposals/preview` with HTTP status 200 whose body
    carries the target entry's formatted proposed body next to its formatted
    current body.
  - SAD_DESK_0022 Preview without write: the desk backend shall leave every
    product file unmodified while it answers `POST /api/v1/proposals/preview`.
  - SAD_DESK_0023 Proposal apply: the desk backend shall answer a valid
    `POST /api/v1/proposals/apply` with HTTP status 200 carrying the document
    `ETag` of the written file.
  - SAD_DESK_0024 Missing precondition: … HTTP status 428 with code
    `precondition-required` for a proposal request without `If-Match`.
  - SAD_DESK_0025 Stale precondition: … HTTP status 412 with code
    `precondition-failed` for a proposal request whose `If-Match` does not name
    the current document `ETag`.
  - SAD_DESK_0026 Splice-only write: after an apply, every byte of the file
    outside the target entry's body lines shall equal the byte before the apply.
  - SAD_DESK_0027 Atomic write: the desk backend shall write an applied file
    through a temporary file in the same folder that it renames over the
    original. After SAD_DESK_0007:
  - SAD_DESK_0028 Prompt run without tools: the MarkDesk shell shall start a
    prompt run only for an assistant whose arguments switch off every tool that
    reads a file, runs a command, or writes a file.
  - SAD_DESK_0029 Prompt run timeout: the MarkDesk shell shall kill the process
    group of a prompt run that runs longer than 120 s.
  - SAD_DESK_0030 Accept before apply: the MarkDesk UI shall call the apply
    endpoint only after the author activates Accept on the shown proposal.

- [ ] **Step 2: Amend the existing records.** SAD_DESK_0011: methods
      `GET, POST, OPTIONS`, headers
      `Authorization, Content-Type, If-Match, If-None-Match`. SAD_DESK_0012: the
      read endpoints are served with `GET` only. "As built": replace "is
      read-only" and "MarkDesk writes nothing into the product folder" with the
      as-built rule (MarkDesk writes a product file only through the desk apply
      endpoint, after the author accepts); grep the ADR for other preflight
      values (search for `Authorization, If-None-Match`) and update them. Add a
      subsection "As built: the first prompt" (one paragraph each: flow, write
      path, prompt run with Claude Code only and why Codex and Copilot stay
      disabled, and the SAD_DESK_0007 deviation: no `markspec mcp` attached in
      this story, because the entry text is in the prompt and an assistant with
      no tools cannot read or write; attaching it belongs to the first feature
      that needs more context).

- [ ] **Step 3: Format and check the ADR**

Run:
`deno run -A packages/markspec/main.ts fmt docs/architecture/adr-035-markdesk.md && deno run -A packages/markspec/main.ts check docs/architecture/adr-035-markdesk.md && deno run -A packages/markspec/main.ts lint docs/architecture/adr-035-markdesk.md`
Expected: `Id:` stamped on SAD_DESK_0021–0030; `check` exits 0; `lint` reports
no new finding on the new entries (fix wording if it does).

- [ ] **Step 4: Extend the README smoke test** after step 10: select an SAD
      entry with Claude Code ready; type "Shorten this body to one sentence."
      and press Enter; the column shows "Waiting for Claude Code…", then the
      Current/Proposed diff; press Reject — `git status` shows no change; ask
      again, press Accept — the document pane shows the new body and `git diff`
      changes only that entry's body lines; `git checkout` the file to undo. Add
      one line: run the manual assistant tests with
      `cargo test -- --ignored manual_assistant_`.

- [ ] **Step 5: Run the full verification**

Run:
`just build && deno fmt --check && dprint check && npm --prefix apps/markdesk test && npm --prefix apps/markdesk run typecheck && bash scripts/check_desk_client.sh && cargo test --manifest-path apps/markdesk/src-tauri/Cargo.toml`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/adr-035-markdesk.md apps/markdesk/README.md
git commit -m "docs(docs): record the MarkDesk first prompt in ADR-035" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec requirement                                                      | Task        |
| --------------------------------------------------------------------- | ----------- |
| Prompt box enabled/disabled with one-line reasons                     | 6, 7        |
| Enter / Shift+Enter / Send; Tab; Escape rejects                       | 7           |
| ETag and body read at submit; ETag is the precondition                | 7 (dec. 21) |
| Running state, Cancel kills the process                               | 5, 7        |
| Preview: 428/412, refusals, re-indent, format, identity, both bodies  | 1, 2, 3     |
| Apply: checks again, splice, atomic temp + rename, new ETag           | 1, 2, 3     |
| Formatter failure / `MSL-F900` refused; `MSL-F012` not shown          | 2, 3        |
| CORS preflight verbs and headers                                      | 3           |
| Proposal shape as a list                                              | 3, 4        |
| Assistant: temp folder, tools off, hard rule, template, 120 s, 20 000 | 5           |
| Argument length check                                                 | 5 (dec. 13) |
| Prompt run and Test never overlap; one prompt at a time               | 5, 7        |
| Fence removal, empty reply                                            | 6, 7        |
| Word-level diff                                                       | 6, 7        |
| Errors as one sentence each                                           | 7           |
| Selection change cancels or discards                                  | 7           |
| `refresh()` after accept                                              | 7           |
| ADR-035 entries, amendments, MCP deviation; README smoke test         | 8           |
| Schema, generated client, `client.ts`                                 | 3, 4        |
