# Prose analysis

MarkSpec performs quality analysis on the body prose of authored entries — the
paragraphs and list items that describe _what_ a requirement means, not just its
identity. Prose analysis runs as a separate `markspec lint` pass after parsing
and validation; it does not block `markspec validate`.

## Scope

Only **authored** entries of **Specification-family** types are analysed. The
scope predicate is:

```text
shape = Authored  AND  core type ∈ { Requirement, Test, Contract, Record, Risk }
                        or a profile subtype of any of the above
```

Reference-shape entries are excluded — they point to external documents whose
prose MarkSpec does not own. Core types outside the Specification family (e.g.
`SoftwareComponent`, `Definition`, `Annotation`) are also excluded; structural
descriptions and glossary entries follow different writing conventions.

Suppression-hygiene rules (`MSL-Q9xx`) run on **all** authored entries
regardless of type.

## All active rules

The Stage-2 prose-analysis build (ADR-021) ships the rules below. Severity and
score contribution drive the project-level roll-up surfaced by
`markspec lint --format json` (band counts + mean; no trend artifact in core, by
design — see
[ADR-021](../../architecture/adr-021-prose-analysis-flagship-build.md)).

| Code     | Slug                              | Surface             | Severity | Score |
| -------- | --------------------------------- | ------------------- | -------- | ----- |
| MSL-Q100 | ears-no-pattern                   | EARS                | info     | 1     |
| MSL-Q101 | ears-missing-actor                | EARS                | warning  | 3     |
| MSL-Q102 | ears-negative-response            | EARS                | info     | 1     |
| MSL-Q103 | ears-stacked-preconditions        | EARS                | warning  | 3     |
| MSL-Q104 | ears-malformed-attempt            | EARS                | info     | 1     |
| MSL-Q200 | modal-multiple                    | Modal sentence      | warning  | 3     |
| MSL-Q201 | modal-soft-in-normative           | Modal sentence      | info     | 1     |
| MSL-Q300 | incose-r2-active-voice            | Passive voice       | warning  | 3     |
| MSL-Q301 | incose-r3-subject-verb            | Passive voice       | info     | 1     |
| MSL-Q302 | incose-r7-vague-term              | INCOSE lexicon      | warning  | 3     |
| MSL-Q303 | incose-r8-escape-clause           | INCOSE lexicon      | warning  | 3     |
| MSL-Q304 | incose-r9-open-ended              | INCOSE lexicon      | info     | 1     |
| MSL-Q305 | incose-r10-superfluous-infinitive | INCOSE lexicon      | info     | 1     |
| MSL-Q310 | incose-r26-absolute               | INCOSE lexicon      | info     | 1     |
| MSL-Q313 | incose-r16-not                    | INCOSE lexicon      | info     | 1     |
| MSL-Q400 | struct-title-length               | Structural          | info     | 1     |
| MSL-Q401 | struct-body-length                | Structural          | info     | 1     |
| MSL-Q500 | xref-glossary-undefined           | Flagship cross-ref  | warning  | 3     |
| MSL-Q900 | disable-without-rationale         | Suppression hygiene | warning  | —     |
| MSL-Q901 | disable-unknown-rule              | Suppression hygiene | warning  | —     |
| MSL-Q902 | disable-unused                    | Suppression hygiene | info     | —     |

The flagship rule **MSL-Q500 `xref-glossary-undefined`** flags capitalized
proper-noun usage in normative prose that has no corresponding `Definition`
entry in the glossary. It ships with a glossary-only subset resolver
(`$Identifier` / RIDL rules degrade-to-silent until ADR-016 marker pass lands).
The default severity is `warning`, and core ships an English-baseline allowlist
of universally-true capitalized words (calendar / geography / languages) at
`packages/markspec/core/lexicons/capitalized-allow.txt` — list-additive across
profile tiers, capped, and explicitly excludes domain vocabulary and
standards-body acronyms.

## Modal keyword analysis

Modal keywords signal the obligation level of a requirement. MarkSpec enforces
the RFC 2119 / EARS convention that modals appear in **lowercase**:

| Keyword      | Obligation                                     |
| ------------ | ---------------------------------------------- |
| `shall`      | Mandatory                                      |
| `shall not`  | Prohibited                                     |
| `should`     | Recommended                                    |
| `should not` | Not recommended                                |
| `may`        | Optional                                       |
| `must`       | External constraint (use `shall` for internal) |
| `must not`   | Prohibited (external constraint)               |

**MSL-M060 — modal-keyword-uppercase** (warning)

Fires when any of the above keywords appears in uppercase (`SHALL`, `MUST`, …)
inside body prose. The formatter (`markspec format`) rewrites uppercase modals
to lowercase automatically, so this diagnostic appears only on files that have
not been formatted.

```text
warning[MSL-M060]: requirements.md:12 modal keyword 'SHALL' in body prose is
uppercase (spec §3.4.1 canonical form is lowercase; 'markspec format' will
rewrite it)
```

Verbatim blocks (fenced code, math, feature snippets) are excluded — modal
keywords inside code examples are not checked.

**MSL-M061 — missing-modal-keyword** (info)

Fires on `Requirement` entries (and profile subtypes) whose body contains no
modal keyword at all. This is a style hint: a requirement without an obligation
word is often a description masquerading as a requirement.

```text
info[MSL-M061]: requirements.md:7 Requirement entry contains no modal keyword
(shall / should / may / must) — consider declaring one to make the obligation
explicit
```

## EARS pattern recognition

EARS (Easy Approach to Requirements Syntax) defines five body forms for
requirement entries. MarkSpec recognises the leading keyword of each form and
uses it internally for normalization — capitalisation is preserved at sentence
start and lowercased mid-sentence.

| Form         | Leading keyword | Template                                |
| ------------ | --------------- | --------------------------------------- |
| Ubiquitous   | _(none)_        | _The system_ `shall` _…_                |
| State-driven | `While`         | `While` _state,_ _system_ `shall` _…_   |
| Event-driven | `When`          | `When` _event,_ _system_ `shall` _…_    |
| Unwanted     | `If`            | `If` _condition,_ _system_ `shall` _…_  |
| Optional     | `Where`         | `Where` _feature,_ _system_ `shall` _…_ |

The EARS form is currently used for normalization only; no lint rule fires on an
EARS keyword choice. Future rule group `ears` is reserved for form-specific
checks (e.g. ensuring state-driven requirements name a concrete state).

## GWT pattern

GWT (Given / When / Then) is the standard body form for `Test` entries. MarkSpec
accepts GWT prose without enforcing structural rules in the current phase; the
three clauses are plain prose paragraphs.

Recommended form:

```markdown
- [SWT_BRK_0030] Debounce rejects short pulses

  Given the debounce threshold is 10 ms, When a pulse of 5 ms arrives, Then the
  output shall remain unchanged.

      Id: 01HGW3R9QNP4ABCDEFGHJKMNPQ
      Type: test
      Verifies: 01HGW2Q8MNP3RSTVWXYZABCDEF
```

GWT-specific lint rules (detecting missing clauses, mixed-form bodies) are
planned for a future phase.

## INCOSE lexicon rules

These rules flag vocabulary patterns that the INCOSE Guide to Writing
Requirements (GtWR) identifies as common sources of ambiguity. All rules apply
to prose-bearing blocks (paragraphs, notes, list items); tables, code, and math
blocks are excluded.

| Code     | Name                              | Severity | Examples of flagged text                                                       |
| -------- | --------------------------------- | -------- | ------------------------------------------------------------------------------ |
| MSL-Q302 | incose-r7-vague-term              | warning  | `some`, `several`, `many`, `adequate`, `sufficient`, `reasonable`, `as needed` |
| MSL-Q303 | incose-r8-escape-clause           | warning  | `as appropriate`, `where possible`, `if practicable`, `to the extent possible` |
| MSL-Q304 | incose-r9-open-ended              | info     | `including but not limited to`, `etc.`, `and/or`                               |
| MSL-Q305 | incose-r10-superfluous-infinitive | info     | `be able to`, `be designed to`, `in order to`                                  |
| MSL-Q310 | incose-r26-absolute               | info     | `100%`, `always`, `never`, `complete`, `entirely`                              |
| MSL-Q313 | incose-r16-not                    | info     | `not` (whole-word; excludes `note`, `notation`)                                |

Rules `MSL-Q302` and `MSL-Q303` are `warning` severity — they flag text that
routinely causes requirement verification ambiguity. The remaining rules are
`info` — informational hints that the author should consider but that do not
necessarily indicate a defect.

### Example

```text
warning[MSL-Q302]: src/braking/requirements.md:14 vague term 'sufficient' in
body prose — specify a measurable threshold instead (INCOSE GtWR R7)

warning[MSL-Q303]: src/braking/requirements.md:19 escape clause 'as appropriate'
weakens verifiability (INCOSE GtWR R8)
```

## Structural quality rules

Two rules check the shape of entries rather than their vocabulary.

**MSL-Q400 — struct-title-length** (info)

The entry title should be between 3 and 120 characters. A 1–2 character title is
almost certainly incomplete; a title longer than 120 characters is usually a
sentence that belongs in the body.

**MSL-Q401 — struct-body-length** (info)

The entry body should contain between 5 and 500 words. An entry with fewer than
5 words has no meaningful description; one exceeding 500 words is likely
describing multiple concerns that should be split.

Both thresholds are hard-coded defaults in the current phase. Profile-level
configuration (e.g. `prose.struct.title.maxLength`) is planned but not yet
implemented.

## Suppression

A rule can be silenced for a specific entry by adding two trailer attributes:

```markdown
- [SRS_BRK_0108] Legacy inherited requirement

  The system shall operate as appropriate for the ambient conditions.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Markspec-disable: MSL-Q303
      Rationale: Verbatim from customer SRS version 1.2; cannot be rephrased
                 without an approved change request.
```

Both `Markspec-disable` and `Rationale` must be present; a suppression without a
rationale fires **MSL-Q900** (disable-without-rationale). Citing an unknown rule
code fires **MSL-Q901** (disable-unknown-rule). A disable that did not match any
diagnostic during a run fires **MSL-Q902** (disable-unused) — one diagnostic per
unused code at the entry's location — so stale escape hatches get pruned. These
three hygiene rules run on all authored entries regardless of type and cannot
themselves be suppressed.

## Running prose analysis

```bash
markspec lint <paths...>           # info, warning, error output to stderr
markspec lint --format json <paths...>  # structured JSON to stdout
markspec lint --strict <paths...>  # promote warnings to errors (exit 1)
```

The `lint` subcommand is separate from `validate`; the pre-commit hook
(`markspec hook`) does **not** run lint — lint is a review-time quality gate,
not a commit blocker.
