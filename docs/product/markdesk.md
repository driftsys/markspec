# MarkDesk

**Status:** Founding document (2026-10-10). **Architecture:**
[ADR-035](../architecture/adr-035-markdesk.md). **Persona and journeys:**
[Authoring experience](../spec/internal/markspec-authoring-experience.md) §4.

MarkDesk is the desk where requirements get written. It is a desktop app for the
people who own what a product must do — product owners, business analysts,
safety engineers, architects — who share the profile of **Marie**, the persona
in the authoring-experience spec: fluent in the domain, not a coder, with a
WYSIWYG mindset. MarkDesk lets her author traced, compliant MarkSpec
requirements without learning Markdown, Git, or MarkSpec syntax.

MarkDesk is not a second VS Code. Engineers keep their editor, the LSP, and the
CLI. MarkDesk is a different door into the same repository, and everything it
produces is indistinguishable from what an engineer would have written by hand.

## Part 1 — Manifesto

MarkSpec's founding principle is _Markdown stays pure, tooling does the heavy
lifting_. The files are plain CommonMark that renders anywhere and diffs
cleanly; the toolchain stamps identifiers, normalizes layout, checks
traceability, and builds the outputs. MarkDesk takes that principle to its
conclusion: if the tooling really does the heavy lifting, the author need not
know the files are Markdown at all. The Markdown is still there, still pure,
still the truth — MarkDesk simply stops asking the author to carry it.

### 1. The domain is the interface

Marie thinks in stakeholder needs, system requirements, software requirements,
hazards, and the tests that prove them. She does not think in folders, files, or
line numbers. So the navigator shows the **product**: stakeholder needs at the
top, the system requirements that satisfy them beneath, software requirements
beneath those, hazards with the safety requirements derived from them, and tests
hanging under what they verify. The tree is the traceability graph read
top-down, typed by the active profile. The repository layout is an
implementation detail — it is never the first thing she sees, and she never has
to decide which file a requirement belongs in unless she wants to.

### 2. Discipline is enforced by the tool, never taught

Every rule MarkSpec knows — the next free identifier, the required attributes of
a type, which entries a `Satisfies` link may point at, the closed set of labels,
the ULID that must never be forged — is something MarkDesk applies, not
something Marie learns. The entry form only offers values the profile allows. A
link picker only lists valid targets. Identifiers appear already numbered. If a
rule cannot be expressed as a constraint on the form, it surfaces as a plain
finding with a fix attached. Training material that explains MarkSpec syntax to
an author is a sign that MarkDesk has failed.

### 3. Git is a verb, not a noun

Marie never sees a branch, a commit, a staging area, or a remote. She has one
action: **propose**. Proposing turns her work into a branch, a commit with a
sensible message, a push, and a merge or pull request on the forge — in one
step, with a title and a sentence of description as the only input. Pulling
others' changes happens on its own. Conflicts are the one place Git can leak
through; when it does, MarkDesk explains it in terms of the requirement both
people edited, and offers to hand it to an engineer.

### 4. Errors speak the author's language

A diagnostic code like `MSL-T020` is for engineers and logs. Marie reads
sentences about her requirement: "This system requirement doesn't say which
stakeholder need it satisfies", "ASIL-E isn't a level this project uses — did
you mean ASIL-D?". Every finding names the entry, says what is wrong in domain
terms, and — where the fix is mechanical — offers it as one click. The rule code
is still there, one click away, for the engineer she forwards the question to.

### 5. The technical layer is always one click away — and always the truth

Nothing in MarkDesk is a second model of the requirements. The rendered Spec
view, the entry form, and the navigator are all views of the Markdown on disk,
built by the same MarkSpec core the CLI uses. The Source drawer shows the exact
bytes, read-only. An engineer looking over Marie's shoulder can open it and see
precisely what will be committed. If MarkDesk and the file ever disagree, the
file wins, and that disagreement is a bug.

### 6. Nothing is lost by using MarkDesk

Every write MarkDesk makes passes through `markspec fmt` before the view
refreshes, so the result is byte-identical to what `markspec fmt` produces from
a hand-written entry. Surrounding prose, other entries, and files Marie did not
touch stay untouched. What she proposes is a normal merge request with a normal
diff that any reviewer can read in the forge's own UI — no MarkDesk-only
metadata, no sidecar files, no lock-in. A team can adopt MarkDesk for some
authors and not others, and stop using it tomorrow, without anyone noticing in
the repository.

### 7. AI is in the loop at every step — the author is in control

Wherever there is a blank to fill, an assistant can propose: a title from a
sentence of intent, a _shall_ statement from a paragraph of notes, a link target
from the requirement's meaning, a fix for a finding, a description for the
proposal. MarkDesk runs the agent CLIs the author already has — Claude Code or
GitHub Copilot CLI — with the MarkSpec MCP server attached. The agent proposes;
MarkDesk shows the change; Marie accepts, edits, or discards it. Nothing an
agent writes reaches disk without her explicit accept, and everything it writes
passes the same `markspec fmt` gate as her own edits. With no agent installed,
the assistant column is empty and everything else still works.

### What this rules out

- **A WYSIWYG Markdown editor.** Editing rendered Markdown in place invites
  formatting the toolchain then has to reconcile. The entry form is the editing
  surface; the Spec view is read-only. Block editing of free prose is 2.0.
- **A code editor, a terminal, or an LSP client inside the app.** Engineers
  already have those, better than MarkDesk could build them.
- **Any MarkDesk-specific file, attribute, or metadata in the repository.**
- **Exposing Git vocabulary** — branch, commit, push, merge, rebase — in the
  author's path.
- **Rule codes as the primary error message.**
- **An agent that writes without an explicit accept,** or that bypasses
  `markspec fmt`.
- **A second requirements model** — a database, cache, or index that can
  disagree with the files and win.
- **A dark code-editor look for the Source view.** Source is the same paper as
  the document, in Plex Mono.

### The acceptance test

An author opens MarkDesk on a product, writes a new requirement that is traced
to its parent and passes `markspec check`, and sends it for review — in under
two minutes, without typing a bracket, a colon-key, or the word "merge". Then an
engineer opens the resulting merge request and sees a diff they would have
written themselves.

## Part 2 — Critical user journeys

MarkDesk's journeys are Marie's journeys from the authoring-experience spec
(§4), moved off the VS Code surface and onto the desk. That spec writes CUJ-1,
CUJ-3, CUJ-5 and CUJ-8 for Marie, and CUJ-9 to CUJ-12 for either persona; all of
them assume an editor. The desk keeps her intent and replaces the syntax she
types with forms, pickers, and one verb. The journeys follow the authoring loop:
**start → write → link → check → propose → read**. Each lists the AI assist,
what the author does, and what MarkDesk writes to disk.

The examples use a braking product with stakeholder needs (`STK_BRK_*`), system
requirements (`SYS_BRK_*`), software requirements (`SRS_BRK_*`), and hazards
(`HAZ_BRK_*`).

### DESK-1 · Start — open the product

_Derived from CUJ-12 (onboarding a technical writer onto an existing
requirements set)._

- **AI assist.** On first open, the assistant summarizes the product in a
  paragraph — how many needs, how deep the tree goes, where coverage is thin —
  and suggests where to start.
- **Author does.** Signs in to GitLab (or GitHub) once through the browser,
  picks the product from the list of repositories she can access, and lands on
  the navigator.
- **MarkDesk writes.** A clone of the repository into MarkDesk's workspace
  folder. Nothing in the working tree changes. The forge token goes to the OS
  keychain, never to disk.

_First release._ The way in is a folder already on the computer: the author
chooses it with a folder picker, and MarkDesk reopens the last product at launch
and lists recent ones in a product menu. Sign-in, repository list, clone, and
the assistant summary ship later, with DESK-5 and the assistant story. MarkDesk
writes nothing into the product folder.

### DESK-2 · Write — add a requirement

_Derived from CUJ-1 (Marie creates an entry by hand), CUJ-3 and CUJ-11 (Marie
creates an entry from a prompt)._

- **AI assist.** Marie types one sentence of intent — "the system must brake
  within 200 ms of a confirmed obstacle". The assistant drafts a title and a
  _shall_ statement in the project's style and proposes a type, labels, and a
  parent. The draft fills the entry form; nothing is written yet.
- **Author does.** Chooses "New requirement" under a node in the navigator (or
  accepts the assistant's draft), fills or edits title and statement, and picks
  labels from the profile's closed set. The identifier is already numbered; she
  never sees an `Id:` field.
- **MarkDesk writes.** One new entry block in the document that holds the
  parent's siblings (or the document the profile designates for that type),
  appended after the last entry of that type, then formatted by `markspec fmt`,
  which stamps the ULID. Every other byte of the file is unchanged.

### DESK-3 · Link — trace to the parent

_Derived from CUJ-1's `Satisfies` step, CUJ-5 (Marie adds an attribute to an
existing entry) and CUJ-9 (a required link is missing)._

- **AI assist.** For a requirement without a parent, the assistant ranks
  plausible parents by meaning and explains each suggestion in a line.
- **Author does.** Drags the requirement onto its parent in the navigator, or
  picks the parent from a list that only shows targets the profile allows for
  that relation. Removing a link is the reverse.
- **MarkDesk writes.** One trailer line on the child entry (for example
  `Satisfies: SYS_BRK_0001`), placed in canonical trailer order by
  `markspec fmt`. Links are always written on the side that owns them; MarkDesk
  never edits the parent to record a child.

### DESK-4 · Check — see what's wrong and fix it

_Derived from CUJ-8 (quick fixes), CUJ-9 (plan-aware fixes) and CUJ-10 (the
agent fix loop)._

- **AI assist.** For findings with no mechanical fix — a vague statement, a
  missing rationale — the assistant drafts a correction for Marie to accept.
  "Fix everything in this document" runs the agent loop and presents the result
  as one reviewable change.
- **Author does.** Sees findings inline on the entry and as a count on each
  navigator node, worded in domain language. Accepts one-click fixes, or opens
  the finding's technical detail to forward it to an engineer.
- **MarkDesk writes.** Nothing until a fix is accepted; then the minimal edit to
  the affected entry — a trailer value replaced, a missing line added — followed
  by `markspec fmt`.

### DESK-5 · Propose — send it for review

_New to the desk; it replaces the "author reviews the result in the diff" step
of CUJ-11, which assumes the author knows Git._

- **AI assist.** Drafts the proposal title and description from the entries
  changed since the last proposal, citing their identifiers and the parents they
  trace to.
- **Author does.** Presses **Propose**, reviews the list of changed requirements
  in plain language, edits the title if she wants, and confirms. She sees the
  review's status — waiting, changes requested, approved, merged — on the same
  screen afterwards.
- **MarkDesk writes.** A topic branch, one commit containing only the files
  MarkDesk changed, a push over HTTPS with the keychain token, and a merge
  request (GitLab) or pull request (GitHub) through the forge API. When the
  token lacks API scope, the push carries GitLab push options to open the merge
  request instead. Nothing is written to the default branch.

### DESK-6 · Read — understand the product

_Derived from CUJ-3 ("she reads it, tweaks a word, moves on") and the hover /
go-to-definition surfaces the authoring-experience spec relies on._

- **AI assist.** Answers questions about the product in the assistant column —
  "what verifies the brake response time?", "which hazards have no safety
  requirement?" — with answers that link to the entries they cite.
- **Author does.** Browses the navigator; reads entries in the Spec view, which
  renders them as the published book does, on an A4 sheet in Plex Serif; follows
  links between entries; opens the read-only Source drawer when she wants to see
  the exact text.
- **MarkDesk writes.** Nothing.

_First release._ Everything except the assistant's answers is available: the
navigator, the Spec view of the whole document scrolled to the entry, clickable
links between entries, Back and Forward, and the Source drawer. The assistant
column is present and empty. Images embedded in a document as `data:` images are
shown; every other image appears as a placeholder with its alt text.

### DESK-7 · Respond to review comments — 2.0

_Deferred to 2.0._ A reviewer's comment on the merge request appears on the
entry it concerns; the assistant proposes a revision; Marie accepts it and
updates the same proposal without opening the forge. 1.0 shows review status
(DESK-5) but not comments.

## Scope of 1.0

Three panes: the navigator (DESK-1, DESK-3, DESK-6), the assistant column (every
journey's AI assist), and the document pane with three modes — **Spec**
(rendered, read-only), **Edit** (the entry form), and **Source** (read-only
drawer). No WYSIWYG, no code editor, no LSP client. Block editing of free prose
and review comments (DESK-7) are 2.0.
