# ADR-015: AST-Equivalence Formatting Contract

## Context

ADR-014 Decision-2 recorded that the build/render inverse is not total over
valid Markdown, and mandated a **safe conditional fallback** in the formatter:
emit via the AST only when `render(buildBodyAst(body)) === body`; otherwise keep
the original string body. This byte-identical guard ensured no document was
modified in a way it was not already modified by the pre-refactor formatter.

SP2 (PR #351) materially widened the build/render inverse. The post-SP2 fidelity
matrix reached 0/58 LOSS/UNREPRESENTABLE rows. Two `NORMALIZE` rows remained —
`edge-blank-line-runs` and `edge-leading-trailing-ws` — both §5.2-permitted
rewrites the formatter already handled at the string level. The byte-identical
guard was the only thing preventing those rewrites from flowing through the AST.

SP3 is the chartered sub-project that replaces the byte-identical guard with a
semantic, AST-level correctness criterion.

The SP1 fidelity work defined `astEquivalent` (strict `BodyBlock[]`
deep-equality ignoring every `SourceRange`) and measured the corpus. It lived in
`tests/e2e/ast_fidelity.ts` as a test-local helper. SP3 ratifies that relation
into the production codebase and makes the formatter's correctness criterion
explicit.

## Decision

1. **`astEquivalent` is ratified as the production correctness relation.** The
   function is promoted, unchanged, from `tests/e2e/ast_fidelity.ts` into
   `packages/markspec/core/ast/equivalence.ts` and exported via `core/mod.ts`.
   The relation is **SP1's strict `BodyBlock[]` structural deep-equality
   ignoring every `SourceRange` field** — no semantics added or changed. It is
   now load-bearing (formatter gate, fidelity harness) rather than
   measurement-only.

2. **`normalizeBodyAst` is the formatter-only §3.4 AST pass.** A new pure module
   `packages/markspec/core/ast/normalize.ts` provides
   `normalizeBodyAst(blocks: readonly BodyBlock[]): BodyBlock[]` —
   deterministic, total, idempotent, no `Deno.*`. It applies §3.4.1
   modal-keyword case normalization (RFC-2119 → lowercase; EARS → lowercase
   unless sentence-initial) directly on the AST. It is **called only from the
   formatter path**; the validate path never calls it and continues to see the
   un-normalized `Entry.bodyAst`. `MSL-M060` continues to fire on
   uppercase/non-canonical modal keywords in the validate path.

3. **The byte-identical guard in `emitBodyViaAst` is replaced by the
   `astEquivalent` guard, and `MSL-F900` is added.** The formatter's body
   emission now follows:

   ```
   ast0      = buildBodyAst(entry.body)
   canonical = normalizeBodyAst(ast0)
   emitted   = render(canonical)
   if (!astEquivalent(buildBodyAst(emitted), canonical)) {
     emit MSL-F900 (formatter fallback: body-AST equivalence gate failed)
     keep original body string                      // anti-corruption
   } else {
     splice(emitted)                                // active canonicalization
   }
   ```

   The string-keep fallback is **retained** — it is the anti-corruption
   mechanism, never removed. `MSL-F900` is the loud diagnostic that surfaces any
   genuine residual to the maintainer. The fallback never fires over the SP3
   corpus (58 samples) or the project's own documents. This decision retires
   ADR-014 Decision-2's non-total-inverse / safe-conditional-fallback caveat.

4. **The fidelity classifier evolves to build/render/format with RESIDUAL=0.**
   The SP1 matrix's `OK/NORMALIZE/LOSS/UNREPRESENTABLE` classes are replaced by
   `OK/UNOWNED/RESIDUAL`:

   - **`OK`** — the formatter canonicalizes the sample, is idempotent on it, and
     `astEquivalent(buildBodyAst(format(x)), normalizeBodyAst(buildBodyAst(x)))`
     holds. Subsumes the former `NORMALIZE` class.
   - **`UNOWNED`** — the sample is all-Unknown-verbatim (excluded construct
     preserved as-is per §2.4.1); the formatter correctly leaves it untouched.
   - **`RESIDUAL`** — the equivalence contract fails. Must be 0.

   End-state: `OK=56, UNOWNED=2, RESIDUAL=0` over 58 corpus samples. The
   staleness gate (`scripts/check_ast_fidelity_matrix.sh`) is a CI gate.

## Consequences

### What this enables

- ADR-014 Decision-2's "non-total inverse / safe conditional fallback" caveat is
  retired. The formatter now actively canonicalizes body content via the AST for
  all constructs in scope.
- Body-internal §3.4.1 normalization flows through the AST; the pre-AST string
  passes for modal keywords over the body zone are removed from the formatter
  (title/trailer paths are unaffected).
- `astEquivalent` is a first-class, tested production function rather than a
  test-local helper.
- RESIDUAL=0 over the corpus: there are no known constructs where the formatter
  would silently corrupt a body.

### What shifts

- **Formatter output is no longer byte-identical to the pre-SP3 formatter for
  inputs with uppercase modals or non-canonical blank-line runs.** Those inputs
  now receive the correct §3.4.1 canonical form. All previously-canonical
  documents are unaffected (`docs/product` zero-diff verified).
- The defensive `MSL-F900` path exists but has never fired. If it fires in
  production it indicates a genuine un-owned construct and surfaces to the
  maintainer rather than silently retaining a non-canonical body.
- `UNOWNED` rows in the fidelity matrix are correct behaviour, not defects — the
  formatter preserves excluded constructs verbatim per §2.4.1 / §5.4.

### Trade-offs accepted

- `normalizeBodyAst` adds an AST traversal on every formatted entry bearing
  modal keywords. Cost is negligible for a formatter invoked pre-commit.
- The validator path never sees the normalized AST — `Entry.bodyAst` remains the
  un-normalized parse product. This is intentional: `MSL-M060` reports uppercase
  modal keywords as a lint finding; the formatter's normalization does not
  silently satisfy the lint.

## Dependencies

- [ADR-014](./adr-014-canonical-body-ast.md) — Decision-2 is retired by this
  ADR. Decisions 1, 3, and 4 are unaffected.
- `packages/markspec/core/ast/equivalence.ts` — production `astEquivalent`.
- `packages/markspec/core/ast/normalize.ts` — production `normalizeBodyAst`.
- `docs/specs/markspec-core-data-model.md` §5.6 — normative formalization of the
  contract (added by SP3).
- `docs/product/ast-fidelity-matrix.md` — committed fidelity catalogue;
  staleness gate.

## Acceptance criteria

- This ADR is merged to `main`.
- ADR-014 carries a forward-pointer note at Decision-2.
- The AGENTS.md ADR index lists ADR-015.
- `docs/specs/markspec-core-data-model.md` §5.6 states the formal contract.
- `core/ast/equivalence.ts` exports `astEquivalent`; `core/mod.ts` re-exports
  it.
- `core/ast/normalize.ts` exports `normalizeBodyAst`; `core/mod.ts` re-exports
  it.
- The formatter's `emitBodyViaAst` is gated by `astEquivalent`, not
  byte-equality.
- `MSL-F900` is emitted on fallback.
- The fidelity matrix shows `RESIDUAL=0`.
- The staleness gate exits 0.
- `just check` green; `dprint check` green.

## Out of scope

- Widening `normalizeBodyAst` beyond §3.4.1 modal keywords — any future §3.4
  body rewrite belongs in a subsequent ADR amendment.
- The entity-resolution model that unblocks `MSL-M050` / `MSL-M051` — still
  deferred-by-dependency (ADR-014 Decision-4 unchanged).
- Multi-item `DefinitionList` semantics — already round-trips `OK`, deferred.
- The broader `MSL-P/I/M/F` scheme migration — still ADR-012's deferred phase.
- Title-line and trailer-block §3.2 / §3.3 rewrites — separate deterministic
  rules outside the body-AST scope.
