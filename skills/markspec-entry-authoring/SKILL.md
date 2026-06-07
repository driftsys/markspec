---
schema: 1
name: markspec-entry-authoring
description: |
  Use when writing, editing, or reviewing a MarkSpec entry block — the `- [TYPE_NNNN] Title` list-item format, body prose, and trailer attributes (Id, Type, Satisfies, Labels, Verified-by, and other trace keys).
---

## Overview

A MarkSpec entry block is a Markdown list item with a structured header, body
prose, and an indented trailer section. Two shapes exist:

- **Authored** — has an `Id:` trailer (a ULID); the system owns this block and
  stamps its ID.
- **Reference** — no `Id:` trailer; a pointer to an external or higher-level
  requirement.

## Discover the active profile first

Type prefixes, display-ID widths, valid `Type:` values, and which trailer
attributes and trace relations are allowed are defined by the project's **active
profile** — not by MarkSpec core. The active profile is often a **child
profile** that `extends:` one or more parents (e.g.
`aspice-4 → profile-default → markspec-core`), so it may add, rename, or
constrain the vocabulary beyond the core baseline shown below.

**Never assume a default vocabulary. Read the active profile before authoring.**
Prefer the MCP surfaces — they return the _resolved_ chain, not raw YAML:

| Need                                                                 | MCP                                | CLI fallback                              |
| -------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------- |
| Active profile + inherited chain + every declared type/attr/relation | read resource `markspec://profile` | `markspec profile show`                   |
| One element's detail (a type's prefix, a relation's targets)         | `profile_describe` tool            | `markspec profile describe <kind> <name>` |

The `markspec://profile` overview names the **Active** profile and what it
**Inherits**, then lists every declared entry type, attribute, relation, label
concern, and convention — the authoritative answer to "what can I write in this
project". `kind` is one of `type`, `attribute`, `relation`, `label`,
`convention`.

## Block anatomy

```markdown
- [TYPE_NNNN] Title text

  Body prose — one or more paragraphs. Plain Markdown is allowed.

      Id: 01JEMX9GZXYZ0000000000000A
      Type: requirement
      Satisfies: STK_0001
      Labels: ASIL-B, safety-critical
```

| Part            | Rule                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `- [TYPE_NNNN]` | Hyphen + space + display ID in brackets. ID is `PREFIX_NNNN` where prefix is UPPER_SNAKE and NNNN is zero-padded digits. |
| Title           | Free text on the same line, after the closing `]`.                                                                       |
| Body            | Indented 2 spaces. One blank line above and below separates it from header/trailer.                                      |
| Trailer         | Indented **6 spaces** exactly. Each attribute on its own line: `Key: value`.                                             |

## Display ID conventions

- Prefix comes from the active profile's type declaration (e.g. `STK_`, `SWE_`).
- Numbers are zero-padded to a fixed width set by the profile (typically 4
  digits).
- Use `markspec next-id <type> <files...>` to read the next safe number.
- Use `markspec insert <type> <file>` to scaffold a full block with a valid ID.
- **Never invent a ULID by hand.** Leave `Id:` absent and run
  `markspec fmt <file>` to stamp it.

## Core trailer attributes

| Attribute       | Cardinality | Purpose                                                            |
| --------------- | ----------- | ------------------------------------------------------------------ |
| `Id:`           | 0–1         | ULID. Stamped by `markspec fmt`. Present on Authored entries only. |
| `Type:`         | 0–1         | Declared type name from the active profile.                        |
| `Satisfies:`    | 0–N         | Upstream display IDs this entry satisfies (one per line).          |
| `Derived-from:` | 0–N         | Source entries for derived requirements.                           |
| `Verified-by:`  | 0–N         | Test or acceptance-criteria entries that verify this one.          |
| `Tests:`        | 0–N         | Reverse of Verified-by — the entry being tested.                   |
| `Labels:`       | 0–N         | Free-form tags: ASIL level, domain, review state.                  |
| `References:`   | 0–N         | Informational links — does not create a traceability link.         |

This is the core baseline. A child profile may declare additional attributes and
trace relations — discover them via `markspec://profile` (see _Discover the
active profile first_ above).

Multi-value attributes repeat the key on separate lines:

```markdown
Satisfies: STK_0001 Satisfies: STK_0007
```

## Authored vs Reference

**Authored** — has `Id:`:

```markdown
- [SWE_0012] Debounce raw sensor inputs

  The software shall debounce each sensor channel with a 5 ms sliding window.

      Id: 01JEMX9GZXYZ0000000000000A
      Type: requirement
      Satisfies: SYS_0004
      Labels: ASIL-B
```

**Reference** — no `Id:` (external or upstream requirement):

```markdown
- [STK_0001] Vehicle shall stop before collision

  Stakeholder requirement — traced from customer specification §3.1.
```

## Common mistakes

| Mistake                                  | Fix                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| Hand-stamping `Id:`                      | Remove it; run `markspec fmt`                                              |
| Wrong indent on trailers                 | Must be 6 spaces — not 4, not a tab                                        |
| Compound requirement ("and…")            | Split into two separate entries                                            |
| Bare adjective body ("fast", "reliable") | Add units and thresholds                                                   |
| Displaying `${ULID}` literally           | You copied an unformatted scaffold — run `markspec fmt`                    |
| Assuming core types/attributes apply     | Read the active profile (`markspec://profile`) — it may be a child profile |
