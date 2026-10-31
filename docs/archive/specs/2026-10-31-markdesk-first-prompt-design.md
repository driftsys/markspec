# MarkDesk first prompt feature: propose and accept one entry body (#837)

Epic #826. Story #837. Status: design approved by the product owner on
2026-10-31.

## Intent

MarkDesk can detect, select, and test an AI assistant (#831), but the author
cannot ask it anything yet. This story adds the first prompt feature and the
first write path of MarkDesk. The author selects one requirement, types an
instruction such as "make this measurable", reads the proposed new text, and
accepts or rejects it. Nothing is written until the author accepts.

The feature is small on purpose. It proves the propose and accept flow and the
first write path on the simplest case, so that later prompt features (new
entries, splits, whole documents) reuse both instead of inventing their own.

## Decisions made by the product owner

1. **Scope of a proposal: the body of one entry.** The assistant proposes a new
   body for the selected entry. The title, the `Id:` line, and the trailer
   attributes do not change. Reason: a proposal of one paragraph can be checked
   in seconds, so "the author accepts" stays meaningful; a wrong accept is easy
   to see and to fix.
2. **The writer: a write endpoint on the desk server**
   (`markspec desk --serve`). The Tauri shell does not write product files, and
   the assistant CLI never writes. Reason: one writer, which reuses the server's
   loopback, token, Origin, and path-inside-root checks, and which can format
   the result before anything reaches the disk.

Fixed earlier by ADR-035 (SAD_DESK_0007) and by #837's acceptance criteria:

- Agents only propose. MarkDesk writes only on the author's explicit accept.
- Every write passes `markspec fmt`. The author does not see a separate format
  step, button, or message. A formatter problem is shown only when it blocks the
  write.
- A rejected proposal writes nothing.

## Goals

- An enabled prompt box in the assistant column when an assistant is ready and a
  writable entry is selected.
- A proposal shown as the current body next to the proposed body, already
  formatted, with Accept and Reject.
- On accept: one atomic write of the entry's file in which only the target
  entry's body changes, then a refresh of the navigator and the document through
  the shared `refresh()` from #846.

## Non-goals (for this story)

- New entries, splitting an entry, changing a title or trailers, or editing a
  whole document. The proposal data shape must allow these later (see "Proposal
  shape").
- Entries in source files (doc comments), and entries with an `origin`
  (delivered corpus or upstream). These are refused.
- A multi-turn conversation, streaming output, or a history of prompts.
- Undo inside MarkDesk. Git keeps the history.
- Attaching the MarkSpec MCP server to the assistant. See "Assistant call".
- Windows-specific work (#838).

## Anti-goals (a failure even if it works)

- Any byte of the product folder written without an accept.
- Any change outside the target entry's body in the written file, including
  formatting changes to other entries or to prose.
- The assistant process able to write, run shell commands, or read the product
  folder.
- An accept that overwrites an edit the author made in another application after
  the proposal was shown.

## The flow

1. The author selects an entry. If it is a project entry in a `.md` file with a
   non-empty body, and the selected assistant's status is ready, the prompt box
   is enabled. Otherwise the box is disabled with a one-line reason (no
   assistant, assistant needs sign-in, read-only entry, entry in a source file,
   entry has no body yet).
2. The author types an instruction and submits it (Enter submits, Shift+Enter is
   a new line; a Send button does the same). At submit, the UI reads the entry's
   current body and the document ETag from the server. That body goes into the
   prompt, and that ETag is the precondition for the whole proposal.
3. The column shows a running state with a Cancel button. Cancel stops the
   assistant process.
4. When the assistant returns text, the UI asks the desk server to prepare the
   proposal (the "preview" operation below), with the ETag from step 2 as
   `If-Match`. If the file changed during the assistant run, preview refuses
   (412) and the column shows the step 8 message. Otherwise the server returns
   the formatted proposed body and the current body.
5. The column shows the proposal: the current body returned by preview and the
   proposed body, with the changed words or lines marked, plus Accept and
   Reject.
6. Reject removes the proposal. Nothing is written.
7. Accept sends the proposal to the desk server (the "apply" operation below)
   with the same ETag from step 2. On success the column clears the proposal and
   calls `refresh()`; the document pane shows the new text.
8. If the file changed after step 2, the server refuses; the column says "This
   file changed since the proposal. Ask again." and keeps the instruction in the
   box so the author can resubmit it.

A proposal belongs to one entry. If the author selects another entry while a
prompt runs or a proposal is shown, the run is cancelled or the proposal is
discarded, without writing.

Only one prompt runs at a time.

## Desk API: the write path

Two new operations on the desk server. Exact paths, verbs, and field names are
the builder's choice, within these rules; `schemas/desk-api.json`, the generated
client, and `api_test.ts` are updated together, as for every desk API change.

**Preview** (no write): input is a display ID, a proposed body text, and the
document ETag from submit time as `If-Match`. The server:

- answers 428 when `If-Match` is missing, and 412 when it does not name the
  current document ETag, so a proposal is never built on a body the assistant
  did not see;
- refuses an unknown entry (404), an entry with an `origin`, an entry outside a
  `.md` file, or an entry with an empty body (a 4xx with a distinct error code
  each);
- builds the candidate file text: the current file with the target entry's body
  replaced by the proposed body (re-indented to the entry's body indent);
- runs the same formatter as `markspec fmt` on the candidate, with the Markdown
  prose formatter, and takes from the result only the target entry's body;
- checks that the candidate parses with the same entries, in the same order,
  with the same display IDs and `Id:` values as the current file (the proposed
  body must not create, remove, or rename an entry, for example by adding a
  `- [X_0001]` line);
- returns the formatted proposed body and the current body, formatted the same
  way, so the diff compares like with like.

**Apply** (writes): input is the display ID, the formatted body from preview,
and the ETag as an `If-Match` header. The server:

- answers 428 when `If-Match` is missing, and 412 when it does not name the
  current document ETag;
- repeats every check of preview on the current file;
- splices the formatted body into the current file text in place of the target
  entry's body and leaves every other byte of the file unchanged, including
  other entries, prose, front matter, and line endings;
- writes the result to a temporary file in the same folder and renames it over
  the original, so a reader never sees a partial file;
- answers with the new document ETag.

Why splice instead of writing the formatter's whole output: `markspec fmt`
formats the whole document, so on a file that was not already formatted it would
also change text the author never saw in the proposal. Splicing keeps the
repository rule that a write changes only the targeted entry block.

Formatter failure: if formatting the candidate fails, or the equivalence guards
of the formatter keep the original body (`MSL-F900`), preview refuses with an
error the column shows as "MarkDesk could not format this proposal." An
`MSL-F012` fallback (dprint polish rejected, canonical body kept) is not a
failure and is not shown.

CORS: the preflight must allow the new verb or verbs and the `If-Match` and
`Content-Type` request headers. SAD_DESK_0011 is amended. Every other check
(loopback Host, Origin allowlist, bearer token, real path inside the real root)
applies to the new operations unchanged.

The ETag precondition uses the existing document tag. That tag also changes when
an entry is added to or removed from any file, so a write can be refused after
an unrelated change elsewhere. This is accepted: the author resubmits, and no
edit is lost.

## Assistant call

A new Tauri command runs the selected assistant with the author's instruction,
next to the existing Test path (`assistants.rs`, `lib.rs`), and reuses its
machinery: program lookup, process group, cancel flag, timeout, output capture.

- The assistant runs headless, in a fresh empty temporary folder, never the
  product folder, with flags that switch off every tool that can read a file,
  run a command, or write.
- **Hard rule (product owner decision):** a prompt run is enabled only for an
  assistant whose flags are proven, by a test in the shell, to block all file
  reads, shell commands, and writes. Claude Code with `--tools ""` qualifies.
  The Test's flags for Codex (`--sandbox read-only`) and Copilot
  (`--deny-tool shell --deny-tool write`) are not proven to block file reads.
  The builder looks for flags or configuration that do (for example a Codex
  configuration that disables its shell tool, or a Copilot flag that denies its
  read tool) and proves them by a test that asks the assistant to read a known
  file outside the working folder and checks that the reply does not contain its
  content. An assistant without proven flags keeps its prompt box disabled with
  the reason "Prompts are not yet available for <assistant>." The Test keeps its
  current flags.
- The prompt is built by the shell from a fixed template plus three inputs: the
  entry's title, the entry's current body, and the author's instruction. The
  trailer attributes may be included as read-only context. The template tells
  the assistant to return only the new body text, with no preamble, explanation,
  title, or trailer lines. The template wording is the builder's choice.
- The prompt reaches the CLI the same way the Test prompt does (an argument).
  The builder checks the argument length limit of each CLI and of the OS and, if
  needed, uses standard input instead.
- Timeout: 120 seconds. Cancel: the same process-group kill as the Test.
- Output: stdout as UTF-8 text. The UI removes one code fence if the whole reply
  is wrapped in one. An empty reply is an error ("The assistant returned no
  proposal."). A reply over 20 000 characters is refused.
- The Test and a prompt run cannot run at the same time.

Not attaching the MarkSpec MCP server is a deliberate deviation from the wording
of SAD_DESK_0007 for this story. The entry text is in the prompt, so the
assistant needs no tool access, and an assistant with no tools cannot write or
read anything. Attaching `markspec mcp` (read-only) belongs to the first feature
that needs context beyond one entry. ADR-035 records the deviation.

## Proposal shape

The UI and the desk API describe a proposal as a list of changes, each one
`{ displayId, kind: "body", body }`. This story only ever sends a list of one
change of kind `body`. A later story adds kinds (new entry, title) without
changing the accept flow. The builder may implement the single case directly as
long as the wire format is the list.

## UI details

- The prompt box, running state, proposal, and errors live in the assistant
  column. The document pane does not change until accept.
- The before and after view is a word-level diff of the body text. The builder
  chooses the diff method; a small dependency is acceptable if its license is
  MIT, BSD, or Apache-2.0.
- Errors shown in the column, each as one sentence: assistant failed (with the
  first line of its error), timeout, no proposal, could not format, file
  changed, write failed.
- Keyboard: the prompt box, Accept, and Reject are reachable by Tab; Escape
  rejects a shown proposal.

## Records to change

- ADR-035: new SAD_DESK entries (next free number is SAD_DESK_0021) for the
  preview operation, the apply operation, the `If-Match` precondition, the
  splice-only write, the atomic write, the prompt run in the shell, and the
  proposal flow in the UI. Each entry states one requirement.
- ADR-035: amend SAD_DESK_0011 (preflight methods and headers) and SAD_DESK_0012
  (endpoint list); update the "As built" text that says MarkDesk writes nothing
  into the product folder; record the MCP deviation above.
- `schemas/desk-api.json`, `apps/markdesk/src/api/schema.d.ts` (generated),
  `apps/markdesk/src/api/client.ts`.
- `apps/markdesk/README.md`: the manual smoke test gains one prompt, one accept,
  and one reject.

## Tests the builder must include

- Desk API: preview and apply on a fixture; a 412 after the file text changes; a
  428 without `If-Match`; refusal of an `origin` entry, a source-file entry, an
  unknown ID, and a body that adds an entry line; a file whose other entries are
  deliberately unformatted keeps every byte outside the target body after apply;
  CRLF line endings are kept; the preflight allows the new verb and headers.
- Shell (Rust): the argument list per assistant has tools off; an assistant
  without proven read-blocking flags is reported as not available for prompts;
  an ignored (manual) test per enabled assistant proves it cannot read a file
  outside its working folder; the working folder is a fresh temporary folder,
  cancel and timeout kill the process group, a prompt run and a Test cannot
  overlap.
- UI (Vitest): the box is disabled for each disabled reason; submit, cancel,
  proposal shown, reject writes nothing, accept calls apply with the ETag and
  then `refresh()`, the 412 message keeps the instruction, a selection change
  discards the proposal. Tests go through the wrapped client the app uses
  (`watchConnection`), not only a raw fake.

## Calls made by the designer, not by the product owner

- The precondition covers the whole proposal: the ETag is taken when the prompt
  is submitted and is checked by both preview and apply. Reason: an edit made in
  another application during the assistant run must not be lost (anti-goal 4).
- Entries with an empty body are out of scope; the prompt box says "This entry
  has no body yet." Reason: inserting a body has no existing range to replace
  and needs its own placement rules. A later story can add it.

## Left to the builder

- Endpoint paths, verbs, and field names, within the rules above.
- The prompt template wording.
- The diff method and its presentation.
- How the body range is found in the file (the formatter's
  `findAttributeBlockRange` and `findItemEnd` helpers are candidates).
- The order of implementation tasks.

## Alternatives considered

- **Whole-document proposals.** More flexible, but a long diff turns accept into
  a review task, and authors start to accept without reading.
- **A new entry under the selected one.** Common, but it needs ID minting and
  placement rules; it comes as the next prompt feature on the same flow.
- **The Tauri shell writes the file.** A second writer with its own path checks
  in Rust, and a write followed by a separate `markspec fmt` run would leave an
  unformatted file on disk when formatting fails.
- **The assistant CLI writes the file.** Breaks "agents only propose", and text
  inside product files could steer the agent into other writes.
- **Writing the formatter's whole output.** Would reformat text outside the
  proposal on files that were not already formatted.
- **A content hash of the file as the precondition instead of the document
  ETag.** Fewer refusals after unrelated changes, but a second tag format; the
  existing tag is good enough for one author.

## Related

- ADR-035 SAD_DESK_0007 (propose, accept, fmt), SAD_DESK_0011, SAD_DESK_0012,
  SAD_DESK_0013 (document ETag), and SAD_DESK_0016 to SAD_DESK_0020 (refresh).
- #831 / PR #839 (assistant setup and the Test path), #846 (`refresh()`).
