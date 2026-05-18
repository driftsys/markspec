# Design — SP3: AST-Equivalence Formatting Contract (Formatting Fidelity epic)

**Status:** approved design, pre-implementation-plan. **Date:** 2026-05-18.
**Owner:** core/ast (`equivalence.ts`, `normalize.ts`, `render.ts`),
core/formatter, the SP1 fidelity assets, spec §5 / a new ADR. **Epic:**
Formatting Fidelity —
`docs/superpowers/specs/2026-05-16-formatting-fidelity-epic-design.md` §3 (SP3,
the final sub-project). **Predecessor:** SP2 (PR #351, merged `3501b1c`) — the
faithful builder; matrix surface 3/52 → 0/58. Main is at `1202d94` (SP2 + the
EntryShape `identified|referenced → Authored|Reference` rename #352).

## 1. Context

SP1 measured the build/render lossy surface; SP2 made `buildBodyAst` faithful so
the surface (`LOSS + UNREPRESENTABLE`) reached 0/58. The post-SP2 matrix's only
non-`OK` rows are **2 `NORMALIZE`** (`edge-blank-line-runs`,
`edge-leading-trailing-ws`) — both §5.2-permitted whitespace rewrites the
formatter already handles (`str-fmt agrees = yes`).

Today's formatter still routes the body through the AST behind a
**byte-identical guard**: in `emitBodyViaAst`
(`packages/markspec/core/formatter/mod.ts`),
`emittedBody = render(buildBodyAst(entry.body))`;
`if (emittedBody !==
entry.body) continue;` keeps the original string. §5.2 body
normalizations (modal-keyword case, blank-line-run collapse) are applied by
**string passes before** the AST emit (`normalizeModalKeywords`,
`collapseBlankLines`). Net output is byte-identical to the pre-AST-refactor
formatter (ADR-014 Decision-2). SP1's `astEquivalent` is still SP1-local in
`tests/e2e/ast_fidelity.ts` (strict `BodyBlock[]` deep-equality ignoring
`range`). Two SP2 residuals were recorded for SP3: the same-line
admonition-marker reflow (`renderNote`) and the single-item deflist
verbatim-split fallback (`TODO(SP2-Task5)`).

## 2. Goal & success criteria

Make the formatter apply the §5.2 **body-internal** normalizations _through the
AST_, replace the byte-identical guard with the ratified `astEquivalent`
relation, and drive the build/render/format fidelity surface to the epic's
end-state.

**Success (decided with the owner — Full §5.2-via-AST, zero residual,
bounded):**

- The fidelity matrix shows **only `OK`/`UNOWNED`, zero residual** — the 2
  `NORMALIZE` rows become `OK`; the SP2 deflist-fallback and renderNote
  same-line-marker residuals are **closed** (not spec-recorded).
- The formatter's correctness criterion is **`build(format(x))` ≈
  `normalizeBodyAst(build(x))`** (Formalization A — §3), where `≈` is exactly
  SP1's relation, unchanged.
- `format` stays **idempotent and total** (§5.3).
- The string-keep fallback shrinks to a **defensive, never-firing,
  loudly-diagnosed** path (a real diagnostic if it ever fires; zero over the
  corpus and real docs).
- ADR-014 Decision-2's "non-total inverse / safe conditional fallback" caveat is
  retired (new ADR); §5 records the ratified relation normatively.
- **Bounded:** M050/M051 + entity-resolution stay deferred-by-dependency
  (ADR-014 Decision-4 — do **not** invent the unlanded model);
  multi-item-deflist semantics stay deferred (already round-trips `OK` — not a
  fidelity residual).

## 3. The contract formalization (Formalization A — owner-decided)

The epic's literal wording — "`build(format(x))` AST-equivalent to `build(x)`" —
is false under a _strict_ relation whenever §3.4.1 applies (uppercase-modal
input: `build(x)` text `"…SHALL…"` vs `build(format(x))` text `"…shall…"` — the
`InlineContent.text` strings differ). Two formalizations express the same
intent; the owner chose **A**:

> **Formalization A.** Contract: `build(format(x))` ≈
> `normalizeBodyAst(build(x))`, where `≈` is **exactly SP1's relation, adopted
> unchanged** (strict `BodyBlock[]` deep-equality ignoring every `range`). _All_
> §5.2 body rewrites live in one deterministic, testable `normalizeBodyAst` AST
> pass; the comparator stays pure and minimal.

Rejected: Formalization B (relation = strict + modal-compared-by-`canonical`,
contract `build(format(x)) ≈ build(x)`) — pushes §5.2 knowledge into the
comparator where the quotient can creep and is harder to test. A is the most
faithful reading of "ratify SP1's relation" (it is adopted _unchanged_).

## 4. `normalizeBodyAst` — the AST-native §5.2 pass

New pure module `packages/markspec/core/ast/normalize.ts`:
`normalizeBodyAst(blocks: readonly BodyBlock[]): BodyBlock[]` — deterministic,
total, AST→AST, no `Deno.*`.

- **Modal-keyword case (§3.4.1).** For every prose-bearing node (Paragraph, List
  item, Table cell, Note, Blockquote, DefinitionList term/definition), rewrite
  the verbatim `InlineContent.text` at each `ModalMarker` span to its
  `canonical` form (lowercase RFC-2119; case-preserved EARS), **except when the
  token is sentence-initial** (the §3.4.1 rule: lowercase unless the first word
  of a sentence; sentence-initial EARS keeps CommonMark's natural
  capitalization). Markers are re-derived from the rewritten text so the node
  stays self-consistent. This is the body half of today's
  `normalizeModalKeywords` string pass — **moved onto the AST**.
- **Caption keyword (§3.4.3).** `CaptionNode.keyword` is a closed TitleCase enum
  by builder construction (`Figure|Table|Listing|Feature|Equation|List`) —
  already canonical; the pass is a no-op/assertion here, recorded for
  completeness.
- **Blank-line-run collapse & leading/trailing trim.** _Emergent, no transform._
  `render` joins blocks with exactly one blank line and emits no body-edge
  whitespace, so building a non-canonical body and re-rendering is already
  canonical. The 2 `NORMALIZE` rows become `OK` via the guard swap (§5) + the
  evolved classifier (§7), **not** via a `normalizeBodyAst` transform.

The pre-AST **body** string passes are **removed**: `normalizeModalKeywords`
over body content, and body `collapseBlankLines`. **Title/trailer §5.2 rewrites
are unchanged and out of scope** — title-line `[ … ]` spacing, trailer key
casing/ordering/column, leading-`@` strip, repeatable CSV → multi-line, `Id:`
assignment. The plan must verify the precise scope of `normalizeModalKeywords` /
`collapseBlankLines` and remove **only** their body-internal effect (body-only;
non-body lines untouched).

## 5. Guard replacement in `emitBodyViaAst`

```text
ast0      = buildBodyAst(entry.body)
canonical = normalizeBodyAst(ast0)
emitted   = render(canonical)
if (!astEquivalent(buildBodyAst(emitted), canonical)) {
  emitResidualDiagnostic(entry, file, …)   // defensive: never fires over corpus
  continue                                  // anti-corruption: keep original body
}
splice(emitted)                             // formatter actively canonicalizes
```

The byte criterion (`emittedBody !== entry.body → continue`) is **replaced** by
the `astEquivalent(buildBodyAst(emitted), canonical)` criterion.

- **The SP2 hard-invariant "never weaken/delete the byte guard" is explicitly
  lifted here** — SP3 is the chartered sub-project that replaces it. The
  replacement is _stronger_ (semantic, not byte; diagnosed, not silent) and a
  guard still exists.
- Net formatter output is **no longer byte-identical** to the pre-AST-refactor
  formatter — it is now the §5.2-canonical form (the body is actively rewritten
  via the AST). Accepted under the Full scope.
- Safety nets: **idempotence** (`format(format(x)) == format(x)`), the
  equivalence gate, and the loud never-firing fallback diagnostic.
- The string-keep fallback branch is **retained** (not deleted) — it is the
  anti-corruption mechanism, now guarded by `astEquivalent` and diagnosed.

## 6. Zero-residual fixes

- **renderNote same-line-marker.** Rework so a note whose body begins on the
  marker line (`> [!NOTE] text`) round-trips faithfully. The `NoteNode` records
  whether the admonition body began on the marker line vs its own line (a small
  additive flag, or unambiguously inferable in the builder); `render` reproduces
  the source form. Closes the SP2 residual; pinned by the gate + matrix +
  adversarial cases.
- **Deflist verbatim split.** Close SP2's `TODO(SP2-Task5)`: the single-item
  `case "paragraph"` deflist branch must **always** store the verbatim
  term/definition — never fall back to the flattened form. Diagnose the
  `DEFLIST_RE`-vs-verbatim-slice mismatch at root and fix the split so verbatim
  capture is total for the canonical single-item form. Multi-item stays deferred
  (already `OK`).

## 7. `astEquivalent` ratification + classifier evolution

- **Ratify.** New `packages/markspec/core/ast/equivalence.ts`:
  `export function astEquivalent(a, b)` = SP1's `deepEqualIgnoringRanges`,
  **promoted unchanged**, exported via `core/mod.ts` (the library boundary). It
  is now load-bearing (formatter guard) — first-class unit tests (the SP1 §4.6
  properties), not just measurement use. `tests/e2e/ast_fidelity.ts` imports the
  production relation and **deletes its local copy** (single source of truth).
  `tests/e2e/ast_equivalence_test.ts` stays a **byte-identical** gate
  (`render(entry.bodyAst) === entry.body` over canonical input) — it does not
  use the AST-equivalence relation; it is strengthened, not weakened (§9).
- **Evolve the classifier** (build/render → build/render/**format**, owner-
  decided). `classifySample` reuses the existing format-canonical machinery
  (today's `strFmtAgrees` path: wrap `s` in an entry, `format()`, re-parse, take
  `entry.body` → `cf`). New terminal classes:
  - **`OK`** — the formatter canonicalizes `s`, is **idempotent** on it, and
    `astEquivalent(buildBodyAst(cf), normalizeBodyAst(buildBodyAst(s)))` holds
    (the Formalization-A contract). Subsumes the old `NORMALIZE`
    (formatter-handled §5.2 = OK).
  - **`UNOWNED`** — all-Unknown-verbatim (excluded construct preserved) —
    unchanged.
  - **`RESIDUAL`** — the contract fails (genuine loss). **Must be 0.** Mirrors
    the production guard's diagnosed fallback exactly.

  Headline becomes `OK + UNOWNED = 58`; residual = 0. Catalogue columns evolve
  to `class`, `format-idempotent`, `roundtrips (astEquivalent)`, `delta`.
  `ast_fidelity_test.ts`, `scripts/gen_ast_fidelity_matrix.ts` /
  `scripts/check_ast_fidelity_matrix.sh`, and
  `docs/product/ast-fidelity-matrix.md` are updated/regenerated; the catalogue
  preamble drops "measurement only — no production behaviour depends on this
  file" (the relation is now production-consumed).

## 8. Spec / ADR updates

- `docs/specs/markspec-core-data-model.md` §5: record the formal AST-equivalence
  relation as the normative round-trip contract; state
  `build(format(x)) ≈ normalizeBodyAst(build(x))`; note the §5.2 body-internal
  rewrites apply via the AST.
- **New ADR-015 — "AST-equivalence formatting contract."** ADRs are immutable
  and accumulate (AGENTS.md) — this is a _new_ ADR, **not** a rewrite of
  ADR-014. It supersedes ADR-014 Decision-2's non-total-inverse caveat, records:
  the guard replacement; the ratified relation's home
  (`core/ast/equivalence.ts`) and that it is SP1's relation unchanged; the
  AST-native §5.2 pass; the diagnosed never-firing residual. Update the
  AGENTS.md ADR index and add a forward cross-reference note from ADR-014.

## 9. Hard invariants & out of scope

- `format` **idempotent + total** (§5.3) — the primary SP3 safety net; the e2e
  idempotence corpus is strengthened with non-canonical inputs.
- `tests/e2e/ast_equivalence_test.ts` is **not weakened** — it strengthens
  (render⇄build inverse over canonical input; SP3 adds §5.2-normalization
  cases).
- The defensive string-keep fallback is **retained** (not deleted) — byte
  criterion replaced by `astEquivalent` + a loud diagnostic; never fires over
  corpus / real docs.
- The `astEquivalent` relation is **semantically unchanged** from SP1
  (Formalization A — all normalization is explicit in `normalizeBodyAst`).
- **Validator path unaffected:** `validate` does **not** run `normalizeBodyAst`
  (formatter-only). `Entry.bodyAst = buildBodyAst(body)` un-normalized; MSL-M060
  and the other body validators still see the un-normalized markers — pinned by
  regression tests.
- `docs/product` entry docs stay format-idempotent **zero-diff** (already
  canonical from SP2) — verified explicitly; any reformat is a surface-to-owner
  finding, not silently accepted.
- **Out of scope:** M050/M051 + entity-resolution (deferred-by-dependency — do
  not invent); multi-item-deflist semantics (already `OK`); title/trailer §5.2
  rewrites (unchanged); the nextgen slices (parallel track — independent).

## 10. Testing & CI

- **Unit:** `normalizeBodyAst` (modal case incl. sentence-initial / EARS,
  multi-line, idempotent, total); production `astEquivalent` (the §4.6
  properties — now load-bearing); the guard (astEquivalent pass → emit; fail →
  diagnose + keep original).
- **Idempotence e2e:** `format(format(x)) == format(x)` over a corpus of
  **non-canonical** inputs (uppercase modals, blank-line runs, same-line marker
  notes, deflist) — strengthened; the primary SP3 safety net.
- **Equivalence gate:** green over fixtures + `docs/product` + `docs/examples` +
  edge cases incl. new §5.2-normalization cases; not weakened.
- **Fidelity matrix:** evolved harness regenerated; staleness gate green;
  headline `OK`/`UNOWNED` only, residual 0.
- **Validator regression:** MSL-B040–B044 / C072 / M060 behaviour pinned
  unchanged (validate path does not normalize).
- **Real-doc safety:** `markspec format docs/product/*.md` → zero non-matrix
  diff.
- `just check` green; CodeQL green (slice/string/regex code written
  defensively).

## 11. Risks & mitigations

| Risk                                                                                                            | Mitigation                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Formatter output no longer byte-identical to pre-refactor                                                       | `docs/product` zero-diff check + idempotence net + equivalence gate; any real reformat surfaced to the owner               |
| `normalizeBodyAst` modal-span rewrite (sentence-initial, multi-line, marker re-derivation) — highest-risk piece | heavy unit tests + idempotence net + adversarial cases; bottom-up TDD                                                      |
| renderNote same-line-marker rework (SP2's hardest area)                                                         | gate + matrix + adversarial pinning; verify pre-existing canonical shapes stay byte-exact                                  |
| Classifier evolution → large catalogue diff                                                                     | deterministic regen; new semantics documented in the catalogue preamble + this design + ADR-015                            |
| Removing body string passes touches non-body behaviour                                                          | plan verifies `normalizeModalKeywords` / `collapseBlankLines` scope precisely; body-only removal; non-body lines untouched |
| A construct genuinely cannot round-trip under `astEquivalent`                                                   | the diagnosed defensive fallback fires loudly — surface to the owner as an explicit finding; do not silently accept        |

## 12. Out of scope (SP3)

- The entity-resolution model and M050/M051 — deferred-by-dependency (ADR-014
  Decision-4); do not invent.
- Multi-item DefinitionList semantics — deferred (already round-trips `OK`).
- Title-line / trailer-block §5.2 rewrites — unchanged (outside the body AST).
- The nextgen `MSL-P/I/M/F` migration and its slices — a parallel track; SP3
  stays independent.
