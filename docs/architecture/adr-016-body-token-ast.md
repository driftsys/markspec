# ADR-016: Body-Token AST

## Context

Inline constructs in MarkSpec entry bodies — modal verbs (`shall`, `should`,
`may`, `must`, `will`), EARS triggers (`When`, `While`, `If`, `Where`, `Then`),
Gherkin keywords inside fenced `feature` / `gherkin` blocks (`Feature`,
`Scenario`, `Given`, `When`, `Then`, `And`, `But`, …), and `$Identifier` entity
references — are extracted today in three independent places:

1. **`packages/markspec/core/ast/build.ts`** populates
   `InlineContent.markers: readonly InlineMarker[]` on every prose-bearing AST
   node, with `ModalMarker | EntityRefMarker` cases. Re-derived after formatter
   normalisation by `core/ast/normalize.ts`.
2. **`packages/markspec/core/parser/entity_refs.ts`** runs a separate raw-body
   scan that emits `Entry.entityRefs: readonly EntityRef[]`. Locations are
   body-relative, not file-relative — surfaced as a bug during PR #408 review.
3. **`packages/markspec/lsp/semantic_tokens.ts`** carries its own regex set
   (`BODY_KEYWORD_RE`, `GHERKIN_SECTION_RE`, `GHERKIN_STEP_RE`, `ENTITY_REF_RE`)
   plus a fence-tracker state machine, scanning entry-body lines a third time to
   produce LSP semantic tokens. The Gherkin scanner has no representation in (1)
   or (2) at all.

Each consumer re-discovers the same lexical constructs from raw or
semi-processed text. The drift this produces showed up in two ways during PR
#408:

- The LSP regex for entity refs paints `$x` inside math blocks where the
  parser-emitted refs (correctly) do not. Two systems, two answers, no single
  source of truth.
- The LSP regex for entry shape only matches Markdown source; Rust `///`, Kotlin
  KDoc, Java javadoc, and C/C++ doc comments aren't rendered as entries even
  though the **parser** already extracts entries from those doc-comment blocks.
  The PR #408 attempt to widen the LSP regexes to handle doc-comment prefixes
  was reverted as the wrong layer — prefix stripping already happens inside the
  parser, but the parser's output cannot be reused by the LSP because tokens
  carrying file-relative positions are not yet a thing the parser produces.

The canonical-body-AST refactor (ADR-014) and the AST-equivalence formatting
contract (ADR-015) established `BodyBlock[]` as the load-bearing structural
representation of body prose. The markers field on `InlineContent` was a first
attempt at exposing inline-construct extractions; it sits inside the AST nodes
(per-paragraph locality) but is not used by any consumer that needs that
locality — `core/validator/modal_keywords.ts` flattens the markers via a
recursive walk and discards the structural information.

ADR-016 promotes inline-construct extraction to a first-class parser output
attached at the entry level, with file-relative positions on every token, so
every downstream consumer — LSP semantic tokens, MSL-M060 modal-case validator,
future preview renderer — becomes a thin mapper from token kind to surface
treatment.

This ADR supersedes ADR-014's marker mechanism. ADR-015's `astEquivalent`
relation remains the formatter's correctness gate and is not affected.

## Decision

1. **A new flat token stream `Entry.bodyTokens: readonly BodyToken[]` is the
   single extraction layer for inline constructs in entry bodies.** Emitted
   eagerly by the parser, sorted by `(line, column)`, always present (empty
   array when no constructs are recognised). File-relative positions on every
   token in both Markdown and source-file paths.

2. **`BodyTokenKind` is a six-variant discriminated union split where at least
   one consumer fans out behaviour at the kind level, collapsed elsewhere into
   discriminator fields:**

   ```typescript
   type BodyTokenKind =
     | "modal"            // shall, should, may, must, will
     | "ears-trigger"     // When, While, If, Where, Then (in prose)
     | "gherkin-section"  // Feature, Background, Rule, Scenario, Examples
     | "gherkin-step"     // Given, When, Then, And, But
     | "entity-ref"       // $Identifier (any case convention)
     | "inline-code";     // `…` span

   type ModalCase = "lower" | "upper";
   type EarsTrigger = "When" | "While" | "If" | "Where" | "Then";

   type BodyToken =
     | { kind: "modal"; text: string; case: ModalCase; location: SourceLocation }
     | { kind: "ears-trigger"; text: string; trigger: EarsTrigger; location: SourceLocation }
     | { kind: "gherkin-section"; text: string; location: SourceLocation }
     | { kind: "gherkin-step"; text: string; location: SourceLocation }
     | { kind: "entity-ref"; text: string; convention: EntityRefConvention; location: SourceLocation }
     | { kind: "inline-code"; text: string; location: SourceLocation };
   ```

   Rationale: `gherkin-section` and `gherkin-step` are split because the LSP
   maps them to different semantic-token _types_ (`class` vs `keyword`), not
   different themes — switching on a field at the LSP call site would force
   re-classification at every consumer. `entity-ref` keeps its three conventions
   (type / instance / constant) in a `convention` field because no consumer fans
   out on convention; the LSP paints all three identically and validators do not
   discriminate. `modal` carries `case` because MSL-M060 targets only the
   uppercase form — a filter, not a behavioural fan-out.

3. **Token scope is prose-only.** Modal, EARS-trigger, entity-ref and
   inline-code tokens are emitted only outside fenced code blocks
   (`` ``` … ``` `` and `~~~ … ~~~`), outside display-math blocks (lines that
   trim to `$$`, plus their interiors), and outside inline math (`$$ … $$` on a
   single line). Inside `` ```feature `` / `` ```gherkin `` fences,
   modal/EARS/entity-ref/inline-code scans are suppressed and the
   gherkin-section/gherkin-step scans run instead — "When the user clicks"
   inside a Given step is a `gherkin-step`, not an `ears-trigger`.

   This rule unifies behaviour that today diverges per consumer
   (`entity_refs.ts` excludes verbatim regions via the AST; the LSP scanner does
   not). The fixed rule also resolves the PR #408 regression where `when` in a
   Rust snippet was painted as an EARS trigger.

4. **`Entry.entityRefs` and `EntityRef` are deleted in the same PR that
   introduces `Entry.bodyTokens`. No deprecation cycle, no compat shim.** Per
   the May-2026 scope decision (no migration tooling, no backward compatibility
   until 1.0), consumers are migrated in-tree atomically.

5. **`InlineContent.markers`, `ModalMarker`, `EntityRefMarker`, and
   `InlineMarker` are deleted from `core/ast/nodes.ts` in the same PR.**
   `InlineContent` becomes `{ readonly text: string }`. `core/ast/build.ts`
   stops extracting markers; `core/ast/normalize.ts` stops re-deriving them. The
   canonical body-AST (ADR-014, ADR-015) is unchanged structurally — only the
   cached inline-construct annotation layer is removed.

6. **Source-file coordinate translation is performed inside the parser via an
   optional `LineMap` parameter on `parseMarkdown`.** `parseSource` builds a
   per-doc-comment-block `LineMap` that translates wrapped-buffer
   `(line, column)` to source-file `(line, column)`, accounting for the
   list-item wrapper line, per-line comment-prefix stripping (e.g. `///`, `*`),
   and the block's start position:

   ```typescript
   interface LineMap {
     translate(bufferLine: number, bufferColumn: number):
       { line: number; column: number } | undefined;
   }

   interface ParseMarkdownOptions {
     readonly file?: string;
     readonly lineMap?: LineMap;
   }
   ```

   When `lineMap` is supplied, every emitted `SourceLocation` — on entries, on
   `bodyAst` node ranges, on `bodyTokens` — is translated through it before
   emission. When omitted, positions are buffer-relative (current behaviour,
   Markdown-direct callers unaffected). One translation point, no per-consumer
   coordinate arithmetic.

   `DocCommentBlock` gains a `prefixWidths: readonly number[]` field capturing
   per-line strip width so `buildBlockLineMap` can produce accurate column
   offsets across all supported comment styles (`///`, `//!`, `/** … */`,
   `* …`).

7. **A new module `core/parser/body_tokens.ts` owns extraction.** Single
   exported function:

   ```typescript
   export function extractBodyTokens(
     body: string,
     bodyAst: readonly BodyBlock[],
     baseLocation: SourceLocation,
     lineMap?: LineMap,
   ): readonly BodyToken[];
   ```

   The existing `core/parser/entity_refs.ts` is deleted; its
   `collectCodeFeatureLines` helper moves into `body_tokens.ts` (or a shared
   util module, decided at implementation time). Math-fence tracking (`$$`-line
   toggle) is preserved unchanged from the entity-ref scanner.

8. **The LSP `semantic_tokens.ts` body-token path becomes a thin mapper.** The
   regex constants `BODY_KEYWORD_RE`, `GHERKIN_SECTION_RE`, `GHERKIN_STEP_RE`,
   `ENTITY_REF_RE`, `FEATURE_FENCE_OPEN_RE`, `FENCE_CLOSE_RE`, and the helper
   functions `emitTypedMatches`, `emitKeywordMatches`, `emitEntityRefMatches`,
   plus the `insideFeatureBlock` state machine in `addBodyKeywordTokens`, are
   all deleted. They are replaced by a single switch from `BodyTokenKind` to
   semantic-token type:

   | Kind              | Semantic-token type                |
   | ----------------- | ---------------------------------- |
   | `modal`           | `keyword`                          |
   | `ears-trigger`    | `keyword`                          |
   | `gherkin-section` | `class`                            |
   | `gherkin-step`    | `keyword`                          |
   | `entity-ref`      | `string`                           |
   | `inline-code`     | _no emission_ (TextMate paints it) |

   Title-line and trailer tokenisation are unchanged.

9. **The MSL-M060 validator migrates to `bodyTokens`.**
   `core/validator/modal_keywords.ts` loses its `modalsFromBlock` /
   `modalsFromInline` / `modalsFromListItem` walk and becomes a single filter:

   ```typescript
   const uppercase = entry.bodyTokens.filter(
     (t): t is Extract<BodyToken, { kind: "modal" }> =>
       t.kind === "modal" && t.case === "upper",
   );
   ```

   `core/validator/feature_ac.ts` is unchanged — it walks `bodyAst` for
   structural shape (Feature-node presence, Acceptance-criteria list label) and
   never touches inline keywords.

## Consequences

**Positive.**

- Single extraction point eliminates the three-way drift documented in the
  Context section. The MSL-M060 ↔ LSP ↔ skill regex divergence cannot recur
  because there is one scanner.
- Source-file rendering (`.rs`, `.kt`, `.java`, `.c`, `.cpp`) becomes correct as
  a side effect once tokens carry file-relative positions — the PR #408
  regression closes without any LSP-level prefix-detection logic.
- LSP `semantic_tokens.ts` shrinks materially (the modal/EARS/gherkin/
  entity-ref paths collapse to ~30 LOC of switch + dispatch).
- MSL-M060 shrinks from ~120 LOC of recursive AST walk to ~20 LOC of filter.
- Future consumers (preview renderer, MCP token-stream tool, additional
  validators) get a typed entry-level API without re-inventing extraction.
- `LineMap` becomes a reusable mechanism for any future source-format expansion
  (e.g., Python `"""…"""` docstrings, AsciiDoc).

**Negative.**

- Partial undo of ADR-014's marker work. Per-paragraph marker locality is lost.
  No current consumer uses it, but a hypothetical future analysis rule wanting
  "the modals in _this_ paragraph" would need to filter `bodyTokens` by location
  range against a `bodyAst` walk. Acceptable cost given the existing
  zero-consumer state.
- The `parser-Markdown` PR (story 2) is materially larger than the epic's draft
  framing because the AST cleanup (Decision 5) and validator migration
  (Decision 9) are forced into the same atomic change — deleting
  `InlineContent.markers` breaks the validator unless both move together.
- The `bodyAst` and `bodyTokens` representations partially overlap for
  inline-code (mdast `InlineCode` nodes vs `kind: "inline-code"` tokens). This
  is intentional: `bodyAst` is the structural view for renderers that need block
  hierarchy; `bodyTokens` is the flat view for highlighters and filters.
  Documented as such.

**Neutral.**

- `core/mod.ts` surface gains `BodyToken`, `BodyTokenKind`, `ModalCase`,
  `EarsTrigger`, `LineMap`, and loses `InlineMarker`, `ModalMarker`,
  `EntityRefMarker`, `EntityRef`. `EntityRefConvention` is retained and exported
  — it is referenced from the `entity-ref` token variant — and only the
  `EntityRef` record type is removed.

## Dependencies

- ADR-014 (canonical body-AST) — superseded for the marker layer only.
  Structural decisions in ADR-014 remain in force.
- ADR-015 (AST-equivalence formatting contract) — unaffected. The
  `astEquivalent` relation operates on `BodyBlock[]` and ignores marker fields;
  removing markers does not change formatter behaviour.
- **Pre-1.0 no-backward-compat policy** (May-2026 scope decision) — Decision 4
  (clean cut for `Entry.entityRefs`) and Decision 5 (clean cut for
  `InlineContent.markers`) apply this policy: until 1.0 the toolchain ships no
  migration shims and no deprecation cycles; in-tree consumers are migrated
  atomically in the same PR as the breaking change.

## Acceptance criteria

The decision is complete when:

1. `Entry.bodyTokens` is populated for every parsed entry in both the Markdown
   and source-file paths, with file-relative `SourceLocation` on every token.
2. `Entry.entityRefs`, `EntityRef`, `InlineContent.markers`, `ModalMarker`,
   `EntityRefMarker`, `InlineMarker`, `core/parser/entity_refs.ts`, and the
   marker code paths in `core/ast/build.ts` / `core/ast/normalize.ts` are
   deleted.
3. LSP `semantic_tokens.ts` no longer contains `BODY_KEYWORD_RE`,
   `GHERKIN_SECTION_RE`, `GHERKIN_STEP_RE`, `ENTITY_REF_RE`,
   `FEATURE_FENCE_OPEN_RE`, or `FENCE_CLOSE_RE`. The body-keyword path is a
   switch on `BodyTokenKind`.
4. `core/validator/modal_keywords.ts` reads `entry.bodyTokens` and contains no
   AST walk.
5. LSP semantic tokens render correctly on source-file doc comments (`.rs`,
   `.kt`, `.java`, `.c`, `.cpp`) — the regression noted in the PR #408 follow-up
   is closed.
6. All existing unit and e2e tests pass. New unit tests in
   `core/parser/body_tokens_test.ts` cover every token kind, scope-rule
   exclusion, and edge cases (escape, `$$inline$$`, modal at clause boundaries).
   New unit tests in `core/parser/source_test.ts` cover file-relative positions
   for every supported comment style. New e2e tests in
   `tests/e2e/lsp_semantic_tokens_test.ts` cover source-file rendering.

## Out of scope

- Pattern-level classification (Ubiquitous / Event-driven / State-driven /
  Optional / Unwanted — i.e., which EARS pattern an entry follows). That is a
  separate analysis layer on top of the tokens, not part of this ADR.
- Highlighting strategy for non-MarkSpec markdown files. The LSP only acts on
  MarkSpec-recognised files.
- New inline constructs beyond RFC-2119 modal verbs + EARS triggers + Gherkin
  keywords + `$Identifier` entity refs + inline code. Grammar expansion goes
  through the normal spec-amendment process.
- Lazy / on-demand `bodyTokens` computation. Eager emission matches the existing
  convention for `bodyAst`, `rawAttributes`, and `entries`; serialization,
  snapshot tests, and pattern-match clarity all favour eager.

## Story sequencing

| Story        | Scope                                                                               | Depends on |
| ------------ | ----------------------------------------------------------------------------------- | ---------- |
| 1 (this ADR) | Design decision                                                                     | —          |
| 2            | Parser (Markdown) + AST cleanup + validator migration + `Entry.entityRefs` deletion | 1          |
| 3            | Parser (source files) — `LineMap`, file-relative positions, per-language fixtures   | 2          |
| 5            | LSP `semantic_tokens.ts` migration; closes PR #408 source-file regression           | 2          |
| 7            | Skill doc updates — `markspec-ears`, `markspec-gherkin`, `markspec-prose-review`    | 2          |

Stories 3, 5, 7 may proceed in parallel once story 2 lands. The epic's draft
stories 4 (validator migration) and 6 (deprecate `Entry.entityRefs`) fold into
story 2 — they cannot be staged independently without violating the
no-compat-shim policy from Decision 4 / 5.

Each story ships as one PR with implementation + tests + docs together, on its
own worktree, per the standing `AGENTS.md` workflow rules.
