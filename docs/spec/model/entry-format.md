# Entry format

An **entry** is the atomic unit of the MarkSpec model. It is a Markdown list
item that follows a specific structure: a bracketed display ID, a title, an
optional body, and an indented trailer block of key-value attributes.

## Anatomy of an entry

```text
- [SRS_BRK_0107] Sensor debouncing
         ↑              ↑
   display ID         title

  The sensor driver shall debounce raw inputs
  to eliminate noise.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
      Derived-from: SYS_BRK_0042
      Labels: ASIL-B
  ↑
  trailer block (4+ space indent)
```

### Title line

The title line is a Markdown list item (`-`) containing the display ID in square
brackets, followed by a space, followed by the title text:

```text
- [DISPLAY_ID] Title text
```

The `[` and `]` are required. The display ID is case-sensitive. The title text
extends to the end of the line; it cannot span multiple lines.

### Display ID

A display ID is a non-empty string of letters, digits, underscores, hyphens,
dots, and slashes. It must start with an alphanumeric character. Display IDs are
case-sensitive: `SRS_BRK_0107` and `srs_brk_0107` are different IDs.

Valid examples:

```text
SRS_BRK_0107
STK-001
pkg/my-lib@1.2.0
ISO.26262.6
```

By convention, profile-declared types use `PREFIX_NNNN` patterns (e.g.,
`SRS_BRK_0107`), where the prefix identifies the type and the number provides
ordering. The `markspec next-id` command computes the next available number for
a given prefix.

### Body text

The body is one or more prose paragraphs, indented at least 2 spaces relative to
the list item marker:

```markdown
- [SRS_BRK_0107] Sensor debouncing

  The sensor driver shall debounce raw inputs to eliminate noise. This prevents
  spurious activations during normal driving.

  A secondary paragraph can elaborate further.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
```

**Style rules for body text:**

- Use `_emphasis_` sparingly — it is not recommended inside entries; prefer
  `**strong**` for key terms or `` `code` `` for identifiers.
- Modal verbs (`shall`, `should`, `may`, `must not`) follow RFC 2119 semantics
  when the `@markspec/default` profile is active.
- The body is optional for Reference-shape entries.
- Blank lines between the title line, body paragraphs, and the trailer block are
  required.

### Trailer block

The trailer block is a set of key-value attribute lines, each indented at least
4 spaces (6 spaces is the canonical indent produced by `markspec format`):

```markdown
Id: 01HGW2Q8MNP3RSTVWXYZABCDEF Type: requirement Derived-from: SYS_BRK_0042
Labels: ASIL-B Labels: safety-critical
```

Rules:

- Keys use `PascalCase` or `Title-Case-With-Hyphens`; they are case-sensitive.
- Each line is `Key: value`; there is exactly one space after the colon.
- Multi-value attributes (`Labels`, `Satisfies`, …) use one line per value. CSV
  form (`Labels: ASIL-B, safety-critical`) is accepted on input and normalized
  to one-per-line by `markspec format`.
- The `Id:` attribute is required for all entries (a missing `Id:` is a warning;
  the entry receives no ULID until `markspec format` is run).
- Attribute order within the trailer is not significant for semantics, but
  `markspec format` normalizes it: `Id` first, then `Type`, then relations, then
  `Labels`, then any remaining attributes.
- The `Discipline:` and `Discipline-frozen:` attributes are author overrides of
  the discipline derivation pass (see
  [Type taxonomy → Discipline classification](types.md#discipline-classification)).
  `Discipline:` is single-valued and matches `/^[a-z][a-z0-9-]*$/`;
  `Discipline-frozen:` carries a `<kind>` or `<kind> @ <YYYY-MM-DD>` snapshot
  that is excluded from re-derivation.

**Computed fields.** The parser emits `Entry.bodyTokens` — a flat
position-sorted token stream covering modal verbs, EARS triggers, Gherkin
keywords, `$Identifier` entity refs and inline code (ADR-016). These tokens are
not author-editable; they are recomputed on every parse and surface in the
compile-output entry record. After the discipline pass, an entry may also carry
`Entry.derivedDiscipline` (set of disciplines reached via `Allocated-to`).

## The two shapes

The `Id:` value alone determines an entry's **shape**. There is no other
indicator — the shape is mechanically derived from whether the value is a bare
ULID or a URI with a scheme prefix.

### Authored shape

The `Id:` value is a 26-character uppercase base32 ULID:

```markdown
- [SRS_BRK_0107] Sensor debouncing

  The sensor driver shall debounce raw inputs.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
      Labels: ASIL-B
```

ULIDs are time-ordered unique identifiers. They are assigned by
`markspec format` on the first format run after an entry is created. Until then
the entry is in an "unstamped" state; the validator emits `MSL-A010` for
unstamped entries in strict mode.

Authored entries represent items created in this project. They are expected to
evolve over time (body edits, new attributes) while keeping the same ULID. The
ULID is the stable identifier; the display ID is the human-readable alias.

### Reference shape

The `Id:` value is a URI with a recognised scheme (`urn:`, `doi:`, `pkg:`,
`https:`):

```markdown
- [@ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional safety — Part 6: Product development at the
  software level.

      Id: urn:iso:std:iso:26262:-6:ed-2
      Reference-document: ISO 26262-6:2018
      Reference-url: https://www.iso.org/standard/68388.html
```

**The `@` prefix convention:** Reference entries often use `[@slug]` syntax
where the `@` signals to the author that this is a reference, not an authored
item. The `@` is stripped from the display ID in the model — the actual display
ID stored is `ISO-26262-6`, not `@ISO-26262-6`. This is a syntactic convenience
only.

Reference entries represent external standards, packages, or resources. Their
`Id:` is a stable external identifier, not a MarkSpec-assigned ULID. The body is
optional — it may contain a human-readable summary of the referenced document.

**Accepted URI schemes for Reference shape:**

| Scheme   | Example                                  | Typical use                        |
| -------- | ---------------------------------------- | ---------------------------------- |
| `urn:`   | `urn:iso:std:iso:26262:-6:ed-2`          | ISO standards, ISO URNs            |
| `doi:`   | `doi:10.1109/IEEESTD.2018.8299595`       | Academic papers, IEEE standards    |
| `pkg:`   | `pkg:cargo/serde@1.0.197`                | Open-source packages (purl format) |
| `https:` | `https://www.rfc-editor.org/rfc/rfc2119` | Web documents, RFCs                |

## In-source entries

MarkSpec can extract entries from source-file doc comments. The entry format
inside a doc comment is identical to the Markdown format, embedded within the
comment syntax of the host language.

**Kotlin / Java / C example:**

```kotlin
/**
 * [SWT_BRK_0030] Debounce test
 *
 * The debounce function shall reject inputs shorter than the
 * configured threshold.
 *
 *     Id: 01HGW3R9QNP4ABCDEFGHJKMNPQ
 *     Type: test
 *     Verifies: SRS_BRK_0107
 */
@Test
fun debounce() {
    // ...
}
```

**Rust example:**

```rust
/// [SWT_BRK_0030] Debounce test
///
/// The debounce function shall reject inputs shorter than the
/// configured threshold.
///
///     Id: 01HGW3R9QNP4ABCDEFGHJKMNPQ
///     Type: test
///     Verifies: SRS_BRK_0107
#[test]
fn debounce() {
    // ...
}
```

**Supported languages and comment styles:**

| Language | Comment style           |
| -------- | ----------------------- |
| Rust     | `///` line comments     |
| Kotlin   | `/** */` block comments |
| Java     | `/** */` block comments |
| C / C++  | `/** */` block comments |

The `markspec validate` and `markspec compile` commands accept source files
alongside Markdown files. The `source.*` properties namespace in the compile
output records the source language and enclosing function name for in-source
entries.

## Blank line requirements

Blank lines are significant:

```markdown
- [SRS_BRK_0107] Sensor debouncing ← blank line required Body paragraph one. ←
  blank line between paragraphs Body paragraph two (optional). ← blank line
  before trailer Id: 01HGW2Q8MNP3RSTVWXYZABCDEF Type: requirement
```

A title line immediately followed by a trailer (no body, no blank line) is
accepted; the entry simply has an empty body:

```markdown
- [SRS_BRK_0107] Sensor debouncing

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
```

Note that even with no body, a blank line between the title and the trailer is
required.
