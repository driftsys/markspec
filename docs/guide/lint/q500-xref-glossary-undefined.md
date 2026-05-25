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
