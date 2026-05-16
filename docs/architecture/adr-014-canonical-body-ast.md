# ADR-014: Canonical Body-AST and the AST-Gated Diagnostics

## Context

The Prompt-1 review's last open item ("Path A") was a structural one: entry
bodies travelled as opaque `string`; validators line-scanned them with regex;
four spec-defined diagnostics (`MSL-B044`, `MSL-M050`, `MSL-M051`, `MSL-C072`)
were structurally impossible without a real parse. ADR-012 §Decision-3 already
named these four as gated behind a body-AST refactor.

That refactor (`docs/superpowers/specs/2026-05-15-canonical-body-ast-design.md`,
plan `docs/superpowers/plans/2026-05-15-canonical-body-ast.md`) is now
implemented and on `main` across PRs #336–#341:

- `core/ast/` — node taxonomy (`nodes.ts`, spec
  `docs/specs/markspec-core-data-model.md` §2.4–2.6), builder (`build.ts`, mdast
  → `BodyBlock[]`), renderer (`render.ts`).
- A byte-identical **equivalence gate** (`tests/e2e/ast_equivalence_test.ts`):
  `format(x)` → parse → `render(entry.bodyAst) === entry.body` over fixtures +
  real project docs.
- The formatter routes body emission through the AST; the four body validators
  consume `Entry.bodyAst`.
- `MSL-B044` and `MSL-C072` are implemented on the AST.

Three findings emerged during implementation that need to be recorded as
decisions, not left implicit in code comments.

## Decision

1. **The canonical body model is `BodyBlock[]`, not `string`.** Entry bodies are
   parsed into the §2.4–2.6 AST. `Entry.body` remains a `string` field (the
   additive `Entry.bodyAst` carries the AST); validators consume the AST; the
   formatter's body emission flows through `render(buildBodyAst(...))`. The AST
   — not regex line-scanning — is the load-bearing representation for body-level
   validation and emission.

2. **The build/render inverse is NOT total over valid Markdown, and the
   formatter must degrade gracefully.** `render(buildBodyAst(s))` is
   byte-identical to `s` only for the constructs the equivalence gate covers.
   Valid prose constructs outside that set (thematic breaks, hard line breaks,
   link reference definitions, setext headings, …) do not yet round-trip. The
   formatter therefore uses a **safe conditional fallback** (PR #339): emit via
   the AST only when `render(buildBodyAst(body)) === body`; otherwise keep the
   proven string body. Net output is byte-identical to the pre-refactor string
   path for every input. "Gate green" means _trustworthy over the gate corpus_,
   never _total_. Widening the inverse toward totality is future hardening (out
   of scope here).

3. **`MSL-B044` and `MSL-C072` ship now — a bounded exception to ADR-012.**
   These are `MSL-P/I/M/F`-scheme codes that ADR-012 deferred, but ADR-012
   §Decision-3 explicitly named them AST-gated and
   structurally-impossible-without-this-refactor. Shipping them with the
   refactor (not in the later bulk scheme migration) is the intended bounded
   exception. `MSL-C072` is gated behind a new, optional
   `ProjectConfig.captionConventions` (default empty ⇒ rule inactive) — fully
   backward-compatible. ADR-012 is amended accordingly.

4. **`MSL-M050` / `MSL-M051` are deferred-by-dependency, not defects.** Their
   normative resolution chain is "ADR-005 §Part 2" per
   `markspec-core-data-model.md` §2.5.2 / §4.6. ADR-005 on `main` is _CLI
   architecture_; the referenced §Part 2 ("Resolution chain") is the **nextgen
   content-model ADR, not landed on `main`**. No in-project entity-declaration /
   resolution model is specified anywhere on `main`. Implementing M050/M051
   would require inventing that model. They are therefore deferred pending the
   entity-resolution specification. The Prompt-1 review's "M050/M051 missing"
   finding is **reclassified deferred-by- dependency**, not a Prompt-1 defect —
   same shape as ADR-012 (deferred-by-policy) and ADR-013 (deferred-by-design).

## Consequences

### What this enables

- The Prompt-1 review is fully closed: every finding is fixed or recorded as a
  decision (this ADR + ADR-012 + ADR-013).
- Body-level validation has a real AST; future body diagnostics build on it
  instead of regex.
- The formatter cutover is safe by construction (gate-proven where the AST is
  load-bearing; proven string path everywhere else).

### What shifts for existing code

- **Formatter output is byte-identical to pre-refactor for every input.** The
  fallback guard (`render(buildBodyAst(body)) === body` ? emit via AST : keep
  original string) ensures no document is modified in any way it was not already
  modified by the pre-refactor formatter. This statement is verified and
  correct.
- **Two diagnostics changed intentionally in the validator migration (PR #340).
  The "all existing diagnostics unchanged" claim in the original draft of this
  section was false and is corrected here:**
  - **MSL-B042** now emits one diagnostic per task-list _block_ (one per
    `ListNode` with `hasTaskItems: true`) rather than one per task-list _item_
    line. For a body containing a 3-item task list: was 3 diagnostics, now 1.
    This is **accepted as intentional** — the AST-based approach is structurally
    cleaner, the error/exit code is unchanged, and the new behaviour is pinned
    by a regression test (see PR #341 follow-up).
  - **MSL-M060** now fires on _any_ non-canonical-case modal keyword (e.g.
    title-case `Should`, `Shall`) rather than only on fully-uppercase forms
    (`SHOULD`, `SHALL`). This is a behaviour broadening that is arguably more
    spec-correct but was shipped unlabelled. Its warning message still says "is
    uppercase" even for title-case forms, which is inaccurate. This is recorded
    as **known tracked debt** — not fixed in this follow-up (see "Known debt"
    under Out-of-scope below).
- Future work inherits two defined obligations: widen the build/render inverse
  toward totality (shrinking the string-fallback set), and specify the
  entity-resolution model that unblocks M050/M051.

### Trade-offs accepted

- The AST is computed on every `format()` of an entry-bearing document even
  where the string fallback ultimately wins — accepted for a formatter (parse
  cost is small) and to keep the AST load-bearing.
- Two of the four AST-gated codes (M050/M051) remain unshipped; the reviewer's
  raw "4 codes" expectation is only half-met, but correctly framed as
  deferred-by-dependency.

## Dependencies

- [ADR-012](./adr-012-diagnostic-code-scheme.md) — amended by this ADR (bounded
  exception for B044/C072; M050/M051 deferral).
- [ADR-013](./adr-013-document-directive-not-a-resolution-step.md) — sibling: a
  review finding resolved by recorded decision.
- `docs/specs/markspec-core-data-model.md` §2.4–2.6 (node taxonomy), §2.5.2 /
  §4.6 (the M050/M051 resolution-chain reference that is not satisfiable on
  `main`).
- The nextgen content-model ADR (unlanded) — must land, defining the
  entity-resolution model, before M050/M051 can be implemented.

## Acceptance criteria

- This ADR is merged to `main`.
- ADR-012 carries the bounded-exception amendment.
- The AGENTS.md ADR index lists ADR-014.
- The dangling "ADR-005 §Part 2" reference for M050/M051 in
  `markspec-core-data-model.md` §4.6 is annotated as deferred on `main` (pointer
  to this ADR).
- No code change accompanies this ADR (PRs #336–#341 already shipped the
  implementation).

## Out of scope (future work)

- Widening the build/render inverse toward totality (hard breaks, link reference
  definitions, setext/thematic, …) to shrink the formatter's string-fallback
  set.
- The entity-resolution model (the nextgen content-model ADR §Part 2) that
  unblocks `MSL-M050` / `MSL-M051`.
- Extracting `emitBodyViaAst` + body-geometry helpers out of `formatter/mod.ts`
  into a focused module (tracked code-quality follow-up).
- The broader `MSL-P/I/M/F` scheme migration (still ADR-012's deferred phase).
- **Known debt — MSL-M060:** The validator migration (PR #340) broadened M060's
  trigger beyond all-uppercase modals to any non-canonical-case form (including
  title-case `Should`, `Shall`). Its warning message still reads "is uppercase"
  for forms that are merely title-case, not fully uppercase — the wording is
  inaccurate. Both the trigger broadening and the message inaccuracy are tracked
  debt; neither is addressed in this ADR or its follow-up PR.
