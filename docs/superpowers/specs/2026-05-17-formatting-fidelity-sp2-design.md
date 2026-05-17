# Design — SP2: The Faithful Builder (Formatting Fidelity epic)

**Status:** approved design, pre-implementation-plan. **Date:** 2026-05-17.
**Owner:** core/ast (`build.ts`, possibly `render.ts`), SP1 fidelity assets.
**Epic:** Formatting Fidelity —
`docs/superpowers/specs/2026-05-16-formatting-fidelity-epic-design.md` §3 (SP2).
**Predecessor:** SP1 (PR #346, merged) — the measurement harness, catalogue, and
staleness gate that are SP2's success oracle.

## 1. Context

SP1 characterized the canonical body-AST build/render surface and committed a
generated catalogue (`docs/product/ast-fidelity-matrix.md`). Baseline: of 52
corpus samples — OK 38, NORMALIZE 10, LOSS 1, UNOWNED 1, UNREPRESENTABLE 2;
headline "surface = LOSS + UNREPRESENTABLE = 3". SP1 changed zero production
code by charter.

Every §5.1 prose loss in that baseline traces to **one function**:
`extractMdastText` in `packages/markspec/core/ast/build.ts`. It flattens the
mdast inline tree to plain text — recursing into `emphasis` / `strong` / `link`
(dropping the delimiters and URLs) and returning `""` for `break`,
`thematicBreak`, and link-reference `definition`. Consequences:

- `_shall_` → `shall`, `**must**` → `must`, `[t](u)` → `t`, `<url>` → `url`,
  `line one␣␣\nline two` → `line oneline two` — the markup is **erased from the
  AST**, not merely lost in the round-trip.
- `---`, headings, `[s]: url` reference definitions → `Unknown` with `raw=""`
  (verbatim source never captured) → destroyed on render.
- GFM task-list `- [ ]`/`- [x]` → checkbox dropped (the lone literal `LOSS`).

The spec already mandates the correct behaviour.
`docs/specs/markspec-core-data-model.md` §5.1: body prose text is preserved
**character-for-character**, except the modal-keyword normalization (§3.4.1) and
the `$Identifier` handling (§3.4.2). §3.4.1 modal-lowercasing runs as a string
pass **before** `buildBodyAst` in the formatter (`normalizeModalKeywords`), so
the builder never sees a non-canonical modal; §3.4.2 emits `$Identifier`
**verbatim** (no rewrite — M050 is a style _warning_, not a normalization).
Emphasis, strong, links, autolinks, hard line breaks, and Pandoc citations are
**not** in §5.2's "may be rewritten" list, so they must survive
byte-identically. §3.4.5 confirms this for List / Table-cell / Note / Blockquote
/ DefinitionList: `fmt` delegates CommonMark formatting and only runs
inline-marker recognition inside them. The bug is purely the lossy
`extractMdastText` projection.

## 2. Goal & success criteria

Make `buildBodyAst` capture the §5.1 prose it currently flattens away, so the
build/render inverse is faithful for all prose the spec requires preserved.

**Success criterion (decided with the owner — the broader reading, not the
literal "LOSS class → 0"):** every SP1 corpus sample whose only delta was
dropped §5.1 inline markup round-trips to `OK` — emphasis, strong, combined,
inline-link, autolink, both hard-break forms, and the reference-style link
**plus its definition**. The §2.4.1 excluded constructs (task-list,
thematic-break, heading) become **verbatim-faithful and still diagnosed**
(MSL-B040–B043), never destroyed and never promoted to first-class prose. The
catalogue headline surface drops to **0, or to an explicit residual that is
spec-recorded and surfaced to the owner — never silently left misclassified**.

Rationale for not using the literal "matrix `LOSS` → 0": the SP1 provisional
classifier scores build-stable losses (emphasis erased identically in `ast0` and
`ast1`) as `NORMALIZE`, so `LOSS` today is exactly one row —
`excluded-task-list`, a spec-_excluded_ construct. Driving only that to zero
would satisfy one sentence of epic-design §3 while leaving the actual §5.1
breaches the epic exists to fix (epic-design §2: "the builder is _faithful_:
lossless for prose it must preserve") in place and undercounted.

## 3. Mechanism & per-node-kind strategy (Approach A)

**Approach A — verbatim source-offset slice.** For every prose-bearing node the
stored text is populated from the exact source substring via mdast
`position.start.offset .. position.end.offset` against the `body` passed to
`processor.parse(body)`. This is the **exact mechanism `TableNode.raw` already
uses** (`build.ts` ~L431–L455), including its list-item-indent normalization.
`render` already emits `content.text` verbatim (`render.ts` `renderParagraph`),
so the paragraph render path needs **no change**.

Approach B (mdast → Markdown inline re-serializer, e.g. `mdast-util-to-markdown`
/ remark-stringify) was rejected: it normalizes (`_x_`→`*x*`, link/escape
rewriting) and cannot guarantee byte-exactness — it _reintroduces_ the loss SP2
exists to remove.

The meaning of `InlineContent.text` (and the note / blockquote / deflist text
fields and `Unknown.raw`) changes **from "flattened plain prose" to "verbatim
source prose, markup-preserving"**. This new field contract is documented in
`nodes.ts` and ADR-014's note (§6).

| Node                  | Strategy                                                                                                                                                                                                                                                                                               | Risk                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| **Paragraph**         | `content.text` = verbatim offset slice. Caption / Math / DefinitionList detection still runs on the _flattened_ text local **before** storage (`tryCaptionParagraph` / `tryMathParagraph` / `tryDefinitionList` unchanged). `renderParagraph` already emits `content.text` → no render change.         | Core change, low risk          |
| **List item**         | Recursion through `mapMdastNode` inherits the paragraph fix. Nested-block slices must be **column-0-normalized** exactly as the `TableNode` path does (strip `pos.start.column - 1` leading spaces from continuation lines) so `renderListItem`'s 2-space re-indent does not double the source indent. | Care point                     |
| **Table**             | Already byte-exact via `TableNode.raw` (matrix: all `table-*` = OK; `render` emits `raw`). Per-cell `InlineContent` is the validator view only — never rendered. Only ensure cell marker recognition is unaffected.                                                                                    | Minimal                        |
| **Note / Blockquote** | Verbatim **de-quoted** inner text: strip the per-line `>` quote marker (and its trailing space) and the `[!KIND]` admonition first line; `renderNote` / `renderBlockquote` re-add them. The existing paragraph-join (`\n\n` between quoted paragraphs) and interior-blank-`>` convention is preserved. | **Highest risk — pin heavily** |
| **DefinitionList**    | Verbatim term/definition text in the **existing single-item** path only. Multi-item coalescing stays the documented `DONE_WITH_CONCERNS` deferral — SP2 does not expand it.                                                                                                                            | Bounded                        |

## 4. Marker-recognition decoupling & validator safety

**Hazard.** A verbatim `content.text` carries `_`, `**`, `[..](..)`. Running the
existing modal / `$Identifier` regexes on it regresses MSL-M0xx — `\bshall\b`
does not match inside `_shall_` because `_` is a JS-regex word character.

**Fix — stored text ≠ recognition input.** `InlineContent.text` holds the
verbatim slice (consumed by `render`). `extractMarkersFromText` keeps consuming
the **flattened** projection (the existing `extractMdastText` output, computed
as a local separate from the stored text) so modal / `$Identifier` markers fire
exactly as before. Marker `range` columns become best-effort relative to the
verbatim text — consistent with the existing `DONE_WITH_CONCERNS` posture in
`build.ts` (`extractMarkersFromText`) and ADR-014; tightening ranges is SP3 /
future work, not SP2.

**Validator-safety obligation (explicit plan task — verified, not assumed).**
Audit every `Entry.bodyAst` consumer — `body_blocks` (MSL-B040–B044), `captions`
(MSL-C072), `modal_keywords` (MSL-M060), `entity_refs` — to confirm none assumes
`content.text` is markup-free and that no validator unit/e2e test pins exact
inline-marker columns. If one does, that is a **surface-to-owner finding** (an
agreed-approach problem), **not** a silent test relaxation.

## 5. Excluded constructs & §5.4

§2.4.1 excluded constructs = heading, thematic break, task list, raw HTML. §5.4
requires losslessness for content the model does not own: preserve verbatim,
keep diagnosing, never destroy or promote to first-class prose.

| Construct          | Today                                           | SP2                                                                                                              | Diagnostic             |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Heading**        | `Unknown(raw = flattened)` — `#` lost           | `raw` = verbatim slice; keep `subkind:"heading"`                                                                 | MSL-B040 unchanged     |
| **Thematic break** | `Unknown(raw = "")` — destroyed                 | `raw` = verbatim slice (`---`); keep `subkind:"thematic-break"`                                                  | MSL-B041 unchanged     |
| **Raw HTML**       | Already OK (`html` node carries `value`)        | keep; ensure `subkind:"html"`                                                                                    | MSL-B043 unchanged     |
| **Task list**      | Real `ListNode`, checkbox dropped (lone `LOSS`) | Carry checkbox state on the list-item model; `renderListItem` re-emits `[ ]`/`[x]`; **`hasTaskItems` preserved** | **MSL-B042 unchanged** |

Net outcome: heading / thematic-break → verbatim `UNOWNED`; task-list → a
faithful owned `ListNode` that round-trips (`OK`) **with MSL-B042 still
firing**. The lone `LOSS` reaching 0 is a _consequence_ of faithfulness + §5.4,
never achieved by suppressing a diagnostic.

## 6. SP1-asset changes (corpus, tripwire, matrix)

- **Extend `CORPUS`** in `tests/e2e/ast_fidelity.ts` with
  inline-markup-inside-{note, blockquote, list-item, table-cell, deflist}
  samples and a standalone link-reference-definition case. **Append at stable
  positions** — catalogue order is fixed, so appending keeps existing rows' diff
  stable; the staleness gate forces a clean regen.
- **Flip the tripwire.** `tests/e2e/ast_fidelity_test.ts`
  `characterization: buildBodyAst erases inline emphasis` is rewritten as
  `buildBodyAst preserves inline emphasis`: it asserts the emphasised and plain
  ASTs are **not** `astEquivalent`, plus a positive assertion that the
  paragraph's `content.text` contains the literal `_shall_`. The other
  `astEquivalent` unit tests (hand-constructed dropped-emphasis, fused
  hard-break, reorder, `Unknown` raw) still pass unchanged.
- **Regenerate** `docs/product/ast-fidelity-matrix.md` via
  `just ast-fidelity-matrix` and commit it;
  `scripts/check_ast_fidelity_matrix.sh` enforces freshness. The regenerated
  catalogue is the recorded SP2 baseline.
- **`astEquivalent` stays SP1-local and provisional** — not changed
  semantically. SP3 ratifies/hardens it as the formal §5 relation.

## 7. Hard invariants & SP3 boundary (out of scope)

- `tests/e2e/ast_equivalence_test.ts` is **not weakened — it strengthens.** More
  constructs round-trip; every existing assertion plus the broadened
  `docs/product` + `docs/examples` corpus must still pass byte-identically, and
  SP2 _adds_ inline-markup edge cases to it.
- The `emitBodyViaAst` fallback guard (`emittedBody !== entry.body → continue`,
  `core/formatter/mod.ts`) stays **byte-untouched**. SP2 makes _more_ bodies
  pass the guard (the AST path wins more often); net formatter output stays
  byte-identical by construction. The `continue` is not deleted — that is the
  mass-corruption hazard pinned by the hard-line-break regression test in
  `tests/e2e/format_test.ts`.
- **SP3 owns and SP2 does not touch:** replacing the byte-identical guard,
  ratifying/hardening `astEquivalent`, the formatter applying §5.2
  normalizations _via_ the AST, and the formal retirement of ADR-014's
  non-total-inverse caveat. SP2 may add a one-line ADR-014 note that the inverse
  is materially widened (record, do not rewrite the decision).
- **M050 / M051 stay deferred** (ADR-014, deferred-by-dependency on the unlanded
  entity-resolution model). SP2 invents no resolution semantics.

## 8. Testing & CI

- **Unit:** per-node faithfulness — `render(buildBodyAst(s)) === s` for
  inline-markup samples across every prose-bearing node kind; an
  emphasized-modal sample (`_shall_`) still yields a recognized modal marker.
- **Equivalence gate:** `ast_equivalence_test.ts` green over fixtures +
  `docs/product` + `docs/examples` + edge cases, including the new inline-markup
  edge cases SP2 adds.
- **Fidelity harness + staleness gate:** regenerated, committed, green.
- **Validator regression:** MSL-B040–B044 / C072 / M060 behaviour pinned
  unchanged (audit + targeted tests).
- **Idempotence safety:** `markspec format` over `docs/product` produces zero
  diff (the guard guarantees byte-identical net output; this confirms it).
- `just check` green. One Conventional Commit `feat(core): …` (or
  `feat(repo): …` if it spans the SP1 assets) squashed onto
  `$(git merge-base origin/main HEAD)`. CodeQL green — slice / string code
  written defensively (no incomplete string escaping).

## 9. Risks & mitigations

| Risk                                                                    | Mitigation                                                                                                                  |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Note/blockquote de-quote + interior-blank-`>` convention (highest risk) | Heavy pinning: every existing gate note/blockquote case + new inline-markup-in-note/bq samples; bottom-up TDD per node kind |
| List-nested block double-indent                                         | Column-0 normalization (the `TableNode.raw` precedent); pin nested-paragraph and nested-block cases                         |
| Marker-column drift breaks a validator test                             | Audit consumers first; if a real conflict appears, **surface to the owner** — never silently weaken a test or the gate      |
| A construct still cannot round-trip under verbatim slice                | **Explicit, spec-recorded residual surfaced to the owner** — never silently left `NORMALIZE`                                |
| Scope creep into SP3 territory                                          | §7 boundary is explicit; the guard and `astEquivalent` are out of scope by charter                                          |

## 10. Out of scope (SP2)

- Replacing the byte-identical formatter guard; ratifying/hardening
  `astEquivalent`; the formatter applying §5.2 normalizations via the AST;
  formal retirement of ADR-014's caveat — **all SP3.**
- M050 / M051 and the entity-resolution model — **deferred (ADR-014).**
- Multi-item DefinitionList coalescing — **existing documented deferral.**
- The broader `MSL-P/I/M/F` scheme migration — **ADR-012's separate phase.**
- Marker `SourceRange` column precision — best-effort, unchanged from SP1.
