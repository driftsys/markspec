# Design — Canonical Body-AST (Prompt-1 review "Path A")

**Status:** approved design, pre-implementation-plan. **Date:** 2026-05-15.
**Owner:** core/parser, core/formatter, core/validator.

## 1. Goal

Replace `Entry.body: string` with a canonical body **AST** (`BodyBlock[]`) per
`docs/specs/markspec-core-data-model.md` §2.4–2.6. The formatter renders
canonical text _from_ the AST; validators consume the AST instead of line-regex
passes; this unblocks the four structurally-AST-dependent diagnostics
`MSL-B044`, `MSL-M050`, `MSL-M051`, `MSL-C072`.

This is the reviewer's "Path A" — the last open Prompt-1 review item. All other
findings are closed (fixed or recorded as decisions: ADR-012, ADR-013).

## 2. Scope

### In scope

- Body-level AST only: the §2.4 closed block catalogue, §2.5 inline markers,
  §2.6 captions.
- Parser builds the AST from the mdast it _already_ walks for entry detection
  (no new Markdown engine).
- An AST→canonical-text renderer.
- Formatter cutover: body transforms operate on the AST + render.
- Migration of the four body-consuming validators (`captions.ts`,
  `modal_keywords.ts`, `body_blocks.ts`, `parser/entity_refs.ts`) off
  `walkProseLines`-over-string onto the AST.
- The four new codes `MSL-B044/M050/M051/C072`.
- ADR-012 amendment + a new ADR recording the canonical body-AST.

### Out of scope (explicitly deferred)

- Title-line node (§2.2) and Trailers node (§2.3). Path A is **body only**.
  Trailers/identity continue through the existing path.
- The broader nextgen `MSL-P/I/M/F` code-scheme _migration_ (ADR-012). Only the
  four AST-gated codes ship now (see §7).
- `If…then` / ubiquitous EARS forms beyond the currently-recognised
  `When/While/Where/Unless` — the AST records a `ModalMarker` taxonomy that
  _can_ represent them, but recogniser expansion is a separate slice.

## 3. Node taxonomy (authoritative: core-data-model.md §2.4–2.6)

**Block nodes — closed catalogue of 10 (§2.4):** `Paragraph`, `List`, `Table`,
`Figure`, `Code`, `Feature`, `Math`, `DefinitionList`, `Note`, `Blockquote`.
Plus a non-spec `Raw`/`Unknown` fallback node used only so malformed/excluded
constructs never lose content (§5.4 loss-of-information guarantee) — excluded
constructs (headings/HR/task-list/raw-HTML) keep emitting their existing
`MSL-B040–B043` against the body production.

**Inline markers (§2.5), recognised only inside `Paragraph`, `List` item,
`Table` cell, `Note` body, `Blockquote`, `DefinitionList` term/definition —
never inside `Code`/`Feature`/`Math`:**

- `ModalMarker { class: "rfc2119" | "ears", canonical, range }` (§2.5.1).
- `EntityRef { ident, convention: "type"|"instance"|"constant",
  range }`
  (§2.5.2) — `classifyConvention` already implements the convention rule and is
  reused verbatim.

**Caption (§2.6):**
`Caption { keyword, text, position: "above"|"below", block, range }`.

All nodes carry a `SourceRange` (body-relative line/col, offset by the entry
body base — same convention `extractEntityRefs` already uses).

## 4. Architecture

New module `core/ast/`:

- `core/ast/nodes.ts` — node type definitions (pure types, zero behaviour). The
  library boundary stays `core/mod.ts`; AST types are re-exported there.
- `core/ast/build.ts` — `mdast → BodyBlock[]`. Consumes the remark pipeline
  already used in `parser/markdown.ts`; no new dependency.
- `core/ast/render.ts` — `BodyBlock[] → canonical text` (the inverse; drives the
  formatter post-cutover and the equivalence gate).

Touch points:

- `core/model/mod.ts`: `Entry.body: string` → (transitional)
  `Entry.bodyAst?: BodyBlock[]` added additively, then at the cutover
  `Entry.body: BodyBlock[]` with a derived `rawBody(): string` helper for any
  consumer that still needs text.
- `core/parser/markdown.ts`: emit the AST during the existing walk.
- `core/formatter/mod.ts`: `collapseBlankLines` / modal / blank-line transforms
  move from string ops to AST ops + `render`.
- Validators: `captions.ts`, `modal_keywords.ts`, `body_blocks.ts`,
  `parser/entity_refs.ts` consume `BodyBlock[]`. The `walkProseLines` /
  `FENCE_RE` seam (consolidated in PR #329) is the single, clean cut point — its
  callers are exactly the migration targets.

**Data flow:** file → mdast → `BodyBlock[]` → {validators read AST} ∥ {formatter
transforms AST → `render` → text}.

## 5. The equivalence gate (risk control — the crux)

A canonical rewrite must not regress the byte-identical round-trip (§5.1).
Mitigation: a CI harness asserting, for every fixture under `tests/fixtures/`
plus an **expanded golden corpus** (entry-bearing sample documents + a curated
edge-case set covering each §2.4 block type, nesting, and blank-line patterns;
both compared as MarkSpec operations on the same input, independent of the
repo's dprint config),

```text
render(build(parse(x)))  ≡bytes≡  currentFormatter(x)
```

This gate is introduced in PR 3 while the **old string path is still
authoritative** — so PRs 1–3 are provably behaviour-preserving. The formatter
cutover (PR 4) only proceeds when the gate is green over the whole corpus. §5.5
round-trip obligations are extended with AST round-trip cases. Risk is therefore
concentrated at one reviewable step and pre-proved before it.

## 6. Delivery — 7 CI-green PRs (resumes the merge loop)

| PR | Content                                                                                                        | Behaviour change?                             | Acceptance                                                            |
| -- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| 1  | `core/ast/nodes.ts` node types + `core/mod.ts` re-export                                                       | none                                          | `deno check`; types compile; unit type tests                          |
| 2  | `core/ast/build.ts`; parser fills `Entry.bodyAst` additively (unconsumed)                                      | none                                          | per-node-type build unit tests over fixtures; existing suite green    |
| 3  | `core/ast/render.ts` + equivalence-gate harness in CI                                                          | none                                          | gate green byte-identical across full corpus; existing suite green    |
| 4  | Formatter cutover: AST-driven; string body path deleted; `Entry.body: BodyBlock[]`                             | internal only; output identical (gate-proven) | gate stays green; §5.5 round-trip obligations green; full suite green |
| 5  | Migrate `captions`/`modal_keywords`/`body_blocks`/`entity_refs` onto AST; delete their `walkProseLines` passes | none (same diagnostics)                       | all existing validator e2e/unit green unchanged                       |
| 6  | Implement `MSL-B044`, `MSL-M050`, `MSL-M051`, `MSL-C072` on the AST                                            | new diagnostics                               | TDD: RED→GREEN per code; spec-doc §4.5–4.7 updated                    |
| 7  | ADR-012 amendment + ADR-014 (canonical body-AST recorded); AGENTS.md index                                     | docs                                          | ADRs merged; AGENTS.md updated                                        |

Each PR is independently revertible. PRs 1–3 and 5 are behaviour-preserving; the
only output-affecting steps are 4 (gate-proved identical) and 6 (intended new
diagnostics).

## 7. The four new codes — dependencies & honest scoping

- **`MSL-B044`** (warning) — Feature block present _and_ a sibling list labelled
  "Acceptance criteria". Fully served by the AST (`Feature` + `List` nodes +
  label heuristic). No external dependency.
- **`MSL-C072`** (warning) — caption position violates the _project-configured_
  convention. AST gives `Caption.position`; this additionally needs a
  project-config knob (`project.yaml`) for the required convention. That config
  field is part of PR 6.
- **`MSL-M050` / `MSL-M051`** — convention-vs-resolved-kind mismatch /
  unresolved entity. The AST supplies `EntityRef` nodes, but both codes
  additionally need an **entity-resolution source** (what `$Identifier`s exist
  and their kind). Per ADR-005 §Part 2 "Resolution chain", the minimal source is
  the set of entity declarations discoverable in the compiled entry set. PR 6
  scopes M050/M051 resolution to that in-project source; cross-project /
  registry resolution stays out of scope. This dependency is called out so
  M050/M051 are not under-estimated.

## 8. ADR reconciliation (ADR-012)

`MSL-B044/M050/M051/C072` are `MSL-P/I/M/F`-scheme codes that ADR-012 deferred.
ADR-012 §3 already names these four as "structurally impossible without [the AST
refactor]" and gates the broader scheme migration behind it. PR 7 amends ADR-012
with a **bounded exception**: these four AST-dependent codes ship _with_ the AST
refactor (they have no current-scheme equivalent and are new checks, not
renames); the broader `MSL-P/I/M/F` _migration_ of existing codes remains
deferred per ADR-012. A new **ADR-014** records the canonical body-AST as the
model decision (supersedes the implicit `body: string` contract; updates the §5
round-trip reasoning to "AST is canonical, string is derived").

## 9. Testing

- Equivalence gate (§5) — the primary safety net.
- Per-node-type `build` unit tests (colocated `core/ast/*_test.ts`).
- `render` unit tests + property test: `build∘render` idempotence.
- Existing validator e2e/unit suites remain green unchanged through PR 5 (proves
  migration is behaviour-preserving).
- TDD RED→GREEN e2e per new code in PR 6.
- §5.5 round-trip obligations extended with AST cases.

## 10. Risks & mitigations

| Risk                                 | Mitigation                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Byte-identical round-trip regression | Equivalence gate proven before cutover (PR 3 → PR 4)                                                  |
| Scope creep into Title/Trailers      | Body-only scope fixed in §2; trailers untouched                                                       |
| M050/M051 under-scoped (resolution)  | §7 calls out the entity-resolution dependency; scoped to in-project source in PR 6                    |
| Big-bang regression                  | 7 independent PRs; risk isolated to PR 4                                                              |
| nextgen rework                       | AST taxonomy is taken verbatim from the on-`main` core-data-model spec §2 — the nextgen target itself |

## 11. Success criteria

- `Entry.body` is `BodyBlock[]`; no `walkProseLines`-over-body-string passes
  remain in validators.
- Formatter output is byte-identical to pre-refactor across the full corpus
  (gate green).
- `MSL-B044/M050/M051/C072` implemented, TDD-tested, spec §4 updated.
- ADR-012 amended; ADR-014 recorded; AGENTS.md index current.
- `just check` green at every PR.
