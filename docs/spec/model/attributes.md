# Attributes

Attributes are the key-value pairs that appear in an entry's **trailer block** —
the indented section below the body text. They carry the entry's identity, type
classification, trace links, and any domain-specific metadata declared by the
active profile.

## Universal attributes

These attributes apply to every entry regardless of type. They are defined by
core and are always available, even in core-only mode (no profile configured).

| Attribute           | Required | Cardinality | Value                                                                                                                  |
| ------------------- | -------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Id`                | Yes      | Single      | Bare ULID (Authored shape) or URI with scheme (Reference shape)                                                        |
| `Type`              | No       | Single      | Core or profile-declared type name                                                                                     |
| `Labels`            | No       | Multi       | Free-form tags; one `Labels:` line per tag                                                                             |
| `Discipline`        | No       | Single      | ADR-017 — author-asserted discipline kind (`software`, `hardware`, …). Overrides the classifier's derivation channels. |
| `Discipline-frozen` | No       | Single      | ADR-017 — cached snapshot of a past derivation: `<kind>` or `<kind> @ <YYYY-MM-DD>`. Excluded from re-derivation.      |
| `References`        | No       | Multi       | Display ID, optionally followed by a locator in `[…]`                                                                  |
| `External-id`       | No       | Single      | Cross-system identifier (Jira, DOORS, …)                                                                               |
| `Supersedes`        | No       | Single      | Display ID of the predecessor entry (Authored only)                                                                    |
| `Superseded-by`     | —        | Generated   | Inverse of `Supersedes`; written by `markspec format`                                                                  |
| `Deprecated`        | No       | Single      | Quoted retirement reason string                                                                                        |

### Id

The `Id:` attribute is the primary stable identifier. Its format determines the
entry's shape:

```markdown
Id: 01HGW2Q8MNP3RSTVWXYZABCDEF ← Authored (26-char ULID) Id:
urn:iso:std:iso:26262:-6:ed-2 ← Reference (URI with scheme)
```

ULIDs are assigned by `markspec format`. An entry without an `Id:` is
"unstamped" — the validator emits `MSL-A010` in strict mode, and
`markspec format` will add one on the next run.

### Type

The `Type:` attribute holds the entry's type name. It may be a core concrete
type (`Requirement`, `Test`, `SoftwareComponent`, …) or a profile-declared
subtype name (`requirement`, `hazard`, `feature`, …).

```markdown
Type: requirement
```

When absent, the toolchain resolves the type through the 8-step chain described
in the [Type taxonomy](types.md) chapter. Unknown values raise `MSL-T020`.

### Labels

`Labels:` is a multi-value attribute. Each value is a free-form tag. The
preferred form is one line per tag; CSV is accepted and normalized by
`markspec format`:

```markdown
# One tag per line (preferred)

    Labels: ASIL-B
    Labels: safety-critical
    Labels: DRAFT

# CSV on a single line (accepted, normalized on format)

    Labels: ASIL-B, safety-critical, DRAFT
```

Labels are plain strings — they carry no semantics in core. Profiles can declare
**label concerns** (a structured vocabulary of expected labels) and the
validator then checks that label values are from the declared set.

### References

`References:` links an entry to an external standard or resource by display ID,
optionally followed by a locator in square brackets:

```markdown
References: ISO-26262-6 [§4.3] References: RFC-2119 [§3] References: serde-1-0
```

The locator (`[§4.3]`) is free text — it is preserved verbatim in the compiled
output but not parsed further.

### External-id

`External-id:` records a cross-system identifier — the ID of a ticket in an
issue tracker, a DOORS object ID, a SharePoint item ID, etc. This is a
single-value attribute:

```markdown
External-id: JIRA-4567 External-id: DOORS-MODULE-23/OBJ-0042
```

The value is opaque to MarkSpec. It is preserved in the compiled output and
available for traceability matrix generation.

### Supersedes and Superseded-by

`Supersedes:` records the display ID of a predecessor entry that this entry
replaces. It is only meaningful for Authored entries (external URIs have their
own versioning).

```markdown
Supersedes: SRS_BRK_0042
```

When `markspec format` encounters a `Supersedes:` line, it writes the inverse
`Superseded-by:` attribute on the target entry automatically. The author only
writes `Supersedes:` — never `Superseded-by:`.

### Deprecated

`Deprecated:` records a retirement reason. The value is a quoted string:

```markdown
Deprecated: "Replaced by SRS_BRK_0107; no longer relevant after v2.0"
```

Deprecated entries are not removed — they remain in the compiled output, but the
validator can be configured to warn or error on references to deprecated
entries.

## Multi-value attributes

Any attribute declared as `cardinality: multi` in the profile accepts one value
per line. The two equivalent forms are:

```markdown
# One value per line (preferred for readability)

    Labels: ASIL-B
    Labels: safety-critical

# CSV (accepted; normalized by markspec format)

    Labels: ASIL-B, safety-critical
```

`markspec format` always normalizes to the one-per-line form. If a CSV line
contains a value that includes a comma (e.g., a citation locator like
`ISO-26262-6 [§4, §5]`), the square-bracket content is treated as a single token
and not split.

## Authored-only attributes

`Supersedes` is only meaningful for Authored entries. Reference entries have
stable external URIs as their `Id:` — versioning happens in the external system,
not in MarkSpec.

## Reference-only attributes

The following attributes are declared by the `@markspec/default` profile and
apply specifically to Reference-shape entries:

| Attribute            | Value                                                   |
| -------------------- | ------------------------------------------------------- |
| `Reference-url`      | Canonical URL for the standard or package               |
| `Reference-document` | Human-readable citation string                          |
| `License`            | SPDX identifier (e.g., `Apache-2.0`, `ISO-proprietary`) |

Example:

```markdown
- [@ISO-26262-6] ISO 26262 Part 6

      Id: urn:iso:std:iso:26262:-6:ed-2
      Reference-document: ISO 26262-6:2018
      Reference-url: https://www.iso.org/standard/68388.html
      License: ISO-proprietary
```

These attributes are not part of core — they require `@markspec/default` (or any
profile that extends it) to be active. In core-only mode, using `Reference-url`
raises `MSL-A020` (unknown attribute key).

## Typical attributes by concrete type

The tables below summarize typical attribute usage by type group. Attributes
under "Typical profile attributes" are **not** defined by core — they require
the relevant profile to be active. Only the universal attributes in the section
above are available in core-only mode.

### Specification types

| Type                | Typical profile attributes               | Typical relation attributes                             |
| ------------------- | ---------------------------------------- | ------------------------------------------------------- |
| `Requirement`       | `ASIL`, `Priority`, `Safety-goal`        | `Satisfies`, `Derived-from`                             |
| `Test`              | `Test-level`, `Test-type`, `Test-result` | `Verifies`, `Tests`                                     |
| `Contract`          | (none typical)                           | `Satisfies`, `Realized-by` (generated)                  |
| `SoftwareInterface` | (none typical)                           | `Provided-by`, `Required-by`, `Realized-by` (generated) |
| `HardwareInterface` | `Bus-protocol`, `Voltage-level`          | `Provided-by`, `Required-by`, `Realized-by` (generated) |
| `Record`            | (none typical)                           | (standalone)                                            |
| `Risk`              | `ASIL`, `Severity`, `Probability`        | `Mitigated-by` (generated)                              |

### Component types

| Type                | Typical profile attributes       | Typical relation attributes |
| ------------------- | -------------------------------- | --------------------------- |
| `SoftwareComponent` | `Version`, `License`, `Supplier` | `Part-of`, `Depends-on`     |
| `HardwareComponent` | `Version`, `Supplier`            | `Part-of`                   |

### Unit types

| Type           | Typical profile attributes | Typical relation attributes |
| -------------- | -------------------------- | --------------------------- |
| `SoftwareUnit` | (none typical)             | `Part-of`, `Realizes`       |
| `HardwareUnit` | (none typical)             | `Part-of`                   |

### Item types

| Type         | Typical profile attributes                       | Notes                                                |
| ------------ | ------------------------------------------------ | ---------------------------------------------------- |
| `Definition` | (none typical)                                   | Used in glossary cross-check lint rule               |
| `Objective`  | `Priority`                                       | Upstream anchor for `Requirement` `Satisfies` chains |
| `Standard`   | `Reference-url`, `Reference-document`, `License` | Always Reference shape                               |
| `Change`     | `Priority`, `Status`                             | Links to Requirements via `Addresses`                |

## Profile-declared attributes

A profile can declare additional attributes via its `attributes:` section:

```yaml
profile:
  attributes:
    - key: ASIL
      applies-to: [requirement, hazard, test]
      cardinality: single
      values: [ASIL-A, ASIL-B, ASIL-C, ASIL-D, QM]

    - key: Priority
      applies-to: [requirement, change]
      cardinality: single
      values: [critical, high, medium, low]
```

Profile-declared attributes are validated just like core attributes: unknown
values raise `MSL-A022`, wrong cardinality raises `MSL-A013`. The difference is
that these rules only activate when the declaring profile is present.

## Attribute ordering

`markspec format` normalizes the trailer attribute order:

1. `Id`
2. `Type`
3. Relation attributes (`Satisfies`, `Derived-from`, `Verifies`, `Tests`, …)
4. `Labels`
5. `References`
6. `External-id`
7. `Supersedes` / `Superseded-by`
8. `Deprecated`
9. Any remaining profile-declared attributes (alphabetical)

Attribute order has no semantic significance — the normalized order is purely
for readability and diff stability.
