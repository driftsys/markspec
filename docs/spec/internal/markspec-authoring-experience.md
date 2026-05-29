# MarkSpec — Authoring Experience (Completion, Highlighting, Lifecycle)

**Status:** Draft design (2026-05-29) — pending review. **Owner:** stasson.
**Editor target:** VS Code only (v1). The LSP stays editor-agnostic; the
extension-side surfaces (wizard, TextMate grammars, decorations) target VS Code.

**Relationship to existing specs:** this is the umbrella authoring-experience
design. It builds on and coordinates
[markspec-vscode-authoring.md](markspec-vscode-authoring.md) (extension
surfaces) and
[markspec-lsp-feature-additions.md](markspec-lsp-feature-additions.md) (LSP
capabilities). It does not replace either; it adds the shared **authoring
model** both consume and defines the create/edit/fix lifecycle across Markdown
and source.

---

## 0. Terminology

- **Entry** — a MarkSpec `- [TYPE_NNNN] Title` block with body and trailer
  attributes.
- **Surface** — where the entry is authored: **Markdown** (`.md`) or **Code** (a
  doc-comment inside a `.rs`/`.kt`/`.cs`/… source file).
- **Lane** — how the author works: **L1** = LSP only, no agent (hand-authoring);
  **L2** = agent-augmented (Copilot / Claude in VS Code).
- **Verb** — the lifecycle operation: **create**, **edit**, **fix**.
- **Persona** — **developer** (fluent with inline snippets/tab-stops) or
  **technical writer** (WYSIWYG mindset; prefers form-like flows).
- **AuthoringPlan** — the core artifact describing what a complete entry of a
  given type needs (see §3).

---

## 1. Problem and goals

Today's completion fires **once** on `- [`, inserts a **static template**, then
abandons the author: no progressive guidance toward the next display number,
title, ULID, attributes, or profile-declared enum values. Highlighting is
**LSP-only** — there is no instant/offline structural layer, so entry constructs
stay uncolored at cold start, outside a project, or before the index loads. The
agent write path and the interactive path are **two separate mental models**.

**Goals:**

1. Make completion **accompany** the author through the whole entry, not dump a
   dead template — for create, edit, and fix alike.
2. Serve **both personas**: a developer inline-snippet flow and a tech-writer
   form-like wizard.
3. Cover **both surfaces** (Markdown and code doc-comments) with **both**
   completion and syntax highlighting.
4. **Unify** the interactive (LSP) and agent (MCP + CLI) lanes behind one shared
   authoring model so they cannot drift.
5. Preserve **ID integrity**: ULIDs are stamped by `format`/`insert`, never
   forged — by the author or the agent.

**Non-goals (YAGNI):** owning inline ghost-text completion (that belongs to the
client model — we make the agent's output correct, we do not drive Copilot's
ghost text); putting an LLM in the LSP lane; a new profile schema (enum
attributes already exist); non-VS-Code editors.

---

## 2. The dimension matrix

The authoring experience is the product of four orthogonal axes. Every
combination must work:

| Axis           | Values                           |
| -------------- | -------------------------------- |
| **Verb**       | create · edit · fix              |
| **Surface**    | Markdown · Code (doc-comment)    |
| **Lane**       | L1 (LSP, no agent) · L2 (agent)  |
| **Persona**    | developer · technical writer     |
| **Capability** | completion · syntax highlighting |

The unifying insight that keeps this tractable: **create, edit, and fix are the
same operation at three starting points — reconcile the entry toward its
`AuthoringPlan`.**

| Verb       | Start state       | "Reconcile" means                                                        |
| ---------- | ----------------- | ------------------------------------------------------------------------ |
| **create** | nothing           | render the **full** plan                                                 |
| **edit**   | partial / valid   | offer **plan − present**, respecting cardinality                         |
| **fix**    | present / invalid | diagnostics mark deviations; repairs pull valid values **from the plan** |

---

## 3. Core: the `AuthoringPlan` (the spine)

A single new core surface — `buildAuthoringPlan(typeName, profile, index)` —
returns an **ordered list of kinded fields** describing a complete entry of that
type. It is pure (profile + workspace index in, plain data out), lives under
`core/`, is exported from `core/mod.ts`, and is the **only** place that knows
"what an entry looks like." Every other surface is a _renderer_ of its output,
so they cannot disagree.

Each field carries a **kind**, **value source**, **required** flag,
**cardinality** (single / multi), and canonical **order**:

| Kind      | Examples                      | Value source                                              |
| --------- | ----------------------------- | --------------------------------------------------------- |
| `auto`    | display-ID number, `Id:` ULID | next-id from index / ULID stamp — **never user-typed**    |
| `prose`   | title, body                   | free text (human types; agent drafts)                     |
| `enum`    | `Labels:`, `Discipline:`      | profile `values[]` (closed set, may be grouped/described) |
| `id-ref`  | `Satisfies:`, `Derived-from:` | relation-target query → matching display-IDs from index   |
| `literal` | `Type:`                       | fixed (the type name)                                     |

`Id:` is always declared `auto` with mode `omit` and a note "stamped by
`markspec format` — never forge" (ID-integrity guardrail, §6).

**Inputs already available in the codebase:** profile enum attributes are parsed
(`core/profile/manifest.ts`, `type: enum` + `values:`) and introspected
(`core/profile/introspect.ts`, `enumValues`); relation targets exist
(`core/profile/trace_targets.ts`); next-id and display-ID pattern parsing exist
(`core/profile/display_id.ts`, `WorkspaceIndex.getNextDisplayIdNumber`). The
plan **composes** these; it introduces no new profile schema.

---

## 4. Critical user journeys (author's perspective)

Two personas: **Marie** (technical writer, WYSIWYG mindset, authors in Markdown,
not a coder) and **Sam** (developer, fluent with snippets, authors requirements
as `///` doc-comments per the V-model convention).

### 4.1 Create

**CUJ-1 · Marie · Markdown · L1.** Marie types `- [`. A list drops down with
plain type names ("Stakeholder Requirement"), recommended one on top, each with
a one-line description. She picks one; the line completes to `- [STK_0007]` with
the next number auto-filled and the cursor on a highlighted `‹title›` field. She
types the title, Tab → body (with a faint "one _shall_ statement" hint), Tab →
metadata. `Id:` is **already filled** (she never touches it). A menu pops by
itself offering `Labels`, with a dropdown of `ASIL-A / ASIL-B / QM`; she picks
one, declines "another label", and the entry is complete and valid — no manual
format step.

**CUJ-2 · Sam · Code · L1.** Inside a Rust `///` block Sam types `- [`. Only
source-appropriate types are offered (SRS/SWE). On accept the block scaffolds
out **already `///`-prefixed on every line**, correctly indented; number auto,
cursor on title. He tabs through; `Id:` auto; at `Satisfies:` a menu lists
**only SYS_\*** targets (relation-filtered). Done.

**CUJ-3 · Marie · Markdown · L2.** Marie tells the chat: "Add a stakeholder
requirement: the system must brake within 200 ms of a confirmed obstacle." A
complete, correct entry appears — clean title, _shall_ body, `Labels: ASIL-B`,
`Satisfies:` pointing at a real existing requirement, `Id:` filled. She reads
it, tweaks a word, moves on.

**CUJ-4 · Sam · Code · L2.** Sam highlights his integration test: "Document this
as a SYS requirement that satisfies STK_AEB_0001." The agent reads the test,
drafts a `///` doc-comment requirement, sets `Satisfies: STK_AEB_0001` (after
verifying it exists), adds the label, writes it above the function, ULID
stamped.

### 4.2 Edit

**CUJ-5 · Marie · Markdown · L1.** Marie adds a second label to an existing
entry: a fresh trailer line offers only attributes the entry **doesn't already
have** (no duplicate `Type:`/`Id:`); she picks `Labels`, gets the dropdown, adds
`safety-critical`. To change `ASIL-B`, she clicks it and swaps via the same
dropdown.

**CUJ-6 · Sam · Code · L1.** Sam types `Der` on a new trailer line in his
doc-comment; it completes to `Derived-from:` and lists only **STK_\*** IDs.

**CUJ-7 · either · L2.** "Point SWE_BRK_0107's Verified-by at the new
median-filter test, and rename STK_AEB_0001 to STK_AEB_0100 everywhere." The
agent edits the attribute (validating target type against the plan) and uses the
existing **workspace rename** for the ID change, then re-validates.

### 4.3 Fix

**CUJ-8 · Marie · L1.** A squiggle under `Type: stakholder` → lightbulb "Replace
with 'stakeholder'." Same shape for uppercase `MUST`→`must`, duplicate
`Labels:`, CSV labels → one-per-line. (These quick-fixes exist today.)

**CUJ-9 · either · L1 (new).** A profile requires `Satisfies:` on SWE entries
and one is missing → "Add required Satisfies:" inserts the line **from the
plan** and re-pops the relation-filtered ID menu. An invalid label `ASIL-Q` →
"Replace with nearest valid: ASIL-A / ASIL-B / QM" (values from the plan).

**CUJ-10 · either · L2.** "Fix all the errors in braking.md." The agent runs
`validate --format json` (or MCP `validate`), reads structured diagnostics,
applies each repair (plan supplies valid values), runs `format`, and
re-validates until clean.

---

## 5. Triggers and component responsibilities

All triggers read the **same `AuthoringPlan`**, so they cannot disagree about
what an entry needs.

| Trigger (author action)                     | Verb        | Owner                                       | Plan's role                       |
| ------------------------------------------- | ----------- | ------------------------------------------- | --------------------------------- |
| Type `- [` (md or doc-comment)              | create      | LSP `onCompletion`                          | full plan → snippet               |
| Tab into an `enum` field                    | create/edit | LSP (snippet `CHOICE`)                      | plan `values[]` (baked at insert) |
| Tab into an `id-ref` field                  | create/edit | LSP, re-invoked by `command:triggerSuggest` | relation-filtered targets         |
| New trailer line (**present-aware**)        | edit        | LSP `onCompletion`                          | **plan − present**                |
| `MarkSpec: New Entry` palette command       | create      | VS Code extension                           | full plan → quick-pick stepper    |
| Diagnostic lightbulb                        | fix         | LSP code-actions                            | valid values / missing fields     |
| `authoring_plan` tool                       | create/edit | MCP → agent                                 | plan as JSON                      |
| `validate [--format json]` / MCP `validate` | fix         | CLI / MCP → agent                           | diagnostics drive the loop        |

**Sharply divided responsibilities:**

- **Core (`buildAuthoringPlan`)** — the brain. Field order, kinds, enum sets,
  relation targets, next display-ID, "Id is auto." Pure, stateless, no I/O.
- **LSP** — renders the plan as a snippet template and serves position-derived
  re-resolution. Owns the inline path. No persistent state (§6).
- **VS Code extension** — renders the plan as a quick-pick stepper. Owns the
  WYSIWYG path. Ephemeral wizard state only.
- **MCP** — exposes the plan to agents as structured JSON (read-only). Tells the
  agent what to fill and what **not** to (`Id: omit`).
- **Agent** — supplies prose, picks from offered values, writes via CLI. Holds
  its own reasoning state.
- **CLI (`insert`/`format`/`validate`)** — the actual write + ULID stamping.

---

## 6. State model: template + stateless re-resolution

**There is no persistent server-side state machine — by design.** The
"progressive, guided" feel is produced by three mechanisms, each chosen for its
lane:

1. **Template (inline LSP).** The snippet inserted at `- [` carries structure
   (tab-stop order), auto values (number, ULID), comment leaders, enum `CHOICE`
   dropdowns, and `command:triggerSuggest` calls. One deterministic insert.
2. **Stateless re-resolution (inline LSP).** When completion re-pops at a later
   field, the server does **not** remember "the author is on field 3 of
   STK_0007." It **recomputes** "what is valid here" from the cursor's line and
   enclosing entry, against the plan. This is robust to arbitrary cursor
   movement, editing field 1 after field 4, undo/redo, paste, and cross-file
   jumps — any stored wizard position would desync instantly. Edit and fix are
   _also_ just stateless re-resolution (plus diagnostics).
3. **Ephemeral linear stepper (wizard).** The palette wizard is a small,
   **linear**, client-side sequence (type → title → labels → done) that exists
   only while it runs, then emits one finished entry. No desync risk — the
   buffer cannot be edited mid-wizard.

The **agent lane** holds state in the agent's own reasoning context; MarkSpec
stays a pure function (`authoring_plan`) plus write/validate commands.

**ID-integrity guardrail.** The plan declares `Id:` as `auto`/`omit` in every
path. Neither the snippet, the wizard, nor the agent ever writes a ULID; it is
stamped by `format`/`insert`. This is enforced at the plan layer so all
renderers inherit it.

---

## 7. Completion design

### 7.1 L1 — LSP lane (no agent)

Two entry points, both rendered from the same plan:

**(a) Progressive inline snippet — developer.** `- [` → type picker → snippet:
display number + `Id:` ULID auto-filled; `prose` fields are tab-stops with ghost
hints; `enum` fields are `${n|ASIL-A,ASIL-B,QM|}` CHOICE dropdowns; `id-ref`
fields carry `command:editor.action.triggerSuggest` so the existing
relation-filtered ID menu auto-re-pops; multi-cardinality fields offer "add
another."

**(b) Command-Palette quick-pick wizard — technical writer.**
`MarkSpec: New
Entry` → type quick-pick (with descriptions) → title input box →
label multi-pick → a complete, valid entry is inserted. No tab-stops, no
ghost-text.

**Source-awareness.** When the target is a source file, both paths inject the
language's comment leader (`///`, `//`, `*`) on every emitted line and indent
correctly.

**Edit (present-aware).** Trailer-key completion offers **plan − present** and
never re-offers a single-cardinality attribute already in the entry.

### 7.2 L2 — agent lane (Copilot / Claude)

**New MCP read tool
`authoring_plan(type, { context: "markdown" | "source",
file? })`** returns the
plan as structured JSON: ordered fields with kinds, the next display-ID, enum
value sets, relation-target display-IDs, and an explicit
`id: { mode: "omit", note: "stamped by markspec format — never forge" }`.

**Source-aware `insert`.** Extend the CLI `insert` command so it (1) can write
into a source doc-comment (leader-prefixed) as well as Markdown, and (2) accepts
pre-filled field values so the agent's drafted title/body/attrs land in one
call. ULID is still stamped by the subsequent `format`.

**Canonical agent loop:** `authoring_plan` → draft prose contextually → fill
enums/targets from the plan → `insert` (with values) → `format` (stamps ULID) →
`validate`. This is the project's existing `insert → format → validate` loop,
now **plan-driven** so the agent fills correctly the first time.

### 7.3 Fix (both lanes)

Plan-aware quick-fixes mirror the existing `MSL-T020` "did you mean" pattern:

- **add-missing-required-attribute** — insert the line from the plan, re-pop the
  value/target menu.
- **replace-invalid-enum-value** — suggest nearest valid value from the plan's
  `values[]`.
- **fix-broken-relation-target** — suggest valid targets for the relation.

The agent fix loop (CUJ-10) consumes the same diagnostics via
`validate --format json` / MCP `validate`.

---

## 8. Syntax highlighting design (two layers)

Highlighting is two complementary layers, both covering both surfaces:

- **Layer 1 — TextMate injection grammar** (static, instant, regex; **Phase
  2**). Colors _structure_: `[ID]` markers, trailer keys, `Id:` ULID, trace
  keywords, modal verbs. Always-on, offline, zero-LSP. Injects into
  `text.html.markdown` and into the comment scopes of supported source
  languages.
- **Layer 2 — LSP semantic tokens** (dynamic, context-aware; **exists today**,
  `lsp/semantic_tokens.ts`). Overlays _meaning_: profile type colors, valid vs
  **broken** reference, valid vs **invalid** label, discipline. Needs the index.

**Precedence (VS Code contract):** TextMate produces the base coloring; semantic
tokens **override on top** where they apply. They compose, they do not compete —
this is the standard architecture (TypeScript, rust-analyzer, Go all ship both).
The two are independent subsystems: a grammar fault is **cosmetic only** and
cannot break the LSP.

**Risk guardrails (mandatory for the TextMate layer):**

1. TextMate stays **coarse / structural only** — never tries to be smart.
2. Semantic tokens **own all meaning** (broken-ref, invalid-label, type color).
3. **Theme colors aligned** between the two layers so the semantic override is
   visually invisible — eliminating load-time **flicker**, the highest-risk
   failure mode.
4. Source-language injection is **phased** (worst case: a doc-comment is
   uncolored, never broken code).

**MVP highlighting = Layer 2 only** (already shipped), corrected for doc-comment
column positions (G10). The instant Layer 1 is a **Phase 2 seamlessness win**,
gated by a flicker-avoidance study (§10, JOB2 Story 0).

---

## 9. Work items (gaps)

| #     | Item                                                                            | Phase |
| ----- | ------------------------------------------------------------------------------- | ----- |
| G1    | Snippet injects comment leaders for source files                                | 1     |
| G2    | `insert` writes into source doc-comments + accepts pre-filled field values      | 1     |
| G3    | Palette quick-pick wizard (tech-writer lane)                                    | 1     |
| G4    | Plan marks `Id:` auto/omit — agent never forges ULID                            | 1     |
| G5    | Re-trigger orchestration in snippet (`command:triggerSuggest`)                  | 1     |
| G6    | Present-aware trailer completion (plan − present, cardinality)                  | 1     |
| G7    | Plan-aware quick-fixes: add-required, replace-invalid-enum, fix-relation-target | 1     |
| G8    | Documented + hardened agent fix loop (`validate --format json`, MCP `validate`) | 1     |
| MCP   | `authoring_plan` read tool                                                      | 1     |
| G10   | Verify/fix semantic-token columns inside leader-prefixed doc-comments           | 1     |
| Study | Flicker-avoidance study (theme-color alignment) — gates G9                      | 2     |
| G9    | TextMate injection — **Markdown + Rust + Kotlin + C#**                          | 2     |
| P2b   | TextMate injection — TS/JS, Java, C/C++                                         | 2     |
| P2a   | EARS / Gherkin / typl **body-content** completion                               | 2     |

---

## 10. Epics

### Epic JOB1 — Authoring MVP: onboard senior devs & tech writers

**JTBD:** _"As a senior dev or tech writer, I can create, edit, and fix MarkSpec
entries correctly — in Markdown and in code, by hand or with an agent — inside
VS Code."_ Tolerates LSP-dependent highlighting and no body-prose completion.
Proves the model end-to-end.

| Story                                                                                                                            | Items       |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1. Core `buildAuthoringPlan` + tests (the spine)                                                                                 | foundation  |
| 2. LSP create — plan-driven snippet (type picker, auto-ID, auto-ULID, tab-stops, enum CHOICE, id-ref re-trigger); source leaders | G1, G4, G5  |
| 3. LSP edit — present-aware trailer                                                                                              | G6          |
| 4. LSP fix — plan-aware quick-fixes                                                                                              | G7          |
| 5. Tech-writer wizard (`MarkSpec: New Entry`)                                                                                    | G3          |
| 6. Agent lane — MCP `authoring_plan` + `Id:omit` contract; source-aware `insert`; hardened fix loop                              | G2, G8, MCP |
| 7. Highlighting correctness — semantic-token columns in doc-comments                                                             | G10         |

### Epic JOB2 — Seamless devex: frictionless authoring for wider adoption

**JTBD:** _"As any team member, I get instant always-on highlighting and
content-aware help, so authoring feels effortless from the first keystroke."_

| Story                                                                                              | Items |
| -------------------------------------------------------------------------------------------------- | ----- |
| 0. **Flicker-avoidance study** (theme-color alignment between TextMate + semantic) — gates Story 1 | Study |
| 1. Instant highlighting round 1 — TextMate: Markdown + Rust + Kotlin + C#                          | G9    |
| 2. Instant highlighting round 2 — TS/JS, Java, C/C++                                               | P2b   |
| 3. Body-content completion — EARS / Gherkin / typl                                                 | P2a   |
| 4. Telemetry-driven polish — use the LSP event-log to measure trigger/accept rates and refine      | —     |

---

## 11. Testing strategy

- **Core** — unit tests for `buildAuthoringPlan`: field order, enum extraction,
  relation targets, cardinality, `Id:` auto/omit, source vs markdown context.
- **LSP** — snippet rendering (incl. leader injection), present-aware trailer
  (plan − present), plan-aware quick-fixes, semantic-token columns in
  doc-comments.
- **E2E** — source `insert → format → validate` round-trip (leaders + ULID
  stamping); markdown create round-trip.
- **MCP** — `authoring_plan` tool contract test (JSON shape, `Id:omit`).
- **Extension** — wizard quick-pick stepper.
- **Phase 2** — TextMate grammar snapshot tests per language; documented
  flicker-study results before the grammar ships.

---

## 12. Open questions

1. **Wizard discoverability** — palette command only, or also a status-bar /
   tree "New Entry" affordance? (Deferred to JOB1 Story 5 detailing.)
2. **`authoring_plan` vs `create`/`next-id`** — does the MCP plan tool subsume
   the existing read surfaces, or sit beside them? (Resolve in JOB1 Story 6.)
3. **Body hints content** — what placeholder/ghost text for the body field in
   L1? (Minimal in JOB1; richer EARS/GWT/typl in JOB2 P2a.)
