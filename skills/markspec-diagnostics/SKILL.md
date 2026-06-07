---
schema: 1
name: markspec-diagnostics
description: |
  Use when `markspec check` output contains MSL- codes — covers all diagnostic families (P0xx parse, I0xx identity, M0xx modal, A0xx attribute, T0xx type, B0xx body, C0xx caption), severity levels, and common fixes.
---

## Overview

Every MarkSpec diagnostic has the form `severity[MSL-Xnnn]: file:line message`.
The code family (`X`) identifies the rule category. Fix errors first; warnings
are style or convention violations that don't block validation.

Several fixes below say "check the profile's declared types/attributes". Look
these up with the `markspec://profile` MCP resource, the `profile_describe`
tool, or `markspec profile show` / `markspec profile describe <kind> <name>` —
the active profile may be a child profile that extends parents, so its
vocabulary differs from MarkSpec core. See `markspec-entry-authoring`.

## Severity

| Severity  | Exit code | Meaning                                        |
| --------- | --------- | ---------------------------------------------- |
| `error`   | 1         | Must fix before commit or CI passes            |
| `warning` | 2         | Should fix; passes CI unless `--strict` is set |
| `info`    | 0         | Informational; safe to leave                   |

## Code families

### P0xx — Parse

Emitted while reading the Markdown AST. The entry block could not be
interpreted.

| Code     | Message pattern                            | Fix                                                                                      |
| -------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| MSL-P010 | Malformed entry header                     | Verify `- [TYPE_NNNN] Title` format: hyphen, space, brackets, space-separated display ID |
| MSL-P020 | Display ID does not match expected pattern | Check the profile's declared type pattern; prefix and digit width must match exactly     |

### I0xx — Identity

Emitted during identity validation (uniqueness, ULID format).

| Code     | Message pattern      | Fix                                                                                        |
| -------- | -------------------- | ------------------------------------------------------------------------------------------ |
| MSL-I010 | Duplicate display ID | Two entries share the same display ID; delete or renumber one                              |
| MSL-I020 | Duplicate ULID       | Two entries share the same `Id:` ULID; delete the hand-written copy and run `markspec fmt` |
| MSL-I030 | Malformed ULID       | The `Id:` value is not a valid ULID; delete it and run `markspec fmt`                      |

### M0xx — Modal language

Emitted when RFC 2119 modal keyword usage violates profile rules (e.g.
profile-default requires lowercase shall/should/may/must/will).

| Code     | Message pattern         | Fix                                             |
| -------- | ----------------------- | ----------------------------------------------- |
| MSL-M050 | Missing modal keyword   | Body must contain at least one RFC 2119 keyword |
| MSL-M051 | Ambiguous modal keyword | Body uses multiple levels without justification |
| MSL-M060 | Uppercase modal keyword | Lowercase the keyword: `SHALL` → `shall`        |

### A0xx — Attribute

Emitted for trailer attribute violations.

| Code     | Message pattern                       | Fix                                                               |
| -------- | ------------------------------------- | ----------------------------------------------------------------- |
| MSL-A010 | Unknown attribute key                 | Remove or correct the key; check profile's allowed attribute list |
| MSL-A011 | Citation attribute in CSV form        | Rewrite `Satisfies: A, B` as two separate lines                   |
| MSL-A012 | Repeatable attribute with empty value | Remove the empty trailer line                                     |
| MSL-A013 | Single-cardinality attribute repeated | Keep the first occurrence; delete duplicates                      |
| MSL-A030 | Generated attribute present in source | `Id:` was hand-stamped; delete it and run `markspec fmt`          |

### T0xx — Type

Emitted for `Type:` attribute value violations.

| Code     | Message pattern          | Fix                                                                          |
| -------- | ------------------------ | ---------------------------------------------------------------------------- |
| MSL-T010 | Missing required `Type:` | Add a `Type: <name>` trailer; see profile for declared types                 |
| MSL-T020 | Unknown type value       | Check the profile's declared types; the validator suggests the closest match |

### B0xx — Body

Emitted for body-text content violations.

| Code     | Message pattern              | Fix                                                                                             |
| -------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| MSL-B010 | Empty body                   | Add requirement prose between the header line and the trailer block                             |
| MSL-B044 | Body AST equivalence failure | Body contains Markdown the formatter cannot round-trip safely; simplify or escape the construct |

### C0xx — Caption

Emitted for figure/table caption convention violations.

| Code     | Message pattern  | Fix                                                                                                      |
| -------- | ---------------- | -------------------------------------------------------------------------------------------------------- |
| MSL-C072 | Caption position | Move the caption above or below the figure/table as the project's `caption-conventions` setting requires |

## Reading the output

```text
error[MSL-I010]: docs/requirements.md:42 duplicate display ID: SWE_0007
warning[MSL-M060]: docs/requirements.md:17 modal keyword 'SHALL' must be lowercase
```

Column numbers are 1-based. The `markspec check --format json` flag emits
machine-readable output for programmatic consumption.

## Fixing in bulk

```bash
markspec check docs/ --format json | jq '.[] | select(.code == "MSL-M060")'
```

The LSP server surfaces all diagnostics as editor squiggles and offers quick-fix
code actions for MSL-M060, MSL-A030, MSL-T020, MSL-A013, MSL-A011, and MSL-A012.
