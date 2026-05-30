# ADR-013: Document Directive Is a Formatter Concern, Not a Validator Resolution Step

## Context

The Prompt-1 review listed the type-resolution chain as partially implemented,
with "step 7 — document directive → core type" missing. The chain (steps 1–8) is
enumerated in `validator/type_resolution.ts` and references "spec §1.3.1"; the
code already disclaims step 7: "Step 7 (document directive) is not consulted
here."

Investigation shows "step 7" is not a clean implementation gap — it is a
spec-interpretation decision:

- **The shipped spec scopes the directive to the formatter.** `language.md` §3.2
  defines the family-hint directives (`markspec:specs`, `markspec:tests`,
  `markspec:elements`) as hints that "hint at the predominant entry family in
  the document — used by `markspec fmt` to classify **new entries before they
  carry an identity attribute**." That is a `markspec fmt` scaffolding concern,
  not a validation-time type-resolution rule.
- **A document-context resolution step contradicts a stated invariant.**
  `language.md` §2.4 states entry resolution is "**Independent of document
  context** — shape is intrinsic to the entry, not dependent on which document
  it appears in." Resolving an identified entry's core type from the surrounding
  document's directive would violate that invariant.
- **The numbered chain is a code/ADR construct.** `language.md` has no literal
  numbered §1.3.1 "steps 1–8" block; the enumeration lives in code comments.
  "Step 7" therefore has no shipped-spec semantics to conform to (which family
  maps to which core type, and `Specification` is abstract).
- **A validator wiring would be invasive on a debatable reading.**
  `resolvedCoreType(entry: Entry)` is pure on the entry. Threading
  document-directive context through it touches ~6 call sites plus the pipeline
  — a real API change to implement a step the spec does not require at
  validation time and the code already disclaims by design.

This is the same shape of finding as ADR-012: a review item that is actually a
recorded decision, not a code defect.

## Decision

1. **The family-hint document directive is a `markspec fmt` new-entry
   classification aid, not a validator type-resolution step.**
   `resolvedCoreType` remains pure on the entry; no document-directive context
   is threaded through the core resolution API.

2. **"Step 7" is intentionally absent from the validator chain on `main`.** The
   existing by-design disclaimer in `validator/type_resolution.ts` is ratified.
   The validator chain is steps 1–6 plus the late-stage step-8 warning stage;
   there is no step 7.

3. **The review finding is reclassified.** "Type-resolution chain step 7
   missing" is **deferred-by-design**, not a Prompt-1 defect. This ADR closes
   that finding.

4. **Future formatter work is bounded.** If family-hint new-entry classification
   is implemented in `markspec fmt`, it ships as a format-path feature with its
   own family → core-type mapping specified in `language.md`. It must not alter
   type resolution for entries that already carry an identity attribute —
   consistent with the §2.4 "independent of document context" invariant.

## Consequences

### What this ADR enables

- The type-resolution chain finding is correctly closed: steps 1–6 + 8 are the
  chain; step 7 is not a validation concern.
- `resolvedCoreType` stays a pure, entry-only function — no document-context
  plumbing across the validator, keeping the resolution API small and testable.
- The §2.4 "independent of document context" invariant is preserved.

### What shifts for existing code (not yet implemented)

- Nothing changes in shipped code. The code comments in `type_resolution.ts` /
  `types.ts` that disclaim step 7 are now backed by a recorded decision rather
  than a TODO.

### Trade-offs accepted

- `markspec fmt` does not yet auto-classify a brand-new identity-less entry from
  a family-hint directive. That ergonomic is deferred to a future format-path
  feature; it is not a correctness gap (a new entry without a resolvable type
  already surfaces through the normal diagnostics once authored).
- The reviewers' raw "type chain 30% / step 7 missing" framing stands in the
  numbers, but is correctly reclassified as deferred-by-design.

## Dependencies

- [`docs/spec/language/language.md`](../spec/language/language.md) §2.4
  (context-independence invariant) and §3.2 (family-hint directives scoped to
  `markspec fmt`).
- [ADR-012](./adr-012-diagnostic-code-scheme.md) — sibling decision: a review
  finding resolved by recorded policy rather than code.

## Acceptance criteria

- This ADR is merged to `main`.
- The Prompt-1 review's "type-resolution step 7 missing" finding is recorded as
  closed by decision (deferred-by-design).
- No validator/resolution code change accompanies this ADR.
- The AGENTS.md ADR index lists ADR-013.

## Out of scope (future work)

- `markspec fmt` family-hint new-entry classification and its family → core-type
  mapping specification.
- Any change to the §1.3.1 chain enumeration in code comments (left as-is; the
  disclaimer is now ADR-backed).
