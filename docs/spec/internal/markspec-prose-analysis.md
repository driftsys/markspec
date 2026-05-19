# MarkSpec — Prose Analysis & Requirement-Quality Lint

Status: Draft (Prompt 5 of the next-gen refactor — Stage 2)\
Date: 2026-05-17\
Scope: MarkSpec `lint` prose-analysis pass (the requirement-quality diagnostics,
not the structural/parse contract frozen by Prompt 1)\
Builds on: core-data-model (Prompt 1), profile-schema + listing-directives
(Prompt 2), toolchain-distribution + e2e-test-strategy (Prompt 3), user-docs
(Prompt 4); ADR-001 (Markdown format), ADR-002 (entry model), ADR-003
(information & traceability model), ADR-004 (authoring model), ADR-005 (entry
content model), ADR-006 (listing directives), ADR-012 (diagnostic-code scheme)\
Normative external sources: INCOSE Guide to Writing Requirements (GtWR),
INCOSE-TP-2010-006-04, June 2023 — **v4** rule set R1–R42 and characteristics
C1–C15; EARS (Mavin et al., Rolls-Royce, 2009 —
<https://alistairmavin.com/ears/>); RFC 2119 / RFC 8174; ISO/IEC/IEEE 29148:2018
§9.5; Gherkin (Cucumber reference, <https://cucumber.io/docs/gherkin/reference>)
— cited only at the Feature-block boundary

This spec freezes the **prose-analysis pass** of `markspec lint`:
requirement-quality diagnostics (EARS conformance, modal-verb usage, INCOSE GtWR
rules, structural quality, cross-entry consistency) and an **informational**
priority score. It does not specify implementation (Stage-2 build prompts), the
structural lint contract (core-data-model §4, authoritative and unchanged here),
or the narrative authoring guide (a Stage-2 user-docs deliverable —
markspec-user-docs.md §1, §2).

Prose analysis is **lint, not `fmt`**. It reports; it never rewrites prose
(AGENTS.md "Formatters over linters-that-format"; core-data-model §3 "`fmt` is a
formatter, not a linter").

The companion authoring guide (`requirements-writing-guide.md`, the
INCOSE-GtWR-derived narrative taught to engineers) is the **teaching** surface;
this spec is the **contract**. The companion guide's GtWR rule numbering is
**non-conformant with v4** (Annex C) and its uppercase-`SHALL` recommendation
contradicts core-data-model §3.4.1 — where they differ, this spec and the merged
Stage-1 specs are authoritative (nextgen/README §Spec authority); §8 records the
reconciliations the companion guide needs.

---

## 0. Terminology

| Term                   | Meaning in this spec                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **prose analysis**     | The `markspec lint` pass that evaluates natural-language requirement quality. Distinct from the structural pass (core-data-model §4).                                                         |
| **in-scope entry**     | An entry whose resolved `Type:` is `Specification` or a profile concrete subtype rooted at `Specification`/`Requirement`/`Risk` that the active profile opts in (§1).                         |
| **normative sentence** | A sentence (tree-sitter segmented) inside an in-scope body block that contains at least one RFC 2119 modal marker (`ModalMarker`, core-data-model §2.5.1).                                    |
| **rule**               | One prose-analysis diagnostic. Carries a stable machine code (`MSL-Q###`) and a stable human slug (`<group>-<name>`).                                                                         |
| **group**              | One of `ears` / `modal` / `incose` / `struct` / `xref` (§2). Organizes rules; the unit a profile or `.markspec/lint.yaml` enables/disables.                                                   |
| **priority score**     | A per-entry weighted roll-up of triggered rules (§3). **Informational by default — never a CI gate unless a profile opts in.**                                                                |
| **lexicon**            | A named, profile-mergeable word list a rule consults (e.g. the R7 vague-term lexicon, the R8 escape-clause lexicon, the capitalized-word allowlist).                                          |
| **suppression**        | An author-declared, rationale-bearing waiver of a rule on one entry (§4.2).                                                                                                                   |
| **companion guide**    | `requirements-writing-guide.md` — the narrative GtWR/EARS authoring guide. A Stage-2 user-docs artifact, not a normative spec (markspec-user-docs.md §1 "prose-quality lint docs … Stage 2"). |

> **Naming overlap notice.** core-data-model §0's `MSL-M` "Marker" category
> already owns modal-keyword **token** rules (`MSL-M060`, `MSL-M061`) and
> `$Identifier` **resolution** (`MSL-M050`, `MSL-M051`). Prose analysis
> introduces the new `MSL-Q` category for **sentence- and entry-level
> requirement quality** and **cites — never re-emits** the `MSL-M` codes (§2.2,
> §2.5). The two passes are orthogonal: `MSL-M` is "is this token a modal / does
> this `$Id` resolve"; `MSL-Q` is "is this _requirement_ well formed".

---

## 1. Scope and intent

### 1.1 What prose analysis runs on

Prose analysis runs **only on in-scope entries** (§0), after the parser has
produced the AST (core-data-model §2) and the type-resolution chain has resolved
`Type:` (core-data-model §1.3.1). It keys off the **resolved** type, so it
composes with profile subtypes without re-implementing inference.

| Type (core-data-model §1.3)                                    | Prose analysis                                | Why                                                                                                                                                                   |
| -------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Specification`, `Requirement`, profile `requirement`/`hazard` | **in scope, default on**                      | These carry normative obligations — the genre EARS / GtWR target.                                                                                                     |
| `Test`, `Contract`, `Record`, `Risk` (non-`hazard`)            | in scope, **default off**, profile may opt in | Specifications by taxonomy but rarely prose-graded the same way.                                                                                                      |
| `Component`, `Unit` (+ subtypes)                               | out of scope                                  | Architecture/implementation nodes — not requirement prose (prompt §1).                                                                                                |
| `Reference`-shape entries                                      | out of scope                                  | Cited external artifacts; the project does not own their prose.                                                                                                       |
| Glossary (`Definition`, listing-directives §4)                 | out of scope as a _subject_                   | A `Definition` is reference material, not a requirement (EARS does not fit definitions). It is, however, the _resolution target_ for the flagship `xref` rule (§2.8). |

Scope is profile-tunable (`prose.scope.types`, §4.1) but the **default on-set is
`Requirement`-rooted + `hazard` only** — narrow by construction, matching the
"requirements-authoring is a narrow genre" stance of ADR-005 §Context.

### 1.2 Which body blocks

Inline markers are recognized only inside `Paragraph`, `List` item, `Table`
cell, `Note` body, `Blockquote`, and `DefinitionList` term/definition, and
**never** inside `Code`, `Feature` (Gherkin), or `Math` (core-data-model §2.5 —
verbatim content). Prose analysis honors exactly that boundary, and narrows
further by default:

| Block                      | Default | Rationale                                                                                                                                 |
| -------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Paragraph`                | **on**  | The normative obligation lives here.                                                                                                      |
| `List` item                | opt-in  | Often enumerated sub-conditions; EARS matching mis-fires on fragments.                                                                    |
| `Note` body                | opt-in  | Set-aside content (warnings, asides) — usually non-normative.                                                                             |
| `DefinitionList` value     | opt-in  | Inline definitions read like glossary prose, not requirements.                                                                            |
| `Table` cell, `Blockquote` | off     | External excerpts / tabular data — not the project's normative voice.                                                                     |
| `Code`, `Feature`, `Math`  | never   | Verbatim by core contract (core-data-model §2.5). `Feature` blocks are Gherkin (Cucumber reference); their analysis is out of scope (§7). |

`prose.scope.blocks` (§4.1) opts the opt-in blocks in. The never-row is not
profile-overridable (it would contradict core-data-model §2.5).

### 1.3 Intent and non-goals

- **Inline markers are signal.** `ModalMarker` and `EntityRef` (core-data-model
  §2.5) are the analyzer's primary input — it consumes the AST, it does not
  re-parse prose.
- **Lint reports; the author fixes.** No prose auto-fix beyond none — see the
  options analysis in §5.3 and §7. Modal **case** normalization is `fmt`'s job
  (`MSL-M060`/`MSL-F103`, core-data-model §3.4.1, §4.9), not this pass's.
- **Honest about precision/recall.** A clean EARS sentence is easy to recognize;
  a _malformed attempt_ at EARS and a _perfectly good non-EARS_ requirement are
  not. The catalog defaults the fuzzy rules to `info`, fires EARS rules **only
  on normative sentences**, and never claims a structural matcher can judge
  semantics (§2, §7).

### 1.4 Options analysis — the analysis unit

| Alternative                                          | Rejected / chosen because                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-entry only (one verdict per entry)               | **Rejected.** A single weak sentence in a five-paragraph rationale would tar the whole entry, and the diagnostic could not point at the offending span (clig.dev / GtWR `file:line:col` expectation).                                                                                                    |
| Per-paragraph only                                   | **Rejected.** EARS conformance, compound-modal, and modal counting are _sentence_-level; a paragraph straddles several obligations.                                                                                                                                                                      |
| Per-sentence matcher, per-entry roll-up (**chosen**) | The diagnostic is emitted at the offending sentence's range; the **score** (§3) is an entry-level roll-up. Sentence is the matching unit, the in-scope block is the filter, the entry is the reporting/scoring unit. Matches GtWR §8's diagnostic format and the priority score being an entry property. |

---

## 2. Diagnostic catalog

### 2.1 Code scheme — `MSL-Q`, dual-identified

Every prose-analysis rule carries **two stable identifiers**:

- a machine code `MSL-Q<nnn>` — the established `MSL-<Category><nnn>` shape
  (core-data-model §4; "Q" = requirement **Q**uality), the alias tooling, CI
  rules, and snapshots key on;
- a human slug `<group>-<name>` (e.g. `ears-no-pattern`,
  `incose-r18-single-thought`) — the surface authors read, suppress (§4.2), and
  follow to a doc page (§6).

**Options analysis — code scheme.**

| Alternative                                                    | Rejected / chosen because                                                                                                                                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Free-string slugs only (`ears-001`)                            | **Rejected.** Code names are a public interface — suppression comments, CI config, snapshots, downstream consumers (ADR-012 §Context). A non-`MSL` namespace fractures the one stable contract every other pass uses.                                  |
| Reuse the companion guide's `markspec/<rule>` form as the code | **Rejected.** The `markspec/` prefix duplicates the LSP diagnostic `source: "markspec"` field already set by the bridge (lsp/diagnostics.ts), and is not the `MSL-` shape core-data-model §4 froze.                                                    |
| Spread rules across the existing `M`/`B`/`R` letters           | **Rejected.** `M` is _inline-marker token_ rules, `B` is _body-block structure_, `R` is _trace resolution_. Sentence-level EARS conformance is none of those; folding it in dilutes three catalogs and makes the prose pass un-disable-able as a unit. |
| **New `MSL-Q` category + dual slug (chosen)**                  | Keeps the `MSL` machine contract intact, gives authors a readable namespace in the prompt-mandated `ears/modal/incose/struct/xref` groups, and lets the whole pass be enabled/disabled as one category. Net-new — no current-scheme code is renamed.   |

**Relationship to ADR-012.** `MSL-Q` is a **net-new addition** to the nextgen
catalogue ADR-012 governs — it renames nothing and has no current-scheme
equivalent, exactly the situation ADR-012 §6 used to ship `MSL-B044`/`MSL-C072`
ahead of the broad migration. Prose analysis is a Stage-2 feature gated behind
the nextgen core landing on `main` (ADR-012 Decision 3); per nextgen/README
§Spec authority this spec is its build target and fixes the ordinals below.
Adding the `Q` letter to the ADR-012-tracked catalogue and reserving its ordinal
block is recorded as §8 open question 1.

### 2.2 What this pass does **not** own

To honor "do not duplicate or contradict the merged specs; cite them", prose
analysis **defers to and never re-emits**:

| Concern                                  | Owned by (authoritative)                                   | Prose-analysis behavior                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Modal token in **uppercase**             | `MSL-M060` (warning; `fmt` lowercases) — core §3.4.1, §4.6 | Cited by the `modal` group; not re-reported. Case policy is `fmt` + the marker pass, not prose analysis (§8 OQ3). |
| Requirement entry with **no modal**      | `MSL-M061` (info; profile may promote) — core §4.6         | The `modal` group **references** `MSL-M061`; it does not mint a parallel "modal-missing" code.                    |
| `$Identifier` **does not resolve**       | `MSL-M051` (error) — core §4.6, §2.5.2                     | The `xref` group consumes resolution results; it never re-emits unresolved-`$Id`.                                 |
| `$Identifier` **case ≠ entity kind**     | `MSL-M050` (warning) — core §4.6, §2.5.2                   | Same — consumed, not duplicated.                                                                                  |
| Trace target unknown / type-incompatible | `MSL-R080`/`MSL-R083` — core §4.8                          | The `xref` group is about _prose↔trace consistency_, not target existence/type (core owns that).                  |
| Heading/HR/task-list/raw-HTML in body    | `MSL-B040..B043` — core §4.5                               | Structural; out of the prose pass entirely.                                                                       |

> **Dependency note.** `MSL-M050`/`MSL-M051` are **deferred-by-dependency** on
> `main` (core-data-model §4.6 implementation-status note; ADR-012 §6): their
> resolution chain is normative per the nextgen content-model ADR not yet
> landed. Every `xref` rule that needs `$Identifier`/glossary resolution
> inherits that gate — see §5.4 and §8 open question 4.

### 2.3 Catalog conventions

For each rule: **code · slug · severity (core default) · description · source
cite · trigger · fix**.

- **Severity** is the _core default_. Per core-data-model §4.10 a profile may
  **promote** `info`→`warning`→`error` but **never demote**; no prose-analysis
  rule defaults to `error` (§3 — "scoring is a trap"; a prose rule failing CI is
  always a profile's explicit choice).
- **Source cite** uses the **canonical INCOSE GtWR v4** rule numbers
  (INCOSE-TP-2010-006-04, June 2023; verified against the v4 summary sheet —
  Annex C), the **canonical EARS** patterns (Mavin et al., 2009), RFC 2119 / RFC
  8174, and ISO/IEC/IEEE 29148:2018 §9.5. The companion guide uses a different,
  non-conformant numbering; Annex C records the reconciliation it needs.

### 2.4 Group A — EARS pattern conformance (`ears-*`)

Canonical EARS (Mavin et al., 2009) defines five patterns plus a complex
combination, each with a mandatory `the <system name> shall <response>` core and
a leading clause:

| Pattern                | Leading clause | Canonical template                                                    |
| ---------------------- | -------------- | --------------------------------------------------------------------- |
| **Ubiquitous**         | (none)         | `The <system> shall <response>`                                       |
| **State-driven**       | `While`        | `While <precondition>, the <system> shall <response>`                 |
| **Event-driven**       | `When`         | `When <trigger>, the <system> shall <response>`                       |
| **Optional-feature**   | `Where`        | `Where <feature is included>, the <system> shall <response>`          |
| **Unwanted-behaviour** | `If … then`    | `If <trigger>, then the <system> shall <response>`                    |
| **Complex**            | `While`+`When` | `While <precondition>, when <trigger>, the <system> shall <response>` |

EARS rules fire **only on normative sentences** (§0). Non-EARS prose —
rationale, context, definitions, descriptive constraints — passes through
unflagged (the EARS notation is for normative behaviour; definitions and quality
attributes are deliberately not EARS-shaped).

| Code     | Slug                         | Sev  | Description                                                                                                                                                                | Cite                                       |
| -------- | ---------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| MSL-Q100 | `ears-no-pattern`            | info | Normative sentence matches none of the six EARS patterns.                                                                                                                  | EARS (Mavin 2009); GtWR R1; ISO 29148 §9.5 |
| MSL-Q101 | `ears-missing-actor`         | warn | EARS-shaped but no explicit `<system name>` actor precedes the modal ("the brake shall apply" — which subsystem?).                                                         | EARS; GtWR R2 / R3                         |
| MSL-Q102 | `ears-negative-response`     | info | Response clause is a bare negation (`shall not …`) — usually unverifiable; prefer a positive form (overlaps `incose-r16-not`, §2.7).                                       | EARS; GtWR R16                             |
| MSL-Q103 | `ears-stacked-preconditions` | warn | ≥3 stacked `While/When/If` preconditions in one sentence — split, or restructure as the canonical `While`-then-`When` Complex form.                                        | EARS (Complex); GtWR R11 / R28             |
| MSL-Q104 | `ears-malformed-attempt`     | info | Sentence opens with an EARS keyword (`When/While/Where/If`) but has no modal+response — a _malformed attempt_ at EARS (the interesting case; precision-limited by design). | EARS (Mavin 2009); GtWR R1                 |

- **Trigger (MSL-Q100):**
  `The system shall handle invalid readings
  appropriately.` (modal present, no
  EARS pattern → `info`; the `appropriately` also trips `incose-r7-vague-term`.)
- **Fix:**
  `If a sensor reading is invalid, then the brake controller
  shall ignore it and log $FaultCode_PressureOutOfRange.`
  (Unwanted-behaviour pattern, explicit actor.)
- **Honesty:** `MSL-Q100`/`MSL-Q104` are `info` on purpose — "no pattern
  detected" is reported, never "this is wrong". A descriptive Specification,
  constraint, or quality attribute that is _deliberately_ non-EARS is expected
  to carry this `info` and either be suppressed with a rationale (§4.2) or
  ignored (it does not affect exit code).

### 2.5 Group B — Modal-verb usage (`modal-*`)

RFC 2119 vocabulary: `shall/should/may/must` (+ negations), recognized via
`ModalMarker` (core-data-model §2.5.1). Profile-configurable per type.

| Code     | Slug                      | Sev  | Description                                                                                                                                                                   | Cite                                         |
| -------- | ------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| MSL-Q200 | `modal-multiple`          | warn | ≥2 normative modals in **one sentence** — a compound requirement (the companion guide's `compound-shall`). Modals inside quoted strings / Gherkin DocStrings are not counted. | GtWR R18 / R19; ISO 29148 §9.5 (C5 Singular) |
| MSL-Q201 | `modal-soft-in-normative` | info | `should`/`may` in a `Requirement`-rooted entry where the profile expects `shall` — a hedge, not an obligation.                                                                | RFC 2119                                     |
| MSL-Q202 | `modal-prohibited`        | warn | A modal tier disallowed by the active profile for this type (e.g. ISO 26262 forbids `should`/`may` in normative `Requirement`s). Profile-driven; inert with no profile.       | RFC 2119; profile-schema §4.3                |

- **Not minted here:** "uppercase modal" (= `MSL-M060`, a `fmt` concern),
  "requirement with no modal" (= `MSL-M061`). The `modal` group **cites** both
  (§2.2). `modal-missing` is intentionally _not_ a `Q` code — it is `MSL-M061`
  surfaced under the `modal` group label in `--format json` (§6) with
  `code: "MSL-M061"`, so there is exactly one stable code per concept.
- **Trigger (MSL-Q200):**
  `When the pedal is pressed, the system shall
  apply pressure and shall log the event.`
- **Fix:** two entries, one obligation each (GtWR R18; companion guide §5.1).

### 2.6 Group C — INCOSE GtWR rules (`incose-*`)

Rule numbers are the **canonical INCOSE GtWR v4** numbers
(INCOSE-TP-2010-006-04, June 2023), verified against the v4 summary sheet (Annex
C). The prompt's required minimum — R3, R4, R7, R8, R9, R10, R11, R18, R24, R26,
R27, R33 — is fully covered: R4 (Defined Terms) is the flagship `xref` rule
(§2.8); the rest are below, with closely-related v4 rules (R2, R16, R19) added
where they sharpen a diagnostic.

| Code     | Slug                                | Sev  | Description                                                                                                                                                                           | GtWR v4 cite                                      |
| -------- | ----------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| MSL-Q300 | `incose-r2-active-voice`            | warn | Passive construction hides the responsible entity ("pressure shall be applied" — by whom?). Slug-aliased as `struct-passive-voice` (§2.7).                                            | R2 Active Voice; ISO 29148 §9.5                   |
| MSL-Q301 | `incose-r3-subject-verb`            | info | Sentence subject/verb not appropriate to the entity (non-actor grammatical subject, or a verb the named actor cannot perform). Heuristic.                                             | R3 Appropriate Subject-Verb                       |
| MSL-Q302 | `incose-r7-vague-term`              | warn | A vague quantifier/adjective from the R7 lexicon (`some`, `several`, `a few`, `almost always`, `approximate`; `appropriate`, `adequate`, `sufficient`, `reasonable`, `efficient`, …). | R7 Vague Terms; ISO 29148 §9.5                    |
| MSL-Q303 | `incose-r8-escape-clause`           | warn | An escape clause from the R8 lexicon (`as appropriate`, `as required`, `where possible`, `if practicable`, `to the extent necessary`, …).                                             | R8 Escape Clauses                                 |
| MSL-Q304 | `incose-r9-open-ended`              | warn | An open-ended clause (`including but not limited to`, `etc.`, `and so on`).                                                                                                           | R9 Open-Ended Clauses                             |
| MSL-Q305 | `incose-r10-superfluous-infinitive` | info | Superfluous infinitive padding (`be able to`, `be capable of`, `be designed to`, `to enable`, `to allow`).                                                                            | R10 Superfluous Infinitives                       |
| MSL-Q306 | `incose-r11-separate-clauses`       | info | Multiple conditions/qualifications packed into one clause instead of a separate clause each (complements `ears-stacked-preconditions`).                                               | R11 Separate Clauses; cf. R28 Multiple Conditions |
| MSL-Q307 | `incose-r18-single-thought`         | warn | Sentence carries more than one thought — the singular rule (broader than `modal-multiple`).                                                                                           | R18 Single Thought Sentence; ISO 29148 §9.5 (C5)  |
| MSL-Q308 | `incose-r19-combinator`             | info | A combinator (`and`, `or`, `then`, `unless`, `but`, `however`, `whereas`, `meanwhile`, …) joining clauses that should be separate requirements.                                       | R19 Combinators                                   |
| MSL-Q309 | `incose-r24-pronouns`               | info | A personal/indefinite pronoun (`it`, `this`, `that`, `they`, `them`) with no clear antecedent.                                                                                        | R24 Pronouns                                      |
| MSL-Q310 | `incose-r26-absolute`               | info | An unachievable absolute (`100%`, `all`, `every`, `always`, `never`).                                                                                                                 | R26 Absolutes                                     |
| MSL-Q311 | `incose-r27-explicit-conditions`    | info | A condition's applicability left to context instead of stated explicitly (pairs with EARS pattern detection).                                                                         | R27 Explicit Conditions                           |
| MSL-Q312 | `incose-r33-range-of-values`        | info | A quantity stated without a range/tolerance (and units) against which it is verified.                                                                                                 | R33 Range of Values; cf. R6, R34                  |
| MSL-Q313 | `incose-r16-not`                    | info | Use of "not" producing a negative requirement; prefer a positive verifiable form (overlaps `ears-negative-response`, §2.4 — one code per occurrence, §2.7).                           | R16 Use of "Not"                                  |

#### 2.6.1 GtWR rules deliberately **not** lintable

| GtWR v4 rule(s)                                          | Concept                                          | Why not a structural rule                                                                                                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R31 (Solution Free)                                      | Implementation leakage                           | Distinguishing "incidental algorithm name" from "essential obligation" needs domain judgment — companion guide §5.5 hands this to peer/AI review and Vale. No MarkSpec heuristic ships (§7).          |
| R30 (Unique Expression)                                  | Each requirement stated once                     | Detecting duplicated intent across a set is cross-entry semantic dedup, not a per-sentence matcher. Weak heuristic only; deferred (§8 OQ).                                                            |
| R29 (Classification)                                     | Needs/requirements classified                    | A set-level organizational property, not a sentence property.                                                                                                                                         |
| R23 (Supporting Diagram/Model/ICD)                       | Refer complex behaviour to a model/ICD           | "Is this behaviour complex enough to need a model" is a judgment call.                                                                                                                                |
| R12/R13/R14 (Grammar/Spelling/Punct.), R39 (Style Guide) | Language correctness                             | Delegated to Vale + a spell-checker (companion guide §8 `--include-vale`); MarkSpec ships no native grammar/spell engine.                                                                             |
| R34 (Measurable Performance), C7 (Verifiable)            | Verifiability                                    | Verifiability is a judgment; only a weak proxy ("has an embedded `Feature` block or a measurable bound") is mechanizable, and that proxy is owned by the structural/trace passes, not prose analysis. |
| R41/R42 + C1–C15                                         | Set-level quality (completeness, consistency, …) | Properties of the requirement _set_, not an individual entry — outside a per-entry prose pass.                                                                                                        |

### 2.7 Group D — Structural quality (`struct-*`)

Entry-level shape signals. To keep "one stable code per occurrence", `struct-*`
reuses codes where the concept already has one rather than minting duplicates:

| Code       | Slug                           | Sev   | Description                                                                                                                                                                                                             | Cite                          |
| ---------- | ------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| MSL-Q400   | `struct-title-length`          | info  | Title outside the configured length band (default 3–120 chars) — too terse to mean anything, or a paragraph.                                                                                                            | GtWR R18; ISO 29148 (concise) |
| MSL-Q401   | `struct-body-length`           | info  | Normative body exceeds the configured word budget (default 80 words of normative prose) — likely compound or unfocused.                                                                                                 | GtWR R18                      |
| MSL-Q402   | `struct-multiple-shall`        | warn  | **Entry-level**: ≥2 normative modals across the whole body when no single sentence already triggered `modal-multiple` (MSL-Q200) — a compound _entry_. De-duped: never co-fires with `MSL-Q200` on the same modal pair. | GtWR R18 / R19                |
| (MSL-Q300) | `struct-passive-voice`         | warn  | **Alias** of `incose-r2-active-voice` (same code MSL-Q300). The prompt lists passive voice under both C and D; it is defined once (§2.6) and emitted once.                                                              | GtWR R2                       |
| (MSL-M051) | `struct-identifier-unresolved` | error | **Alias-cite** of core `MSL-M051` — `$Identifier` in in-scope prose does not resolve. Owned by the marker pass (§2.2); listed here only so the per-rule doc page (§6) can group it under `struct`. Not re-emitted.      | core §4.6; ADR-005 §Part 2    |

### 2.8 Group E — Cross-entry consistency (`xref-*`)

| Code     | Slug                        | Sev  | Description                                                                                                                                                                                                                                                     | Cite                                                                            |
| -------- | --------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| MSL-Q500 | `xref-glossary-undefined`   | warn | **Flagship.** A capitalized domain term in in-scope prose resolves to **no** glossary `Definition` (listing-directives §4), **no** in-entry `DefinitionList` term, and **no** `$Identifier` registry entry (core §2.5.2). "If you Capitalize It, it's defined." | GtWR R4 (Defined Terms) + R37 (Acronyms); ISO 29148 §9.5; listing-directives §4 |
| MSL-Q501 | `xref-prose-trace-mismatch` | info | The prose names an actor/domain that contradicts the entry's `Allocated-to:`/`Derived-from:` target (e.g. body says "the HMI domain" but `Allocated-to:` is a Chassis component). Heuristic; target _existence/type_ is `MSL-R080`/`R083`, not this.            | GtWR R3 (weak); core §4.8 (cite, not duplicate)                                 |
| MSL-Q502 | `xref-term-inconsistent`    | info | The same concept referred to by inconsistent surface forms across entries (`brake controller` / `BrakeController` / `BrkCtrl`). Cluster heuristic; profile lexicon can pin the canonical form.                                                                  | GtWR R36 (Consistent Terms) + R38 (Abbreviations); ISO 29148 §9.5               |

**The flagship rule, honestly.** `xref-glossary-undefined` is the single
highest-value rule in this catalog (prompt §Context: "that one rule will do more
for requirement quality than half the GtWR catalog"), maps to **GtWR v4 R4
(Defined Terms)** and **R37 (Acronyms)**, and is a **heuristic**:

- It fires on a token that is `PascalCase` or a Capitalized multi-word domain
  phrase, is **not** sentence-initial, is **not** a `$Identifier` (those are
  owned by `MSL-M050/M051`), is **not** an RFC 2119 / EARS keyword, and is
  **not** in the capitalized-word allowlist lexicon (§4.1).
- It resolves against, in order: in-entry `DefinitionList` terms → glossary
  `Definition` slugs (listing-directives §4.2 R4-c slug derivation) →
  `$Identifier` registry → profile-declared `Aliases` (listing-directives §4.3
  R4-g). First hit wins; no hit → diagnostic.
- It defaults to `warning`, not `error`, and ships with a non-empty allowlist
  (common English capitalized words, project nouns) so the false-positive rate
  is bounded. The precision/recall trade and the default-severity question are
  §8 open question 5.
- It depends on glossary/`$Identifier` resolution, which is
  deferred-by-dependency on `main` (§2.2 dependency note). The Stage-2 subset
  (glossary-only resolver, no code-symbol/RIDL) is §8 open question 4.

### 2.9 Suppression hygiene (`disable-*`)

These police the escape hatch itself (§4.2).

| Code     | Slug                        | Sev   | Description                                                                                                                           |
| -------- | --------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| MSL-Q900 | `disable-without-rationale` | error | `Markspec-disable:` present on an entry with no `Rationale:` attribute (§4.2 mandate).                                                |
| MSL-Q901 | `disable-unknown-rule`      | warn  | `Markspec-disable:` names a slug/code that is not a known prose-analysis rule.                                                        |
| MSL-Q902 | `disable-unused`            | info  | A suppression that matched no diagnostic this run — a stale escape hatch to remove (companion guide §8 "don't spray escape hatches"). |

---

## 3. Priority scoring (informational only)

### 3.1 The score

Per in-scope entry, `score = Σ (weight(rule) × occurrences(rule))` over
triggered prose-analysis rules. Rolled up per file/project as **count of entries
by score band** plus the mean — never a single project number that becomes the
target.

### 3.2 Default weight table

Weights are an ordinal triage signal, not a unit. Defaults (a profile overrides
via `prose.weights`, §4.1):

| Default severity | Example rules                                                                                                                                         | Default weight           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `warn`           | `modal-multiple`, `incose-r2-active-voice`, `incose-r7-vague-term`, `incose-r8-escape-clause`, `xref-glossary-undefined`, `incose-r18-single-thought` | 3                        |
| `info` (clarity) | `ears-no-pattern`, `incose-r24-pronouns`, `incose-r10-superfluous-infinitive`, `incose-r16-not`                                                       | 1                        |
| `info` (style)   | `struct-title-length`, `struct-body-length`, `disable-unused`                                                                                         | 0 (reported, unweighted) |

A `0`-weight rule still reports; it just does not move the score — so style nits
do not inflate the triage signal.

### 3.3 Never a gate by default — options analysis

| Alternative                                                        | Rejected / chosen because                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ship a default score threshold (gate)                              | **Rejected.** Any visible threshold becomes the target the moment it ships (Goodhart; the code-coverage-% lesson, prompt §Context). It would be cargo-culted as "the MarkSpec standard" and teams would optimize the score, not the requirements.                                                                   |
| No score at all                                                    | **Rejected.** A weighted roll-up is genuinely useful for triage and trend if it never gates — discarding it loses real signal.                                                                                                                                                                                      |
| **Informational by default; profile may opt into a gate (chosen)** | The score is computed, reported (§6), and **never affects the exit code** unless a profile _explicitly_ declares `prose.score.threshold` (§4.1). Even then it is the profile's owned compliance choice — mechanically just a profile-promoted rule, exactly the §4.10 promotion model. Core ships **no** threshold. |

**Anti-pattern, stated in the spec and surfaced in output (§6):** _optimize the
requirements, not the score._ The score is a smoke detector, not a KPI. Tooling
output that shows the score also shows this sentence.

### 3.4 Severity ↔ score independence

Severity drives the **exit code** (core-data-model §4.10: `error`→fail,
`warning`→`--strict`, `info`→none). The score drives **triage attention**. They
are independent axes: a high-weight rule may default to `info` severity (it
costs score, never breaks CI) — this is the mechanism by which scoring stays
informational while still ranking entries.

---

## 4. Configuration

Three layers, strictly monotone in restrictiveness — none may **demote** a
core-defined `error` or a profile-promoted `error` (core-data-model §4.10;
profile-schema §5.1 "child may tighten; child may not relax").

### 4.1 Profile-level (authoritative)

A profile configures prose analysis through its content subtree (profile-schema
§2.1, merged per §5.1). It is the **only** layer a compliance profile needs.

```yaml
# in a profile's markspec.yaml content subtree
prose:
  scope:
    types: [Requirement, hazard] # §1.1 default on-set
    blocks: [Paragraph] # §1.2; add List/Note/DefinitionList to opt in
  groups:
    ears: { enabled: true }
    modal: { enabled: true }
    incose: { enabled: true }
    struct: { enabled: true }
    xref: { enabled: true }
  severities: # promote only (§4.10 / §5.1) — relax = PROFILE-MERGE-010
    ears-no-pattern: warning
    xref-glossary-undefined: error
  lexicons: # list-additive across tiers (§5.1)
    vague-terms: [snappy, blazing-fast] # extends the canonical R7 list
    escape-clauses: [best-effort] # extends the canonical R8 list
    capitalized-allow: [ASIL, ECU, CAN]
  weights:
    xref-glossary-undefined: 5
  score:
    threshold: null # null = informational (default). A number opts into a gate.
```

Merge semantics are profile-schema §5.1 **unchanged**: `groups`, `lexicons` are
list-additive (union across tiers); `severities`, `score.threshold`, `scope.*`
are constraint fields (child may tighten — promote severity, narrow scope, lower
a threshold — never relax). A relaxation is `PROFILE-MERGE-010` at profile load
(profile-schema §4.3, §5.1). This reuses the existing profile validation surface
(profile-schema §4.3 "Promotion of any core warning/info to error") — no new
profile-manifest top-level key beyond the `prose:` content block.

### 4.2 Entry-level escape — the `Markspec-disable:` trailer

A waiver lives **in the entry's trailers** as a declared, auditable fact:

```markdown
- [CREQ_BRK_0109] Combined emergency response

  When $BrakePedalPressed becomes high, the brake controller shall apply
  pressure and release the parking brake.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
      Markspec-disable: modal-multiple
      Rationale: The two actions are one indivisible atomic response;
        splitting them would misrepresent the safety case.
```

- `Markspec-disable:` — repeatable `id-list` (core §1.8), TitleCase- Hyphenated
  key (core §2.3.1); values are rule **slugs** or `MSL-Q###` codes. Scope = the
  entry it sits in.
- `Rationale:` — **required** when `Markspec-disable:` is present (`text` value
  type). Absent → `MSL-Q900` (error). This makes every suppression a documented
  decision the audit trail and `markspec compile`/`report` surface — superior to
  a comment for a compliance baseline.
- A suppression that names an unknown rule → `MSL-Q901`; one that matched
  nothing this run → `MSL-Q902`.

**Reconciliation with the companion guide's comment form.** The companion guide
(and ADR-012 §Context's `<!-- markspec:disable MSL-R011 -->` example) shows an
HTML-comment suppression (`<!-- markspec-disable[-next-line]: rule -->`, region
form). That form is the existing mechanism for **non-entry prose** (free
Markdown, glossary definitions — which have no trailers, listing-directives
§4.3) and remains valid there; it does **not** carry the `Rationale:`
requirement because non-entry prose has no trailer to put it in. For
**entries**, the trailer attribute is canonical. Precedence when both are
present on one entry: entry trailer > region comment > line comment.

**Options analysis — escape-hatch form.**

| Alternative                                                                     | Rejected / chosen because                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTML-comment only (companion guide)                                             | **Rejected for entries.** Not auditable, easy to scatter, invisible to `compile`/`report`, and cannot mechanically require a rationale.                                                          |
| Trailer attribute only                                                          | **Rejected.** Non-entry prose (glossary, free Markdown) has no trailers block — it still needs the comment form.                                                                                 |
| **Trailer for entries + comment for non-entry prose, with precedence (chosen)** | Each surface uses the suppression mechanism it can carry; entries get the auditable, rationale-bearing form. Unifying the two syntaxes is §8 open question 2 (needs an ADR — ADR-012 territory). |

### 4.3 Project-level — `.markspec/lint.yaml`

For greenfield projects with **no profile**, a `.markspec/lint.yaml` (discovered
beside `.markspec.yaml`, profile-schema §2.2) carries the same `prose:` block as
§4.1.

- It is **strictly weaker than a profile**: it may enable/disable groups, add
  lexicon entries, set weights, and set a _local_ `score.threshold`, but it
  **cannot demote** a core-defined `error` or a profile-promoted `error`
  (core-data-model §4.10). Attempting to is ignored with an `MSL-A020`-class
  config warning (a profile is the stronger compliance authority).
- When **both** a profile and `.markspec/lint.yaml` exist, the profile wins
  every conflict; `.markspec/lint.yaml` only fills gaps the profile left unset.
  (Rationale: a project file must not silently weaken a compliance profile.)

**Options analysis — project config location.**

| Alternative                                  | Rejected / chosen because                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A `lint:` block inside `project.yaml`        | **Rejected.** Conflates project metadata with lint policy; `project.yaml` is config (core), not a profile-equivalent surface.                                            |
| **Dedicated `.markspec/lint.yaml` (chosen)** | Mirrors the `.markspec.yaml` profile-activation precedent (profile-schema §2.2) and the companion guide's `.vale.ini` analogue — one obvious place, separable lifecycle. |

---

## 5. Implementation approach

This section constrains the Stage-2 build prompt; it is **not** implementation.

### 5.1 Rule-based, deterministic — options analysis (ML vs rule-based)

| Alternative                                                  | Rejected / chosen because                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ML / LLM classifier on the hot path                          | **Rejected.** Nondeterministic (breaks the determinism ethos of core-data-model §5.3 and the e2e snapshot model — markspec-e2e-test-strategy); opaque (a diagnostic that cannot cite a rule is not actionable); blows the <5 ms budget; unusable in air-gapped safety contexts. |
| Hybrid (rules + optional out-of-band LLM reviewer)           | The LLM half is **deferred to a future epic** (§7) and kept loosely coupled exactly like Vale (companion guide §5.5, §8). The hot path stays rule-based.                                                                                                                        |
| **Rule-based: tree-sitter segmentation + matchers (chosen)** | Deterministic, citable, fast, offline. Same input → byte-identical diagnostics & score (required for CI/snapshot stability — AGENTS.md test conventions; markspec-e2e-test-strategy).                                                                                           |

### 5.2 Pipeline placement

- Runs in the **`lint` pass only**, after parse (core-data-model §2) and type
  resolution (§1.3.1), over in-scope entries (§1.1). It is **off the `fmt` path
  entirely** (AGENTS.md formatters/linters split; core-data-model §3).
- Inputs are the **existing AST**: `ModalMarker`, `EntityRef` (core-data-model
  §2.5), body-block types (§2.4), resolved `Type:`. Sentence segmentation uses
  the tree-sitter Markdown grammar already in the stack (00-context-overview
  "tree-sitter for local fact extraction"). No new parser.
- `$Identifier` / glossary resolution is **consumed, not re-implemented**
  (§2.2): it reuses the marker pass's resolver (`MSL-M050/M051`, core-data-model
  §2.5.2). Where that resolver is deferred-by-dependency on `main` (ADR-012 §6),
  the dependent `xref` rules are gated with it (§5.4).

### 5.3 No prose auto-fix — options analysis

| Alternative                                 | Rejected / chosen because                                                                                                                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto-fix prose (rewrite sentences)          | **Rejected.** Where a fix is safe, the author should have written it right; where it is unsafe, the rewrites are infinite. Prose auto-fix is a tarpit (prompt §Context).                                                |
| Trivial whitespace auto-fix only            | **Rejected here.** Whitespace canonicalization is already `fmt`'s job (core-data-model §3); duplicating a fixer in `lint` violates the formatters/linters split.                                                        |
| **Report only; zero code actions (chosen)** | Prose analysis emits **no** LSP code actions (unlike the structural quick-fixes in lsp/code_actions.ts). Lint reports; the author fixes. The only mechanical change to modal _case_ is `MSL-M060`/`fmt`, not this pass. |

### 5.4 Performance budget

- **< 5 ms per entry** on the lint hot path (prompt §5).
- Achieved by: a single AST walk per entry (no re-parse); lexicons as hash-set
  lookups; matchers as precompiled regex/automata built once per process; the
  glossary/`$Identifier` index built **once per run**, not per entry; **no I/O
  on the hot path**.
- Deterministic and order-stable so the e2e snapshot suite
  (markspec-e2e-test-strategy; AGENTS.md `assertSnapshot`) is stable; the
  prose-analysis e2e corpus is a **Stage-2** addition to the Ring model
  (markspec-e2e-test-strategy §rings — cross-referenced, not redefined here).
- Rules with an unmet dependency (glossary/`$Identifier` resolver not landed —
  §2.2) **degrade to silent**, never to a false positive: a rule that cannot
  resolve does not guess.

---

## 6. Output format

### 6.1 LSP

- Each diagnostic maps through the existing core→LSP bridge
  (lsp/diagnostics.ts): `source: "markspec"`, `code: "MSL-Q###"`,
  1-based→0-based range at the offending **sentence** span (not the whole
  entry).
- Adds `codeDescription.href` → the per-rule doc page (§6.3), keyed by slug. The
  current `LspDiagnostic` interface in lsp/diagnostics.ts has no
  `codeDescription`/`data` field; this spec records that the bridge needs that
  additive extension (no behavior change to existing codes) — the Stage-2 build
  prompt owns it.
- Severity via the existing `toLspSeverity` map (`error`/`warning`/`info` →
  1/2/3, lsp/diagnostics.ts).
- No code actions (§5.3).

### 6.2 CLI

- Text (companion guide §8 format, clig.dev — diagnostics to stderr):

  ```text
  docs/requirements/braking/software-requirements.md:42:18 warning
    ears-missing-actor [MSL-Q101]: no explicit system actor before the modal
    When the pedal is pressed, the brake shall apply.
  ```

- `--format json` (data to stdout — mirrors `markspec validate --format
  json`,
  main.ts): an array of
  `{ code, slug, group, severity, message, range, scoreContribution }`, plus a
  trailing per-entry/per-project `score` object with `contributions[]` and the
  literal anti-pattern line from §3.3.
- Exit code: core-data-model §4.10 + clig.dev — `0` clean, `1` any `error`, `2`
  warnings-only under `--strict`. Prose analysis can only reach `1` when a
  profile **promoted** a rule to `error` or set `prose.score.threshold` (§3.3,
  §4.1). Core defaults never fail CI.
- `markspec lint --include-vale` is recognized as a **loosely coupled,
  optional** integration (companion guide §8): if Vale is on PATH its
  diagnostics merge into the reporter; absent, the flag is a discoverable no-op.
  MarkSpec does not bundle, configure, or depend on Vale. The Vale merge
  mechanics are §8 open question 7.

### 6.3 Per-rule documentation page template

Published in the Stage-2 user guide (markspec-user-docs.md §1 lists
"prose-quality lint docs" as Stage-2; the narrative companion guide is the
teaching surface, this page is the reference). One page per rule, slug as the
URL stem so `codeDescription.href` is stable:

```text
# <slug>  ·  <MSL-Q###>

Group:    <ears|modal|incose|struct|xref>
Severity: <core default>  (profiles may promote)
Source:   <EARS (Mavin 2009) | GtWR v4 R## | RFC 2119/8174 | ISO 29148 §9.5>

## What it flags
<one paragraph>

## Why it matters
<one paragraph — the requirement-quality rationale>

## Trigger
<minimal failing example>

## Fix
<the corrected example>

## Configuration
<profile keys; default severity/weight; lexicons consulted>

## Related
<sibling rules; the core MSL-M/R code it cites if any>
```

---

## 7. Out of scope

- **LLM/AI-based critique** — semantic review (implementation leakage beyond
  none, contradiction detection, abstraction-level judgment, verifiability
  judgment). A future epic, loosely coupled like Vale (companion guide §5.5,
  §8).
- **Auto-fix** — none (§5.3). Lint reports; the author fixes. Modal-case
  normalization stays `fmt`'s (`MSL-M060`).
- **Non-English prose** — EARS keywords, RFC 2119 vocabulary, and the default
  lexicons are English. Internationalization is a future epic.
- **Implementation-leakage as a structural lint** (GtWR v4 R31) — explicitly
  delegated to Vale/AI review (companion guide §5.5); no MarkSpec heuristic
  ships.
- **Gherkin / `Feature`-block analysis** — the embedded Gherkin scenario
  (Cucumber Gherkin Reference; companion guide §7) has its own analyzer concern;
  prose analysis treats `Feature` blocks as verbatim (§1.2; core-data-model
  §2.5).
- **Native grammar / spelling / style** (GtWR v4 R12–R14, R39) — delegated to
  Vale + a spell-checker via `--include-vale`; MarkSpec ships no native engine.
- **Authoring the Vale rule pack**, rendering/metrics dashboards, the
  suppression-syntax-unification ADR (§8 OQ2), and the ADR-012 catalogue
  migration mechanics (ADR-012 §Out of scope).
- **The structural lint contract** — `MSL-P/I/T/A/B/M/C/R/F` (core-data-model
  §4) is authoritative and untouched; this spec adds the `MSL-Q` category beside
  it.

---

## 8. Open questions

Capped at seven (cross-cutting constraint).

1. **`MSL-Q` ratification & ordinal block.** This spec fixes the
   `MSL-Q1xx/2xx/.../9xx` ordinals as the build target (nextgen/README §Spec
   authority). Who folds the `Q` letter into the ADR-012-tracked nextgen
   catalogue and reserves the ordinal block — this spec, ADR-012's future
   migration ADR, or a dedicated prose-analysis ADR?

2. **Suppression-syntax unification.** §4.2 keeps two forms (entry trailer
   `Markspec-disable:` + non-entry HTML comment) with a precedence rule. ADR-012
   §Context shows `<!-- markspec:disable MSL-R011 -->`. Should a single
   canonical suppression syntax span all passes (an ADR), or is the
   trailer-for-entries / comment-for-prose split permanent?

3. **Companion-guide reconciliation (numbering _and_ case).** The companion
   guide (a) uses GtWR rule numbers **non-conformant with v4** (it cites R3 for
   passive voice [v4 R2], R23 for vague terms [v4 R7], R37 for verifiable [v4
   R37 is Acronyms], R10 for singular [v4 R18], etc. — Annex C) and (b)
   recommends **uppercase** `SHALL` (RFC 8174) against core-data-model §3.4.1 /
   `MSL-M060`'s **lowercase** canonical. Both must be corrected in the Stage-2
   user-docs. Does the `modal` group additionally need a profile "case policy =
   upper|lower|either" that interacts with `fmt`?

4. **xref dependency gating.** `xref-glossary-undefined` and the
   `$Identifier`-consuming rules depend on the marker-pass resolver, which is
   **deferred-by-dependency** on `main` (core-data-model §4.6; ADR-012 §6). Do
   these ship gated behind that resolver, or with a **glossary-only subset
   resolver** (no code-symbol/RIDL) as a Stage-2 partial?

5. **Flagship precision / default severity.** Is `xref-glossary-undefined`
   `warning` or `info` by core default, and does core ship a curated
   capitalized-word allowlist lexicon, or is the allowlist profile-only (risking
   a high false-positive rate for profile-less projects)?

6. **Score roll-up semantics.** Is the project roll-up a mean, a count-by-band,
   or both — and is any non-gating _trend_ (e.g. a CI PR comment) surfaced at
   all, given that even a visible trend can become a de-facto target (§3.3)?

7. **Vale merge boundary.** Is merging Vale diagnostics into the MarkSpec
   reporter under `--include-vale` (companion guide §8) in scope for the Stage-2
   prose-analysis build, or a separate integration epic with its own spec?

---

## Annex A — Cross-reference summary

| Section here                | Source (authoritative)                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| §0 Terminology              | core-data-model §0; markspec-user-docs §1                                                            |
| §1.1 Scope (types)          | core-data-model §1.3 / §1.3.1; ADR-003 §Part 1; ADR-005 §Context                                     |
| §1.2 Scope (blocks)         | core-data-model §2.4 / §2.5; ADR-005 §Part 1 / §Part 2; Gherkin (Cucumber reference)                 |
| §2.1 Code scheme            | core-data-model §4; ADR-012 (§Decision, §6); nextgen/README §Spec authority                          |
| §2.2 Deferred-to codes      | core-data-model §4.6 / §4.8; ADR-012 §6                                                              |
| §2.4 EARS rules             | EARS (Mavin et al., 2009, <https://alistairmavin.com/ears/>); GtWR v4 R1; ISO 29148 §9.5             |
| §2.5 Modal rules            | RFC 2119 / RFC 8174; core-data-model §2.5.1 / §4.6; profile-schema §4.3; GtWR v4 R18 / R19           |
| §2.6 INCOSE rules           | INCOSE GtWR v4 (R2/R3/R7/R8/R9/R10/R11/R16/R18/R19/R24/R26/R27/R33); ISO 29148 §9.5                  |
| §2.7 Structural rules       | core-data-model §4.6 (cited); GtWR v4 R2 / R18 / R19                                                 |
| §2.8 Cross-entry / flagship | listing-directives §4.2 / §4.3; core-data-model §2.5.2; GtWR v4 R4 / R36 / R37 / R38; ISO 29148 §9.5 |
| §3 Scoring                  | core-data-model §4.10 (severity model); prompt §Context (Goodhart)                                   |
| §4.1 Profile config         | profile-schema §2.1 / §4.3 / §5.1; core-data-model §4.10                                             |
| §4.2 Entry escape           | core-data-model §1.8 / §2.3.1; ADR-012 §Context; companion guide §8                                  |
| §4.3 Project config         | profile-schema §2.2; core-data-model §4.10                                                           |
| §5 Implementation approach  | core-data-model §2 / §3 / §5.3; AGENTS.md (formatters/linters); markspec-e2e-test-strategy           |
| §6 Output                   | lsp/diagnostics.ts; main.ts (`validate --format json`); clig.dev; markspec-user-docs §1 / §2         |

## Annex B — `MSL-Q` catalog index

| Code     | Slug                                | Group  | Sev (core) | GtWR v4 / cites                    |
| -------- | ----------------------------------- | ------ | ---------- | ---------------------------------- |
| MSL-Q100 | `ears-no-pattern`                   | ears   | info       | EARS; R1                           |
| MSL-Q101 | `ears-missing-actor`                | ears   | warn       | EARS; R2 / R3                      |
| MSL-Q102 | `ears-negative-response`            | ears   | info       | EARS; R16 (rel. MSL-Q313)          |
| MSL-Q103 | `ears-stacked-preconditions`        | ears   | warn       | EARS; R11 / R28                    |
| MSL-Q104 | `ears-malformed-attempt`            | ears   | info       | EARS; R1                           |
| MSL-Q200 | `modal-multiple`                    | modal  | warn       | R18 / R19                          |
| MSL-Q201 | `modal-soft-in-normative`           | modal  | info       | RFC 2119                           |
| MSL-Q202 | `modal-prohibited`                  | modal  | warn       | RFC 2119; profile-schema §4.3      |
| —        | `modal-missing` (label only)        | modal  | (info)     | **MSL-M061** (core)                |
| —        | `modal-uppercase` (label only)      | modal  | (warn)     | **MSL-M060** (core, `fmt`)         |
| MSL-Q300 | `incose-r2-active-voice`            | incose | warn       | R2; aliased `struct-passive-voice` |
| MSL-Q301 | `incose-r3-subject-verb`            | incose | info       | R3                                 |
| MSL-Q302 | `incose-r7-vague-term`              | incose | warn       | R7                                 |
| MSL-Q303 | `incose-r8-escape-clause`           | incose | warn       | R8                                 |
| MSL-Q304 | `incose-r9-open-ended`              | incose | warn       | R9                                 |
| MSL-Q305 | `incose-r10-superfluous-infinitive` | incose | info       | R10                                |
| MSL-Q306 | `incose-r11-separate-clauses`       | incose | info       | R11; cf. R28                       |
| MSL-Q307 | `incose-r18-single-thought`         | incose | warn       | R18; rel. MSL-Q200/Q402            |
| MSL-Q308 | `incose-r19-combinator`             | incose | info       | R19; rel. MSL-Q307                 |
| MSL-Q309 | `incose-r24-pronouns`               | incose | info       | R24                                |
| MSL-Q310 | `incose-r26-absolute`               | incose | info       | R26                                |
| MSL-Q311 | `incose-r27-explicit-conditions`    | incose | info       | R27                                |
| MSL-Q312 | `incose-r33-range-of-values`        | incose | info       | R33; cf. R6 / R34                  |
| MSL-Q313 | `incose-r16-not`                    | incose | info       | R16; rel. MSL-Q102                 |
| MSL-Q400 | `struct-title-length`               | struct | info       | R18                                |
| MSL-Q401 | `struct-body-length`                | struct | info       | R18                                |
| MSL-Q402 | `struct-multiple-shall`             | struct | warn       | R18 / R19; de-dup vs MSL-Q200      |
| —        | `struct-passive-voice`              | struct | (warn)     | **MSL-Q300** (alias, R2)           |
| —        | `struct-identifier-unresolved`      | struct | (error)    | **MSL-M051** (core)                |
| MSL-Q500 | `xref-glossary-undefined`           | xref   | warn       | R4 / R37; listing-directives §4    |
| MSL-Q501 | `xref-prose-trace-mismatch`         | xref   | info       | R3 (weak); cites MSL-R080/R083     |
| MSL-Q502 | `xref-term-inconsistent`            | xref   | info       | R36 / R38                          |
| MSL-Q900 | `disable-without-rationale`         | —      | error      | —                                  |
| MSL-Q901 | `disable-unknown-rule`              | —      | warn       | —                                  |
| MSL-Q902 | `disable-unused`                    | —      | info       | —                                  |

## Annex C — Source-citation convention & companion-guide reconciliation

**Canonical sources (verified, authoritative for this spec):**

- **INCOSE Guide to Writing Requirements (GtWR)** — INCOSE-TP-2010-006-04,
  June 2023. The **v4** rule set is R1–R42 and the characteristics are C1–C15.
  Rule numbers in §2, Annex A, and Annex B are the v4 canonical numbers,
  cross-checked against the v4 summary sheet
  (Rules-for-Need-and-Requirement-Statements page; the Rules-to-Characteristics
  matrix). Key anchors used here: R2 Active Voice, R3 Appropriate Subject-Verb,
  R4 Defined Terms, R7 Vague Terms, R8 Escape Clauses, R9 Open-Ended Clauses,
  R10 Superfluous Infinitives, R11 Separate Clauses, R16 Use of "Not", R18
  Single Thought Sentence, R19 Combinators, R24 Pronouns, R26 Absolutes, R27
  Explicit Conditions, R28 Multiple Conditions, R31 Solution Free, R33 Range of
  Values, R36 Consistent Terms and Units, R37 Acronyms, R38 Abbreviations.
- **EARS** — Mavin, Wilkinson, Harwood, Novak, "Easy Approach to Requirements
  Syntax (EARS)", Rolls-Royce plc, published 2009; canonical reference
  <https://alistairmavin.com/ears/>. Canonical pattern names: Ubiquitous,
  State-driven, Event-driven, Optional-feature, Unwanted-behaviour, Complex.
  Generic structure
  `While <precondition>, when <trigger>, the <system> shall <response>` (clauses
  in that fixed order).
- **RFC 2119 / RFC 8174** — modal vocabulary and the uppercase-only
  special-meaning rule.
- **ISO/IEC/IEEE 29148:2018 §9.5** — characteristics of individual requirements
  (singular, unambiguous, verifiable, consistent).
- **Gherkin** — Cucumber Gherkin Reference
  (<https://cucumber.io/docs/gherkin/reference>). Cited only at the
  `Feature`-block boundary (§1.2, §7); Gherkin/GWT analysis itself is out of
  scope. Canonical keyword note: `Scenario` = `Example`, `Scenario Outline` =
  `Scenario Template`, `Scenarios` = `Examples`.

**Companion-guide reconciliation (required Stage-2 user-docs work).** The
narrative companion guide (`requirements-writing-guide.md`) cites GtWR rule
numbers that are **inconsistent with v4** — e.g. it uses R3 for passive voice
(v4 R2), R4 for unambiguous identifiers (v4 R4 is Defined Terms;
pronoun-ambiguity is v4 R24), R23 for vague terms (v4 R7), R10 for singular (v4
R18), R26 for negative (v4 R16; v4 R26 is Absolutes), R30 for solution-free (v4
R31), R37 for verifiable (v4 R37 is Acronyms). It also recommends uppercase
`SHALL`, contradicting core-data-model §3.4.1. This spec uses the **v4 canonical
numbers and lowercase canonical modal**; the companion guide MUST be corrected
when it is authored as a Stage-2 user-docs deliverable (markspec-user-docs.md §1
/ §2). Tracked as §8 open question 3.
