# ADR-020: Prose-Analysis Flagship Build (Stage-2 PA-3)

## Status

Accepted, 2026-05-25.

## Context

Stage-2 prose-analysis build (PA-3).
[markspec-prose-analysis.md](../spec/internal/markspec-prose-analysis.md) is the
authoritative contract. This ADR records the build-time decisions made on top of
that spec where the spec leaves them open, and pins the most consequential spec
decisions in the ADR catalogue so future contributors hit them before
re-litigating.

PA-1 shipped in PR #362 (lexicon, struct, suppression rules — Q302/Q303/
Q304/Q305/Q310/Q313/Q400/Q401/Q900/Q901). PR #430 ratified §8 OQ4 / OQ5 / OQ6
(glossary-only subset resolver, English-baseline allowlist, score roll-up
shape).

This build (PA-3) adds the flagship MSL-Q500 (xref-glossary-undefined), the
rule-based sentence segmenter, the glossary-only resolver, the EARS / modal /
INCOSE sentence-level rules, and the score roll-up emitter.

## Decision

1. **Q500 ships under partial resolver coverage; the `$Identifier` and profile
   Aliases legs degrade-to-silent via a no-op integration hook.**

   Spec §2.8 and §8 OQ4 already commit to the glossary-only subset resolver.
   This ADR pins the _integration seam_: Q500's resolver order takes an
   `IsIdentifierHook` callback that returns `false` today and is plugged into
   the ADR-016 marker pass when it lands. The seam is part of the contract —
   removing it would re-litigate OQ4. The behavioural invariant is strict: more
   tokens resolve as the resolver grows → the rule fires _less_, never _more_
   (additive enrichment, §2.8). A future change that violates this invariant is
   a defect, not a refinement.

2. **Q500 multi-word phrase grammar is fixed at ≥2 adjacent Capitalized tokens
   with up to 2 lowercase connectors (`of` / `the` / `and`).**

   Spec §2.8 says "PascalCase or Capitalized multi-word domain phrase" without
   pinning the multi-word boundary. The build pins it as above:

   - `Brake Controller Unit` → one phrase.
   - `Active Distance Sensor` → one phrase.
   - `Brake Controller of the Unit` → one phrase (two connectors).
   - `Brake of the Vehicle System` → not a phrase (three connectors).

   Drift in this grammar changes which entries fire. The rule is locked here so
   it is not silently renegotiated in a later refactor.

3. **The sentence segmenter is rule-based, not `Intl.Segmenter` or external
   NLP.**

   Spec §5.1 / §5.2 commit to rule-based. This ADR pins the _why_ in the
   catalogue: cross-V8-version drift in `Intl.Segmenter` would silently break
   snapshot tests, and an external NLP library would add a non-deterministic
   dependency. The abbreviation lexicon (`prose.lexicons.sentence-abbrev`) is
   the user-extensible escape hatch, list-additive across profile tiers per
   profile-schema §5.1. Reaching for a smarter algorithm is not the right
   escalation path; extending the lexicon is.

4. **Score roll-up bands are fixed at `0` / `1-3` / `4-7` / `8-15` / `16+`.**

   Spec §3.1 leaves bands unspecified. The build pins them. Widths follow the
   default warn weight (3) — each band corresponds roughly to "one more
   warn-weight finding". Uniform 5-wide bins would collapse the most actionable
   distinction (clean vs. one warn). Lower bins are intentionally fine-grained
   because that is where actionable entries live; the upper band absorbs the
   long tail.

5. **No trend artifact in core. Ever.**

   Spec §3.3 + §8 OQ6 commit. Restated here so future contributors hit this ADR
   before proposing a CI score badge, PR-comment integration, dashboard, or
   score-delta output. The score is computed and emitted (CLI text +
   `--format json`); teams compute trends in their own CI if they want. Core
   stays out of the trend-output business _by design, not by omission_. This is
   a deliberate non-feature — the Goodhart guard from spec §3.3 ("the score is a
   smoke detector, not a KPI") is load-bearing.

6. **Profile-config plumbing is deferred to a follow-up epic; only the two prose
   lexicons (`prose.lexicons.capitalized-allow`,
   `prose.lexicons.sentence-abbrev`) are plumbed in this build.**

   This is a scope decision, not a design one. The flagship Q500 needs the
   capitalized-allow extension to be usable in compliance projects — otherwise
   ASIL / ECU / CAN-style domain vocabulary floods the diagnostic stream. The
   sentence-abbrev extension is needed for the segmenter to handle domain
   abbreviations.

   Everything else (severity promotion, weights, groups, `scope.types` /
   `scope.blocks` narrowing, `score.threshold`) stays at core defaults.
   **MSL-Q202 (modal-prohibited) ships as a no-op until the follow-up epic
   lands** — spec §2.5 already says it is "inert with no profile", so this
   matches the spec.

7. **Lexicons are bundled into the binary at compile time via
   `deno compile --include`; loaded once at module init as
   `ReadonlySet<string>`.**

   Spec §5.4 mandates "no I/O on the hot path". The build pins the mechanism:
   text files under `packages/markspec/core/lexicons/` are compile-time
   `--include` assets; a `loadLexicon(name)` helper parses on first call and
   caches the result. Adding a new core lexicon is two steps: drop the `.txt`,
   register the URL. Future contributors tempted to wire YAML or to lazy-load
   from disk hit this ADR first.

## Consequences

### What this enables

- Q500 ships now, against the resolver coverage realistically available on
  `main`.
- The ADR-016 marker-pass implementer plugs into a documented hook with zero
  changes to the rule.
- Future contributors touching the multi-word phrase grammar, the segmenter, or
  the score bands hit this ADR before changing them.

### What this defers

- `$Identifier` / RIDL rules (need ADR-016 marker pass).
- MSL-Q501 / MSL-Q502 cross-entry semantic clustering — the hardest subset of
  xref; deferred until the flagship has bedded in.
- MSL-Q202 modal-prohibited (needs profile severity / group plumbing).
- Profile severity promotion (needs profile config plumbing).
- Per-rule documentation pages for non-flagship rules (Q500 page ships with this
  build; the rest follow in the user-docs epic per markspec-user-docs.md §1).

### What this rules out (non-features)

- Trend artifacts of any kind (PR comments, dashboards, score deltas).
  Decision 5.
- Auto-fix for prose. Spec §5.3 design call; restated here so the rule remains
  visible.
- LLM / AI critique on the hot path. Spec §5.1 options analysis; out-of-band
  integrations stay loosely coupled (like Vale, companion-guide §5.5).

### Risks

- The multi-word phrase grammar (Decision 2) is opinionated. Repositories with
  consistent `Brake Controller`-style capitalization will see false positives
  the `capitalized-allow` lexicon must absorb. Q902 (unused suppression)
  surfaces stale escape hatches; the per-rule doc page documents the heuristic's
  edges.

- The `runLint` pipeline becomes async in this build (needs to read glossary
  files to build the resolver index). Callers (CLI, LSP, tests) require
  mechanical updates. Documented in the build plan; no behavioural change beyond
  the signature.

## Dependencies

- **PA-1** (PR #362) — lint runner, suppression hygiene, lexicon-rule module.
- **ADR-014 / ADR-015** (canonical body-AST, equivalence contract) — Q500 walks
  `Entry.bodyAst` paragraph and definition-list nodes.
- **ADR-016** (body-token AST) — the marker-pass implementer plugs into Decision
  1's hook.
- **listing-directives §4.2** — glossary `Definition` slug derivation (R4-c) and
  R4-g aliases.

## Out of scope

- Vale `--include-vale` integration (§8 OQ7 still open).
- LLM / AI critique (future epic).
- Non-English prose (future epic).
- Per-rule doc pages for non-flagship rules (deferred to user-docs epic).
- `.markspec/lint.yaml` project-level config (deferred — profile is the stronger
  compliance authority and ships first).

## References

- [markspec-prose-analysis.md](../spec/internal/markspec-prose-analysis.md) —
  authoritative spec.
- [ADR-012](./adr-012-diagnostic-code-scheme.md) — `MSL-Q` is a net-new addition
  to the catalogue (§2.1).
- [ADR-014](./adr-014-canonical-body-ast.md) — `BodyBlock[]` model consumed by
  Q500.
- [ADR-016](./adr-016-body-token-ast.md) — marker pass; Decision 1's integration
  target.
- [listing-directives §4.2](../spec/internal/markspec-listing-directives.md) —
  glossary slug derivation.
- PR #362 — PA-1 implementation.
- PR #430 — §8 OQ4 / OQ5 / OQ6 ratification (2026-05-25).
