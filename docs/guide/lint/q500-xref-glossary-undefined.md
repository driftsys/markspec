# xref-glossary-undefined · MSL-Q500

Group: xref Severity: warning (profiles may promote to error) Source: GtWR v4 R4
(Defined Terms) + R37 (Acronyms); ISO 29148 §9.5

## What it flags

A capitalized domain term in normative prose that resolves to no glossary
`Definition`, no in-entry `DefinitionList` term, and no `$Identifier` registry
entry. "If you Capitalize It, it's defined."

Detects both single PascalCase tokens (`BrakeController`) and multi-word phrases
of adjacent Capitalized tokens (`Brake Controller Unit`), with up to 2 lowercase
connectors (`of` | `the` | `and`) per ADR-021 Decision 2.

The rule never flags a modal keyword (`shall`, `should`, `may`, `must`, `will`)
and the word `not`, or an EARS keyword (`when`, `while`, `where`, `unless`,
`if`, `then`). This holds in any casing, so `SHALL` under
`modal-keywords.casing: rfc8174` is not reported, and a keyword is not joined to
a neighbouring term. An acronym spelled like a keyword, such as `IF`, is also
skipped.

The exception is a glossary term that contains a keyword. The rule reads a
capitalized phrase across a keyword that is in Title case or all caps, and
checks the leading parts of that phrase, longest first. When a leading part that
holds the keyword is a defined term, such as `May Day Protocol` or
`NOT READY STATE`, nothing in that part is reported. This also holds at the
start of a sentence: `May Day Protocol applies here.` reports nothing. The words
after the term are checked as usual: with `not-ready-state` defined,
`the Not Ready State Machine now.` reports only `Machine`. When no leading part
is a defined term, the keyword splits the phrase: with no glossary entry,
`the May Day Protocol` reports `Day Protocol`.

## Why it matters

Capitalization in requirement prose signals a defined term. An undefined
capitalized term either (a) hides an implicit assumption the author has about
the system's vocabulary or (b) is a typo. Either way it is the single
highest-leverage rule for requirement quality in the catalog.

## Trigger

```text
The BrakeController shall apply pressure within 200 ms.
```

When `BrakeController` is not defined anywhere reachable.

## Fix

Define it in the project glossary, or inline:

```markdown
- [STK_BRK_0001] Emergency response

  Brake Controller : the ECU responsible for actuating the brake system

  The Brake Controller shall apply pressure within 200 ms.

      Id: …
```

## Configuration

- `prose.lexicons.capitalized-allow` — list-additive lexicon of
  universally-allowed Capitalized tokens (calendar terms, country names, domain
  acronyms like `ASIL`/`ECU`/`CAN`).
- `prose.severities.xref-glossary-undefined` — promote to error if you want
  compliance gating.
- `prose.weights.xref-glossary-undefined` — default 3.

## Related

- `MSL-M050`, `MSL-M051` — `$Identifier` resolution (core, deferred per ADR-021
  Decision 1).
- listing-directives §4.2 — glossary structure & slug derivation.
- [ADR-021](../../architecture/adr-021-prose-analysis-flagship-build.md) — build
  decisions for the flagship.
