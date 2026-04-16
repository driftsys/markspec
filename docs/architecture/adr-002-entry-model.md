# ADR-002: Entry Model — Spec, Test, Element, and Reference Entries

Status: Proposed\
Date: 2026-04-17\
Scope: MarkSpec\
Supersedes: (extends ADR-001)

## Context

ADR-001 introduced entry blocks as MarkSpec's mechanism for authoring traceable
artifacts alongside prose. It hardcoded an automotive V-model vocabulary (STK,
SYS, SRS, SAD, ICD, VAL, SIT, SWT) directly into the core specification, which
ties MarkSpec to a single domain and limits adoption in aerospace, medical,
railway, and other safety-critical contexts.

This ADR separates the **entry format** from the **domain vocabulary**. The core
defines a universal entry model with four families — **spec entries**, **test
entries**, **element entries**, and **reference entries** — each with a precise
format, a dedicated identity attribute, and well-defined validation rules.
Concrete type vocabularies move out of the core into profiles.

The four families correspond to four distinct roles in a technical repository:

- **Spec** — a numbered, locally-authoritative declaration the project
  formulates: a requirement, a design decision, an architecture block, a hazard.
  The project is the author and carries the editorial authority.
- **Test** — a verification of declared behavior, either executable (unit,
  integration, system tests) or procedural (manual acceptance tests). A test is
  both a specification of what must be verified and, when automated, an
  executable artifact. Tests are distinct from specs because of this dual nature
  and their execution lifecycle.
- **Element** — a canonical declaration of a system object with stable semantic
  identity: a component, a unit of production code, a file, a piece of hardware,
  a consumed dependency. The display ID follows a namespace convention that
  mirrors the naming in the real world.
- **Reference** — a bibliographic citation of an external published artifact: a
  standard, a regulation, a paper, an RFC. The slug names an external work; no
  ULID is needed.

### Key design decision: discrimination by identity attribute

The family of an entry is determined by the **identity attribute** it carries in
its trailers, not by syntactic markers in the display ID. Each family has its
own dedicated identity attribute:

- `Spec-id` → the entry is a spec
- `Test-id` → the entry is a test
- `Element-id` → the entry is an element
- `Reference-id` → the entry is a reference

This is a departure from earlier drafts that used syntactic markers (`@` for
refs, `::` for elements) to signal family. Marker-based discrimination adds
friction to authoring and creates overlapping regexes that must be kept
disjoint. Attribute-based discrimination uses the trailer content the entry
already carries, keeps display IDs clean, and makes family resolution trivial.

Syntactic markers that remain in the format (`@` for Pandoc citation
compatibility, `::` for element hierarchy) serve different purposes and are no
longer tied to family recognition.

### Key design decision: Test as a distinct family

Earlier iterations treated tests as elements with a `Role: test` attribute, or
as specs with a type distinction. Both approaches conflate the dual nature of a
test. A test is simultaneously:

- A **specification** of expected behavior (what must be true, under what
  conditions, with what pass/fail criteria).
- An **executable** (or procedural) artifact with an execution lifecycle (it
  runs, produces results, can be re-executed, regressed, timed).

Neither specs (purely declarative) nor elements (materially-existing entities)
capture this duality cleanly. Promoting Test to its own family yields:

- **Clearer semantics** — test-specific attributes (`Verifies`, `Tests`,
  `Level`) live naturally on Test without polluting other families.
- **Structural alignment with industry standards** — every safety-critical
  standard (ISO 26262, DO-178C, IEC 62304, EN 50128) treats test artifacts as
  distinct work products with dedicated traceability requirements (ASPICE SWE.4
  BP5, DO-178C §6.4, IEC 62304 §5.5).
- **Cleaner core** — each family has focused, well-typed attributes instead of
  shared attributes that only apply in some cases.

---

## Part 1 — Entry (Common Base)

All entry families share a common syntactic form and a common set of universal
properties. `Entry` is an abstract concept — every concrete entry is a spec, a
test, an element, or a reference.

### Syntactic form

```text
- [DISPLAY_ID] Title

  Body paragraphs.

  Key: Value \
  Key: Value
```

An entry block is a Markdown list item whose content between `[` and `]` is a
display ID, followed by a non-empty title on the same line, followed by indented
body content, optionally terminated by `Key: Value` trailers following the
git-trailers convention.

### Required structural properties

| Property       | Rule                                                              |
| -------------- | ----------------------------------------------------------------- |
| **display_id** | Non-empty string matching the family's display ID format          |
| **title**      | Non-empty string on the same line as the `[DISPLAY_ID]` marker    |
| **body**       | At least one paragraph (reference entries excepted — see Part 3)  |
| **identity**   | Exactly one of `Spec-id`, `Test-id`, `Element-id`, `Reference-id` |

### Universal core attribute

| Attribute  | Description                                          |
| ---------- | ---------------------------------------------------- |
| **Labels** | Free-form classification tags. Comma-separated list. |

`Labels` is the only semantically universal attribute at the core level.
Identity attributes are structurally universal (every entry must carry exactly
one) but their name and value format depend on the family.

---

## Part 2 — Spec Entries

A spec entry is a numbered, locally-authoritative declaration the project
formulates: a requirement, an architecture block, a design decision, a hazard,
an analysis. Anything the project creates, numbers, and treats as a normative or
design artifact is a spec.

**Tests are not specs** — they have their own family (Part 4).

### Display ID format

```text
^[A-Z]{2,6}_[A-Z][A-Z0-9]{2,7}(_[A-Z][A-Z0-9]{2,7})?_\d{3,6}$
```

The display ID has three or four segments separated by underscores:

- **TYPE** — 2 to 6 uppercase letters. Identifies the kind of object. Defined by
  the loaded profile (e.g., STK, SRS, SAD, ICD in an automotive profile).
- **DOMAIN** — 3 to 8 characters. Identifies a project subsystem or area (e.g.,
  BRK for braking).
- **SUBDOMAIN** — optional, same format as DOMAIN.
- **NNNN** — 3 to 6 digits, numeric value ≥ 1. Sequence number within the scope.

Examples: `SRS_BRK_0107`, `STK_BRK_0001`, `SAD_BRK_CTRL_0042`, `HAZ_VHC_00001`.

### Numbering rule

Numbering within a scope (`TYPE_DOMAIN` or `TYPE_DOMAIN_SUBDOMAIN`) is
independent per scope. New entries are assigned the next available number.
Padding is computed from the current maximum:

```text
padding = max(3, len(str(N_max_in_scope)))
```

Mixed padding (3 to 6 digits) is silently accepted within a scope. Existing
entries are never renumbered. Display IDs are stable.

### Subdomain consistency rule

Within a `TYPE_DOMAIN` scope, all entries must either use a subdomain
consistently or not use one at all. A scope is either flat or subdivided, not
both.

### Identity attribute

Every spec entry carries a `Spec-id` attribute containing a bare ULID:

```text
Spec-id: 01HGW2P4KFR7ABCDEFGHJKMNP
```

The value is 26 characters in Crockford base32, with no TYPE prefix. The family
information is carried by the attribute name, not by a prefix in the value. This
keeps the value format strictly aligned with the ULID specification and allows
any standard ULID library to generate and validate it directly.

**Assignment**: set by `markspec format` on commit, never hand-authored.
**Immutability**: once assigned, never changed. **Uniqueness**: globally unique
across the registry chain.

### Core attributes

| Attribute        | Description                                                                             |
| ---------------- | --------------------------------------------------------------------------------------- |
| **Spec-id**      | ULID, required, assigned by `markspec format`                                           |
| **Derived-from** | Optional, repeatable. Upstream link to parent spec(s) via V-model decomposition         |
| **Satisfies**    | Optional, repeatable. Upstream link to parent spec(s) this spec completely fulfills     |
| **References**   | Optional, repeatable. Upstream link to external reference(s)                            |
| **Allocated-to** | Optional, repeatable. Downstream link to element(s) responsible for realizing this spec |
| **Labels**       | Universal core attribute                                                                |

**Derived-from** expresses the relation by which a spec is produced from a
parent spec, by decomposition, refinement, or partial realization. It is the
**broad** spec-to-spec traceability link in MarkSpec, aligned with the ISO 26262
vocabulary where requirements are _derived_ from parents in the V-model chain
(Safety Goal → FSR → TSR → SSR → detailed design).

`Derived-from` covers the common case where a child spec contributes to a parent
without necessarily fulfilling it on its own. Several children may be derived
from the same parent, each addressing a different aspect of it.

```text
Derived-from: SYS_BRK_0042
Derived-from: SYS_BRK_0043
```

**Satisfies** expresses a stronger relation: the child spec **completely
fulfills** its parent on its own. Where `Derived-from` captures decomposition
(the child is a piece of the parent), `Satisfies` captures realization (the
child is a self-sufficient answer to the parent).

```text
Satisfies: SYS_BRK_0042
```

The two attributes are **complementary**, not mutually exclusive. A spec may
carry both when the parent is realized by a single child that is also a
decomposition element of it.

- Use **`Derived-from`** when several children collectively implement a parent —
  the default case in V-model decomposition.
- Use **`Satisfies`** when one child alone is sufficient to fulfill the parent.

Profiles may restrict or refine these semantics.

**References** expresses the external source(s) of a spec. The cited source can
be a standard, a regulation, a contract, an internal company document, a
research paper, or any bibliographic entity tracked as a reference entry.

```text
References: ISO-26262-6 §9.4.5
References: UNECE-R155
```

`References` is **repeatable**. The value format is `slug [locator]` — the slug
identifies the reference entry, and the optional locator (e.g., `§9.4.5`,
`Table 7`, `p. 42`) points to a specific section within the referenced document.

**Allocated-to** expresses **top-down architectural allocation** — the architect
declares which Element(s) are responsible for realizing this Spec. The direction
is opposite to `Realizes` on Element: where `Realizes` is bottom-up (the code
declares what it implements), `Allocated-to` is top-down (the architect declares
who must implement).

```text
Allocated-to: braking::controller
Allocated-to: braking::controller::debounce_input
```

The two attributes are **complementary, not redundant**. They support two
engineering modes that often coexist:

- **Intentional architecture** — the architect allocates Specs to Elements
  **before** the code exists. `Allocated-to` captures this decision at the
  moment it is made, in the V-model design phase.
- **Emergent design** — the developer declares `Realizes` on the code as it is
  written.

When both are present, tooling verifies consistency: a Spec allocated to Element
A should be realized by Element A.

`Allocated-to` aligns with the ASPICE 4.0 vocabulary, where **SWE.2 BP2** is
explicitly named "**Allocate** software requirements".

### Generated attributes

| Attribute        | Description                                                                    |
| ---------------- | ------------------------------------------------------------------------------ |
| **Derives**      | Downstream inverse of `Derived-from`. Specs that derive from this one.         |
| **Satisfied-by** | Downstream inverse of `Satisfies`. Specs that completely fulfill this one.     |
| **Realized-by**  | Downstream inverse of `Realizes` on elements. Elements that realize this spec. |
| **Verified-by**  | Downstream inverse of `Verifies` on tests. Tests that verify this spec.        |

Generated attributes are never committed. They are build artifacts produced by
tooling that walks the repository and collects upstream declarations from
elements and tests. The traceability matrix is generated by inverting these
declarations.

### Example

Standard software requirement:

```markdown
- [SRS_BRK_0107] Sensor input debouncing

  The sensor driver shall debounce raw inputs to eliminate electrical noise
  before processing. The debounce window shall be configurable per sensor type.

  > [!WARNING]
  > Failure to debounce may lead to spurious brake activation.

  Spec-id: 01HGW2Q8MNP3RSTVWXYZABCDE\
  Derived-from: SYS_BRK_0042\
  Labels: ASIL-B
```

Normative stakeholder requirement mandated by a safety standard:

```markdown
- [STK_BRK_0042] Structural coverage at unit level

  The project shall measure structural code coverage at the software unit level
  for all production code, with decision coverage achieved for ASIL-D
  components.

  Spec-id: 01HGW2R0NPQR4STVWXYZABCDE\
  References: ISO-26262-6 §9.4.5\
  References: ISO-26262-6 Table-12\
  Labels: ASIL-D, coverage
```

Architecture block with top-down allocation:

```markdown
- [SAD_BRK_0003] Sensor filtering component

  The sensor filtering component provides debouncing and range-checking for all
  pressure sensor inputs to the braking subsystem.

  Spec-id: 01HGW2S1PQRS5TUVWXYZABCDE\
  Derived-from: SRS_BRK_0107\
  Allocated-to: braking_core::controller::sensor_filter\
  Labels: ASIL-B
```

---

## Part 3 — Reference Entries

A reference entry is a bibliographic citation of an external artifact: a
standard, a regulation, a paper, a specification, a book. It names a work that
exists outside the project.

### Slug format

```text
^[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?$
```

The slug starts with a letter, contains alphanumerics, `.`, `/`, `-`, and `_`,
and ends with an alphanumeric character. Mixed case is accepted.

This format is a **disciplined subset** of the Pandoc citation key convention.
MarkSpec excludes the wider range of Pandoc-allowed characters (`:`, `#`, `$`,
etc.) to keep slugs readable and avoid collisions with other Markdown syntaxes.

**Style recommendation**:

- Technical standards: uppercase with hyphens (`ISO-26262-6`, `DO-178C`).
- Academic citations: lowercase with year suffix (`smith2021`).
- Standards with hierarchical organization: slash-separated (`ISO/IEC-25010`,
  `ISO/IEC/IEEE-29148`).

**Pandoc inline citation compatibility** is preserved at the syntactic level:
MarkSpec recognizes the Pandoc `[@key]` pattern in prose and resolves it through
its registry chain.

### Pandoc `@` compatibility

Reference entries may be declared with or without a leading `@` in the display
ID:

```markdown
- [@ISO-26262-6] ISO 26262 Part 6
```

or equivalently:

```markdown
- [ISO-26262-6] ISO 26262 Part 6
```

Both declare a reference with slug `ISO-26262-6`. The `@` is optional syntax,
stripped during parsing. The canonical slug never contains `@`.

### Identity attribute

Every reference entry carries a `Reference-id` attribute containing a URI:

```text
Reference-id: urn:iso:std:iso:26262:-6:ed-2
```

Unlike specs, tests, and elements, the `Reference-id` is **author-provided**,
not tooling-generated. It is the canonical identifier of the external work in
its most stable form:

- **Preferred** — URN: `urn:iso:std:iso:26262:-6:ed-2`, `urn:ietf:rfc:2119`
- **Preferred** — DOI: `doi:10.1109/IEEESTD.2008.4610935`
- **Accepted** — HTTPS URL of the authoritative source, when no URN or DOI is
  available

All three forms are valid URIs per RFC 3986.

### No ULID for references

Reference entries do not carry an ULID. The slug is the canonical local
identifier, and the `Reference-id` is the canonical external identifier.

### Body is optional

Unlike specs, tests, and elements, a reference entry's body is optional.

### Core attributes

| Attribute         | Description                                                         |
| ----------------- | ------------------------------------------------------------------- |
| **Reference-id**  | URI, required, author-provided                                      |
| **Url**           | Optional. HTTPS navigation link, when different from `Reference-id` |
| **Document**      | Optional. Canonical document identifier; falls back to title        |
| **Superseded-by** | Optional. Slug of a reference that replaces this one                |
| **Labels**        | Universal core attribute                                            |

### Section locators in citations

When a spec or test cites a reference via the `References` attribute, the value
may include a free-text locator after the slug:

```text
References: ISO-26262-6 §9.4.5
References: IEC-61508-3 Table A.5
```

The tooling extracts the leading token as the reference slug; the trailing
locator is preserved verbatim for display and is not validated.

### Generated attributes

| Attribute    | Description                                                                             |
| ------------ | --------------------------------------------------------------------------------------- |
| **Cited-by** | Downstream inverse of `References`. Specs, tests, or elements that cite this reference. |

### Status via Labels

Reference lifecycle is expressed via `Labels`, not a dedicated `Status`
attribute. Common labels: `withdrawn`, `superseded`, `draft`, `informative`.

### Example

```markdown
- [@ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional safety — Part 6: Software level. Defines
  requirements for software unit design, implementation, and verification across
  ASIL levels A through D.

  Reference-id: urn:iso:std:iso:26262:-6:ed-2\
  Url: https://www.iso.org/standard/68383.html\
  Document: ISO 26262-6:2018\
  Labels: functional-safety, automotive
```

---

## Part 4 — Test Entries

A test entry is a verification of declared behavior. Tests are distinct from
specs because they combine two roles: they **specify** what must be verified
(under what conditions, with what pass/fail criteria), and they are **executed**
— either automatically (a `#[test]` function that runs and produces results) or
manually (a test procedure followed by a human on a vehicle, a HIL bench, or a
prototype).

This dual nature — specification and executable lifecycle — motivates a
dedicated family. It also aligns structurally with every safety-critical
standard, where test artifacts are distinct work products with their own
traceability requirements (ASPICE SWE.4 BP5, DO-178C §6.4, IEC 62304 §5.5, EN
50128 §6.5).

### Display ID format

Tests use the same display ID format as specs:

```text
^[A-Z]{2,6}_[A-Z][A-Z0-9]{2,7}(_[A-Z][A-Z0-9]{2,7})?_\d{3,6}$
```

The TYPE prefix identifies the kind of test (e.g., `SWT`, `SIT`, `VAL` in common
automotive conventions, or `UT`, `IT`, `ST`, `AT` in generic usage). **No TYPE
prefix is prescribed by the core** — profiles define their own conventions, and
each project may use any TYPE it wishes.

Examples: `SWT_BRK_0107`, `SIT_BRK_0042`, `VAL_VHC_0001`, `UT_BRK_0107`.

### Identity attribute

Every test entry carries a `Test-id` attribute containing a bare ULID:

```text
Test-id: 01HGW3R9QLP4ABCDEFGHJKMNPQ
```

Same format as `Spec-id` and `Element-id`: 26 characters in Crockford base32, no
TYPE prefix.

**Assignment**: set by `markspec format`, never hand-authored. **Immutability**:
once assigned, never changed. **Uniqueness**: globally unique across the
registry chain.

### Core attributes

| Attribute    | Origin                   | Cardinality | Description                                              |
| ------------ | ------------------------ | ----------- | -------------------------------------------------------- |
| **Test-id**  | authored (tool-assigned) | 1           | ULID, required                                           |
| **Level**    | authored or inferred     | 0..1        | Test level in the V-model hierarchy                      |
| **Source**   | inferred                 | 0..1        | Filesystem path of the source file (for automated tests) |
| **Verifies** | authored                 | 0..*        | Upstream link to spec(s) this test verifies              |
| **Tests**    | authored                 | 0..*        | Upstream link to element(s) this test exercises          |
| **Labels**   | authored                 | 0..*        | Universal core attribute                                 |

### Level vocabulary

The core `Level` vocabulary follows the universal V-model terminology
established by ISO/IEC/IEEE 29119 and adopted across every safety-critical
standard:

| Level         | Description                                                                           |
| ------------- | ------------------------------------------------------------------------------------- |
| `unit`        | Verifies a single code unit in isolation against its detailed design or specification |
| `integration` | Verifies interactions between multiple units or components                            |
| `system`      | Verifies the integrated system against its system requirements                        |
| `acceptance`  | Validates the system against stakeholder needs                                        |

`Level` is **optional at the core**. A test without `Level` is structurally
valid. Profiles may make it mandatory.

The core vocabulary is **extensible by profile** — a profile may add
domain-specific levels (e.g., hardware/software integration, penetration test,
smoke test) or refine distinctions within the base levels.

### Profile mapping examples

The following table illustrates how different industry standards map their test
activities to the core `Level` vocabulary. The activity names are those defined
by each standard's reference model; **the TYPE prefixes used in display IDs are
not prescribed by MarkSpec** — each profile or project defines its own
conventions.

| Core Level    | ASPICE 4.0                                             | DO-178C                             | IEC 62304                         | ISO/IEC/IEEE 29119     |
| ------------- | ------------------------------------------------------ | ----------------------------------- | --------------------------------- | ---------------------- |
| `unit`        | SWE.4 Software Unit Verification                       | §6.4.2.1 Low-level testing          | §5.5 Software unit verification   | Unit test level        |
| `integration` | SWE.5 Software Component Verification and Integration  | §6.4.2.2-3 Integration testing      | §5.6 Software integration testing | Integration test level |
| `system`      | SWE.6 Software Verification, SYS.5 System Verification | (covered within integration/system) | §5.7 Software system testing      | System test level      |
| `acceptance`  | VAL.1 Validation                                       | (covered by ARP4754A)               | (covered by IEC 82304-1)          | Acceptance test level  |

### Level inference from TYPE

When a profile is loaded, `Level` may be **inferred** from the TYPE prefix of
the display ID. The profile declares the mapping. For example, a profile
configured with `SWT → unit`, `SIT → integration`, `SQT → system`,
`VAL → acceptance` allows the tooling to pre-fill `Level` during
`markspec
format` based on the display ID's TYPE prefix.

Inferred `Level` values are committed to the repository and author-overridable
when the inference does not fit. Without a profile loaded, the TYPE prefix is
opaque to the core — the author declares `Level` explicitly if needed.

### Verifies

`Verifies` expresses the upstream link from a test to the spec(s) it verifies.
This is the core ASPICE SWE.4 BP5 traceability link between test and
requirement.

```text
Verifies: SRS_BRK_0107
```

`Verifies` is **repeatable**. A test may verify multiple specs (common for
integration or system tests that cover several requirements).

### Tests

`Tests` expresses the upstream link from a test to the element(s) it exercises.
This is the other half of ASPICE SWE.4 BP5 — the link between test case and
software unit.

```text
Tests: braking_core::controller::debounce_input
```

`Tests` is **repeatable**. A test may exercise multiple elements (common for
integration and system tests). The attribute is optional at the core — profiles
may make it mandatory for specific Levels (e.g., ASPICE imposes `Tests` on
unit-level tests).

Together, `Verifies` and `Tests` close the bidirectional traceability loop
required by SWE.4 BP5:

- **Test ↔ requirement** via `Verifies` (and generated `Verified-by`)
- **Test ↔ unit** via `Tests` (and generated `Tested-by`)

### Source

`Source` is the filesystem path of the source file containing the test (for
automated tests). It is **inferred** by `markspec format` when the test is
extracted from a code file, and committed to the repository.

```text
Source: src/braking/controller.rs
```

For manual tests (e.g., VAL procedures, HIL test scripts that are purely
human-executed), `Source` is omitted.

### Two modes: automated and manual

**Automated test** — declared in code as a `#[test]` function (Rust), `@Test`
method (Java/Kotlin), pytest function (Python), or equivalent. MarkSpec extracts
the test entry from the code, with `Source` inferred from the file path. The
test's behavior is encoded in the function body; the MarkSpec entry captures the
traceability metadata.

**Manual test** — declared as a standalone Markdown entry, typically in a
dedicated document. No code, no `Source`, no inferable attributes.

### Generated attributes

| Attribute       | Lives on | Description                                                           |
| --------------- | -------- | --------------------------------------------------------------------- |
| **Verified-by** | Spec     | Downstream inverse of Test.`Verifies`. Tests that verify this spec.   |
| **Tested-by**   | Element  | Downstream inverse of Test.`Tests`. Tests that exercise this element. |

Tests themselves do not carry generated inverse attributes in the core — a test
is an endpoint in the traceability graph, not an intermediate node. Profiles may
add generated attributes (e.g., `Last-result`, `Coverage-summary`) sourced from
CI test runs.

### Example — automotive unit test (automated, in-code)

Authoring convention using doc comment per ADR-001:

```rust
/// [SWT_BRK_0107] Debounce unit test
///
/// Given a debounce window of 10ms and a stable reading of 500,
/// when a noise spike of 999 occurs for 5ms (shorter than window),
/// the output shall remain at 500.
///
/// Test-id: 01HGW3R9QLP4ABCDEFGHJKMNPQ
/// Level: unit
/// Verifies: SRS_BRK_0107
/// Tests: braking_core::controller::debounce_input
/// Labels: automated, rust, ASIL-B
#[test]
fn swt_brk_0107_debounce_filters_noise() {
    let window = Duration::from_millis(10);
    let output = debounce_input_with_history(&[500, 500, 999], window);
    assert_eq!(output, 500);
}
```

The doc comment declares the Test entry; the function body is the executable
artifact. The test's `Source` is inferred from the file path; other attributes
are authored.

_Note: The TYPE prefix `SWT` is an industrial convention for "Software unit
Test" common in automotive contexts; it is not prescribed by MarkSpec. ASPICE,
DO-178C, IEC 62304, and EN 50128 do not define formal abbreviations for test
types — each profile or project defines its own._

### Example — generic integration test

For projects using a generic profile with neutral TYPE conventions
(UT/IT/ST/AT):

```markdown
- [IT_BRK_0023] Braking subsystem integration test

  Verifies that the sensor filter and brake controller interact correctly across
  the full pressure range.

  Test-id: 01HGW3T3QRST6UVWXYZABCDEF\
  Level: integration\
  Source: tests/integration/braking.rs\
  Verifies: SRS_BRK_0107\
  Verifies: SRS_BRK_0108\
  Tests: braking_core::controller\
  Tests: braking_core::sensor_filter\
  Labels: automated, rust
```

### Example — manual validation test

```markdown
- [VAL_VHC_0042] Emergency braking acceptance test

  Procedure:

  1. Drive vehicle at 80 km/h on a dry asphalt track.
  2. Approach a stationary obstacle positioned 100 m ahead.
  3. Do not brake manually.
  4. Observe AEB system activation.

  Pass criteria:

  - AEB detects obstacle within 100 ms of lateral alignment.
  - Full braking force achieved within 150 ms of detection.
  - Vehicle stops at least 2 m before the obstacle.

  Test-id: 01HGW3U4RSTU7VWXYZABCDEFG\
  Level: acceptance\
  Verifies: STK_BRK_0001\
  Labels: manual, hil, ASIL-D
```

No `Source` (purely manual), no `Tests` (the procedure exercises the entire
vehicle integration, not a specific element).

---

## Part 5 — Element Entries

An element entry is a canonical declaration of a system object with stable
semantic identity: a software component, a code unit, a file, an interface, a
hardware part, a product, a configuration key. Elements are the nouns of the
system — entities with material existence, either produced by the project or
consumed from outside.

### Display ID format

```text
^(::)?[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?(::[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?)*$
```

The display ID is composed of one or more **segments** separated by the
**hierarchy separator** `::`. An optional leading `::` marks the path as
absolute from the element root.

### Character categories

**Hierarchy separator** — `::`

The only separator that marks a level boundary in the element namespace.

**Technical segment characters** — `.` and `/`

Appear inside a segment, carry technical meaning in the external world:

- `.` — file extensions (`controller.rs`), versions (`aspice-4.0`), dereference
  (`Class.method`)
- `/` — filesystem paths (`src/braking/controller.rs`), URL paths

**Semantic segment characters** — `-` and `_`

Readable word connectors inside a segment: `ecu-sensor`, `debounce_input`.

### Segment rules

A segment starts with a letter, ends with an alphanumeric (never with
punctuation), and contains alphanumerics, `.`, `/`, `_`, `-` in the middle.

### Absolute path convention

The leading `::` marks an absolute path from the element root:

```text
::braking::debounce_input
::vehicle::braking::ecu-sensor
```

Semantically, `::braking::debounce_input` is equivalent to
`braking::debounce_input`. The canonical form in the model strips the leading
`::`.

### Identity attribute

Every element entry carries an `Element-id` attribute containing a bare ULID:

```text
Element-id: 01HGW2R9QLP4ABCDEFGHJKMNPQ
```

26 characters in Crockford base32, no TYPE prefix.

**Assignment**: set by `markspec format`, never hand-authored. **Immutability**:
once assigned, never changed. **Uniqueness**: globally unique across the
registry chain.

The `Element-id` provides the stable internal identity that survives display ID
renames, whether the rename originates from within MarkSpec or from an external
system (Codebeamer, DOORS, PLM).

### Core attributes

| Attribute          | Origin                | Description                                                           |
| ------------------ | --------------------- | --------------------------------------------------------------------- |
| **Element-id**     | authored              | ULID, required, assigned by `markspec format`                         |
| **External-id**    | authored              | Optional, repeatable. Identifier in an external system                |
| **Kind**           | authored or inferred  | Optional. Element kind from the core vocabulary or a profile          |
| **Source**         | inferred              | Optional. Filesystem path of the source file (for code units)         |
| **Part-of**        | authored              | Optional. Containment link to a parent element                        |
| **Realizes**       | authored              | Optional, repeatable. Upstream link to spec(s) this element realizes  |
| **Depends-on**     | authored or generated | Optional, repeatable. Upstream link to element(s) this element uses   |
| **Generated-from** | inferred              | Optional, repeatable. Path or element this element was generated from |
| **Labels**         | authored              | Universal core attribute                                              |

Note that Element **no longer carries** `Verifies`, `Tests`, or `Role` — these
attributes moved to the Test family (`Verifies`, `Tests`) or were dropped
(`Role`) as part of the four-family refactor.

**External-id** — identifier in an external system that owns the element's
lifecycle. Serves as the synchronization key. A `scheme:identifier` convention
is recommended:

```text
External-id: codebeamer:project-123:item-45678
External-id: doors:VHC_BRK:BRK-0042
External-id: plm:part:0261-545-109
```

**Source** — the filesystem path to the source file where a unit is defined.
Applies primarily to elements of `Kind: unit`.

```text
Source: src/braking/controller.rs
```

**Part-of** expresses the containment hierarchy at the semantic level. When
absent, the parent is inferred from the display ID namespace.

**Realizes** — upstream link to one or more specs that this element realizes.
Used for production code that fulfills requirements:

```text
Realizes: SRS_BRK_0107
Realizes: SRS_BRK_0108
```

`Realizes` applies to any element kind — not only code units. An
architecture-level element (a component, an artifact) may `Realizes` a spec to
capture top-down allocation at the architectural level, even before detailed
code exists.

**Depends-on** — upstream link to one or more elements that this element uses
(function call, import, library dependency, interface contract). Used for
explicit dependency declaration, particularly for SoUP (Software of Unknown
Provenance).

```text
Depends-on: zlib
Depends-on: braking::sensors::pressure
```

`Depends-on` can be **author-declared** for significant dependencies (especially
SoUP) or **tool-generated** by static analysis extracting call/import graphs.

**Generated-from** — upstream link to the source from which this element was
generated. Important for ISO 26262 Tool Confidence Level analysis.

```text
Generated-from: schemas/can_messages.dbc
Generated-from: schemas::can::dbc
```

### Core kind vocabulary

| Kind           | Description                               | Typical correspondences                                 |
| -------------- | ----------------------------------------- | ------------------------------------------------------- |
| **item**       | Repository or top-level project           | git repo, SVN project root                              |
| **artifact**   | Unit of build produced by the project     | Rust crate, C/C++ executable or library, jar, package   |
| **dependency** | External artifact consumed by the project | zlib, OpenSSL, third-party crates, maven dependencies   |
| **unit**       | Atomic named declaration in source code   | function, method, class, struct, enum, trait, procedure |

The distinction between **`artifact`** and **`dependency`** is structural: an
`artifact` is something the project **produces** from its own source code; a
`dependency` is something the project **consumes** from outside.
`Kind: dependency` is the canonical way to declare SoUP usage.

Profiles may extend the `Kind` vocabulary with domain-specific values
(automotive: `ecu`, `sensor`, `actuator`; aerospace: `lrm`, `csci`; medical:
`software-system`, `software-item`).

**`unit` is uniformly function-level** — the smallest separately executable and
testable entity, per ASPICE definition. This is independent of language
conventions: a Rust `mod tests` is a syntactic grouping, not an ASPICE unit.
Each function is its own testable entity.

### Automatic inference of Kind

When `markspec format` parses source code, it infers `Kind`:

- Doc comment on a function, method, class, struct, enum → `Kind: unit`
- Doc comment on `Cargo.toml`, `pom.xml`, build descriptor → `Kind: artifact`
- Entry in dependencies section → `Kind: dependency`
- Doc comment on repository root README → `Kind: item`

### Generated attributes

| Attribute     | Description                                                                     |
| ------------- | ------------------------------------------------------------------------------- |
| **Contains**  | Downstream inverse of `Part-of`. Children of this element.                      |
| **Used-by**   | Downstream inverse of `Depends-on`. Elements that use this one.                 |
| **Allocated** | Downstream inverse of `Allocated-to` on specs. Specs allocated to this element. |
| **Tested-by** | Downstream inverse of `Tests` on tests. Tests that exercise this element.       |

### Examples

**Item** — repository root:

```markdown
- [github.com/driftsys/braking] DriftSys braking system

  Main repository for the DriftSys open-source braking system.

  Element-id: 01HGW3A0MNPQ4FGHIJKLMNOPQR\
  Kind: item\
  Labels: automotive, open-source
```

**Artifact** — a Rust crate:

```markdown
- [braking-core] Braking core crate

  Core logic for brake pressure calculation and sensor filtering.

  Element-id: 01HGW3B2NPQR5GHIJKLMNOPQRST\
  Kind: artifact\
  Part-of: github.com/driftsys/braking\
  Labels: rust, ASIL-B
```

**Unit** — a production function:

```markdown
- [braking_core::controller::debounce_input] Debounce function

  Rejects transient noise on raw sensor readings using a configurable window.

  Element-id: 01HGW3D6QRST7IJKLMNOPQRSTUV\
  Kind: unit\
  Source: src/braking/controller.rs\
  Part-of: braking-core\
  Realizes: SRS_BRK_0107\
  Labels: rust, ASIL-B
```

The `Realizes: SRS_BRK_0107` declares this unit as the realization of that
requirement. Tests of this unit are declared as Test entries (Part 4) with
`Tests: braking_core::controller::debounce_input`.

**Generated unit** — code produced by a build step:

```markdown
- [braking_core::bindings::can_frames] CAN frame bindings

  Auto-generated Rust bindings for CAN message layouts.

  Element-id: 01HGW3G2UVWX9JKLMNOPQRSTUV\
  Kind: unit\
  Source: target/generated/bindings.rs\
  Part-of: braking-core\
  Generated-from: schemas/can_messages.dbc\
  Labels: rust
```

**Dependency** — SoUP third-party library:

```markdown
- [zlib] zlib compression library

  Third-party compression library. SoUP — not qualified to ASIL standards. Used
  in non-safety-critical paths only.

  Element-id: 01HGW3M0NPQR5GHIJKLMNOPQRS\
  Kind: dependency\
  External-id: pkg:generic/zlib@1.2.13\
  Labels: soup, third-party
```

**Hardware element** — declared manually:

```markdown
- [BRK-ECU-SENSOR] Brake ECU pressure sensor

  Front brake pressure sensor connected via CAN to the ECU.

  Element-id: 01HGW2R9QLP4ABCDEFGHJKMNPQ\
  Labels: hardware, automotive
```

Hardware elements typically do not carry a core `Kind` (the core kinds describe
code). A profile may add hardware kinds (`ecu`, `sensor`, `actuator`).

---

## Part 6 — Family Recognition

The family of an entry is determined by the **identity attribute** it carries in
its trailers. An entry has exactly one of `Spec-id`, `Test-id`, `Element-id`, or
`Reference-id`.

### Validation rule

```text
if entry has Spec-id      → spec
if entry has Test-id      → test
if entry has Element-id   → element
if entry has Reference-id → reference
```

Properties:

- **Disjoint**: the four attributes are mutually exclusive. An entry carrying
  two is invalid.
- **Complete**: every entry must carry exactly one identity attribute. An entry
  without any is invalid.
- **Independent of display ID format**: family is decided by attribute name, not
  regex matching.
- **Independent of document context**: family is intrinsic to the entry, not
  dependent on which document it appears in.

### Classification rule for new entries

When an author writes a new entry without yet specifying an identity attribute,
`markspec format` uses a classification heuristic:

1. **If the display ID matches the element format** (contains `::` or `/`) —
   assign `Element-id` and generate a new ULID.
2. **Otherwise, if the display ID matches the spec/test format**
   (TYPE_DOMAIN_NNNN) — consult the document directive (see Part 7) and the
   loaded profile:
   - If the profile maps the TYPE to a test → assign `Test-id`.
   - Otherwise → assign `Spec-id`.
3. **Otherwise, use the document directive**:
   - `markspec:references` or filename `references.md` — assign `Reference-id`
     and prompt for the URI value.
   - `markspec:tests` or filename `tests.md` — assign `Test-id`.
   - `markspec:elements` or filename `elements.md` — assign `Element-id`.
   - Otherwise — the display ID is ambiguous; flag as an error.

This heuristic is used only for **initial classification**. Once the identity
attribute is assigned, the family is fixed by the attribute.

### Post-assignment consistency

After the identity attribute is assigned, the linter verifies:

- The display ID matches the format of the assigned family.
- No other identity attribute is present.
- The entry satisfies its family's required attributes.

---

## Part 7 — Document Type Directives

Document directives are **optional hints** used by `markspec format` to classify
new entries that do not yet have an identity attribute, and by the linter to
warn about organizational conventions.

### Directives

- `<!-- markspec:specs -->` — suggests specs (explicit, same as unmarked)
- `<!-- markspec:tests -->` — suggests tests
- `<!-- markspec:elements -->` — suggests elements
- `<!-- markspec:references -->` — suggests references

### Filename conventions

Filenames also act as directives:

- `tests.md` at any path → equivalent to `markspec:tests`
- `elements.md` at any path → equivalent to `markspec:elements`
- `references.md` at any path → equivalent to `markspec:references`
- Any other filename → equivalent to `markspec:specs`

An explicit directive overrides the filename convention.

### Linter warnings

The linter may emit style warnings when entries of a family appear in a document
whose directive suggests a different family. These are style warnings, not
errors — the family of an entry is decided by its identity attribute, not by the
document it lives in.

### Recommended style

Single-family documents are the recommended style. Group references in dedicated
reference documents, tests in dedicated test documents (or in source code as doc
comments), elements in dedicated element documents, specs everywhere else.

---

## Consequences

### Core stays minimal, families stay focused

Promoting Test to its own family simplifies each family:

- **Spec** is purely declarative — requirements, architecture, decisions,
  hazards, analyses. No `Verifies`, no `Tests`.
- **Test** carries its own dedicated attributes — `Level`, `Verifies`, `Tests`,
  `Source`. No confusion with declarative specs.
- **Element** is purely material — code, hardware, dependencies. No `Verifies`,
  no `Tests`, no `Role`.
- **Reference** unchanged.

Each family has a cohesive set of attributes rather than shared attributes that
only apply in some cases.

### Profiles add domain vocabulary

A profile defines:

- Allowed TYPE prefixes for specs and tests
- Mapping from test TYPEs to core `Level`
- Direction and validity rules for `Derived-from` and `Satisfies`
- Additional attributes — domain-specific traceability links or metadata
- Additional labels with semantic meaning
- Extension of `Kind` vocabularies (Element, and optionally Level for Test)

The same MarkSpec core supports automotive, aerospace, medical, railway, and
industrial projects without modification.

### Assisted editing is straightforward

- Generating an identity attribute is trivial: a bare ULID from any standard
  library.
- Classifying an existing entry is a single attribute lookup.
- Classifying a new entry uses the heuristic, with profile mapping and document
  directive as hints.
- Level inference from TYPE prefix reduces authoring overhead when a profile is
  loaded.

### ASPICE SWE.4 BP5 traceability is covered

The bidirectional traceability between test cases, requirements, and units —
required by ASPICE SWE.4 BP5 — is fully expressible:

- **Test ↔ requirement** via Test.`Verifies` and Spec.`Verified-by`
- **Test ↔ unit** via Test.`Tests` and Element.`Tested-by`

### Pandoc compatibility preserved

The `@` prefix in reference declarations is accepted as optional syntax. Inline
Pandoc citations `[@ID]` in prose are recognized as references.

### Migration from ADR-001

Projects using ADR-001 format can migrate gradually:

- `Id: <prefixed ULID>` becomes family-specific: `Spec-id`, `Test-id`,
  `Element-id` depending on content.
- ADR-001 test entries (SWT, SIT, VAL) declared as requirements move to the Test
  family with `Test-id` instead of `Spec-id`.
- `Verifies` attributes declared on code (per ADR-001) move to the Test entries
  generated from that code.

An automated migration tool can rewrite legacy attributes.

---

## Annex A — Family Recognition Examples

| Entry                                                    | Identity attribute | Family                   |
| -------------------------------------------------------- | ------------------ | ------------------------ |
| `[SRS_BRK_0107]` with `Spec-id: 01HGW2...`               | Spec-id            | spec                     |
| `[SWT_BRK_0107]` with `Test-id: 01HGW3...`               | Test-id            | test                     |
| `[VAL_VHC_0042]` with `Test-id: 01HGW3...`               | Test-id            | test                     |
| `[ISO-26262-6]` with `Reference-id: urn:iso:...`         | Reference-id       | reference                |
| `[@ISO-26262-6]` with `Reference-id: urn:iso:...`        | Reference-id       | reference (`@` stripped) |
| `[BRK-ECU-SENSOR]` with `Element-id: 01HGW2...`          | Element-id         | element                  |
| `[braking::debounce_input]` with `Element-id: 01HGW2...` | Element-id         | element                  |

**Invalid entries**:

| Entry                                       | Issue                        |
| ------------------------------------------- | ---------------------------- |
| `[SRS_BRK_0107]` with no identity attribute | Missing identity             |
| `[SRS_BRK_0107]` with `Element-id: ...`     | Format/family mismatch       |
| `[X]` with both `Spec-id` and `Test-id`     | Multiple identity attributes |

---

## Annex B — Format Regexes

**Spec display ID**:

```text
^[A-Z]{2,6}_[A-Z][A-Z0-9]{2,7}(_[A-Z][A-Z0-9]{2,7})?_\d{3,6}$
```

**Test display ID**: same format as Spec.

**Reference slug** (after stripping optional `@` prefix):

```text
^[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?$
```

**Element display ID** (after stripping optional leading `::`):

```text
^[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?(::[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?)*$
```

**ULID** (value of `Spec-id`, `Test-id`, `Element-id`):

```text
^[0-9A-HJKMNP-TV-Z]{26}$
```

**URI** (value of `Reference-id`): any valid URI per RFC 3986.

---

## Open questions (deferred to later ADRs)

- **Profile document format**: how profiles are authored and distributed.
- **Profile-level traceability rules**: validation of `Derived-from`,
  `Allocated-to`, `Verifies`, `Tests` (cardinality, type combinations, ASIL
  compatibility).
- **In-code entries**: conventions for authoring spec, test, and element entries
  in doc comments across languages (Rust `///`, Kotlin KDoc, Doxygen, Javadoc,
  Java JDK 23+).
- **Inline references in prose**: Mustache `{{ref.X}}`, `{{element.X}}`,
  `{{test.X}}` syntax, alongside Pandoc `[@ID]` citation syntax.
- **Test execution attributes**: profile-specific attributes for test results,
  coverage metrics, execution environment.
- **Element lifecycle beyond renames**: merge and split operations from external
  systems.
- **Tool qualification modeling**: ISO 26262 Part 8 TCL attributes for elements
  of `Kind: dependency` used as development tools.
