# MarkSpec — Core Data Model

Status: Draft (Prompt 1 of the next-gen refactor)\
Date: 2026-05-13\
Scope: MarkSpec core (the part every project gets, regardless of profile)\
Builds on: ADR-001 (Markdown format), ADR-002 (entry model — trailers,
value-type catalogue, retirement, document directives), ADR-003 (information &
traceability model), ADR-004 (authoring model), ADR-005 (entry content model)

This spec is the build target for the Prompt-1 implementation PR. It freezes the
**canonical data model** every MarkSpec project must accept, the **AST** the
parser produces, the **canonical form** `markspec fmt` writes, and the
**validation rules** `markspec lint` reports. It does not specify profiles
(Prompt 2), the toolchain wiring (Prompt 3), or end-user documentation (Prompt
4).

Where the ADRs disagree on framing, ADR-003 is authoritative for the information
layer (built-in 15-type taxonomy) and ADR-004 is authoritative for the authoring
layer (Entry / Reference shapes, `Id:` discrimination, `Type:` attribute,
promoted Reference attributes). The two are orthogonal by design.

---

## 0. Terminology

This spec is precise about a small set of overloaded terms.

| Term          | Meaning in this spec                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **entry**     | _(lowercase)_ Any Markdown list-item block of the form `- [DISPLAY_ID] Title …`. Shape-agnostic surface concept. Includes both Authored and Reference.                                                                               |
| **Entry**     | _(TitleCase)_ ADR-003 abstract base in the authoring model. Parent of `Authored` and `Reference`.                                                                                                                                    |
| **Authored**  | ADR-003 shape: an entry whose `Id:` is a ULID. Owned and lifecycled by the project. Synonym used by ADR-004 / published spec: **Entry shape**.                                                                                       |
| **Reference** | ADR-003 shape: an entry whose `Id:` is a scheme-qualified URI. Cites an artifact external to the project.                                                                                                                            |
| **Item**      | ADR-003 information-graph node. Every entry produces exactly one Item.                                                                                                                                                               |
| **shape**     | ADR-004 §Part 1. The authoring-layer classification (`Authored` vs `Reference`), decided by the `Id:` value format alone.                                                                                                            |
| **type**      | ADR-003 §Part 1 / ADR-004 §Part 2. The information-layer classification. One of the 15 built-in concrete types, the 4 abstract parents (Specification / Component / Unit / Item), or a profile-declared subtype. Carried by `Type:`. |
| **attribute** | A `Key: Value` pair in the trailers block (declared facts).                                                                                                                                                                          |
| **property**  | A model-level observation captured by tooling (observed facts — file path, git timestamps, sync state). Never authored. Out of scope for this spec, deferred to ADR-006.                                                             |
| **trailers**  | The final indented code block of an entry, containing `Key: Value` lines. Established by ADR-002 §Part 1; reformatting rules in §3 below.                                                                                            |

> **Naming overlap notice.** ADR-004 §Part 1 uses "Entry" as the name of the
> ULID-identified _shape_. ADR-003 §Part 1 reserves "Entry" for the _abstract
> base_ and names the ULID shape "Authored". This spec follows ADR-003's
> terminology when the distinction matters (Authored vs Reference) and treats
> the lowercase word "entry" as shape-neutral. Tooling diagnostics in §4 use the
> ADR-003 spelling. ADR-004 examples that say "Entry-authored" remain valid as
> ordinary English ("the entry was authored, not cited").

---

## 1. Canonical Data Model

### 1.1 Two orthogonal layers

Every entry is classified along two independent axes (ADR-004 §Part 1):

```
                       Information layer (Type)
                          (ADR-003 §Part 1)
                ┌───────────────┬───────────────┬───────────────┐
                │ Specification │   Component   │     Unit      │  Item (fallback)
                │  + subtypes   │  + subtypes   │  + subtypes   │
Authoring layer ├───────────────┼───────────────┼───────────────┤
   (Shape)      │       ✓       │       ✓       │       ✓       │
   ADR-004 §1   │               │               │               │
  ┌──────────┐  │               │               │               │
  │ Authored │  │  requirement  │ braking-core  │  debounce_fn  │
  │  (ULID)  │  │   test, ADR   │   subsystem   │ struct, class │
  ├──────────┤  ├───────────────┼───────────────┼───────────────┤
  │Reference │  │   ISO-26262   │  pkg:cargo/   │  exported fn  │
  │   (URI)  │  │   RFC-2119    │     serde     │ in vendor SDK │
  └──────────┘  └───────────────┴───────────────┴───────────────┘
```

The two axes are independent: the same information type can be authored or
cited, with identical semantics. Reference-cited content is not a second-class
trace target.

### 1.2 Shape discrimination

Shape is decided by the value format of the universal `Id:` attribute. Every
entry carries exactly one `Id:`. The rule (ADR-002 §Part 4, ADR-004 §Part 1,
ADR-003 §Part 1):

```
if Id matches ULID regex (^[0-9A-HJKMNP-TV-Z]{26}$)   → Authored
if Id matches URI grammar (RFC 3986, scheme required) → Reference
otherwise                                              → MSL-I001 (invalid Id)
```

Properties of the rule:

| Property                      | Statement                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| **Disjoint**                  | A ULID has no scheme; a URI requires one. No value matches both grammars.              |
| **Complete**                  | Every well-formed `Id:` value is exactly one of ULID or URI.                           |
| **Independent of display ID** | The bracketed `[DISPLAY_ID]` does not influence shape.                                 |
| **Independent of context**    | Shape is intrinsic to the entry, not derived from the document, profile, or directive. |
| **Profile-independent**       | Shape resolution completes without loading any profile (core-only mode).               |

**Options analysis — discrimination strategy.**

| Alternative                                                                                                                               | Rejected because                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Family-specific identity attributes (`Spec-id` / `Test-id` / `Element-id` / `Reference-id`, as in ADR-002 drafts before the supersession) | Required four parallel attributes to do the work of one, and tied the surface schema to a fixed family vocabulary. ADR-004 §Annex A and ADR-003 §Part 9 retire it.                                                  |
| Explicit `Shape: authored` / `Shape: reference` attribute                                                                                 | Adds a second required attribute and lets the author contradict the `Id:` value, which then needs a tie-breaker. The `Id:` value already determines shape unambiguously.                                            |
| Discrimination from display-ID format (slug vs prefix)                                                                                    | Display IDs are profile-decorated and project-renumberable. Tying shape to a presentational alias couples the parser to profile state. ADR-002 §Part 4 makes shape "independent of display ID" on the same grounds. |

### 1.3 `Type:` attribute and the type-resolution chain

The information type is expressed by a single `Type:` attribute (ADR-004 §Part
2). The vocabulary has two levels:

- **Core abstract types** — `Item`, `Specification`, `Component`, `Unit`.
  TitleCase. Always available regardless of profile.
- **Core concrete types** — the 15 built-in subtypes (ADR-003 §Part 1):
  - Under `Specification`: `Requirement`, `Test`, `Contract`, `Record`, `Risk`
  - Under `Component`: `SoftwareComponent`, `HardwareComponent`
  - Under `Contract`: `SoftwareInterface`, `HardwareInterface`
  - Under `Unit`: `SoftwareUnit`, `HardwareUnit`
  - Standalone under `Item`: `Definition`
- **Profile-declared concrete types** — extend any core type by inheritance.
  Convention: lowercase-with-hyphens (e.g., `requirement` extending
  `Requirement`, `dependency` extending `SoftwareComponent`, `hazard` extending
  `Risk`). Defined by Prompt 2.

> **Reconciliation note.** ADR-004 §Part 2 frames the core as carrying _only_
> three abstract types, with concrete types declared by profiles. ADR-003 §Part
> 1 supersedes that framing: the 15 concrete types are part of the core
> taxonomy, with the abstract parents serving dual roles as direct-instantiation
> fallbacks and as roots for profile-declared subtypes. This spec follows
> ADR-003 §Part 1 (the later refinement). The abstract types remain instantiable
> for the cases ADR-004 §Part 2 anticipated (no concrete subtype fits, or no
> profile loaded).

#### 1.3.1 Resolution chain

`Type:` is **optional**. When absent, tooling resolves the type through a
permissive chain. The chain composes ADR-004 §Part 2 (steps 1–3) with ADR-003
§Part 5 (steps 4–8); the joined sequence below is authoritative. **First match
wins**, and the chain never errors — it ends at `Item` if every other step is
silent.

```
1. Explicit `Type:` attribute                           → stop
2. Profile-declared display-id-pattern matches          → stop  (profile concrete type)
3. `Source:` introspection                              → stop  (e.g., Cargo.toml → SoftwareComponent)
4. Display-ID prefix (Authored shape, ULID Id)          → stop  (REQ→Requirement, TST→Test, …)
5. URI scheme map (Reference shape, URI Id)             → stop  (pkg:cargo → SoftwareComponent, urn:iso → Requirement, …)
6. Discriminating attribute presence                    → stop  (Verifies→Test, Schema-language→Contract, …)
7. Document directive (`<!-- markspec:requirements -->`)→ stop
8. Display-ID shape:
     contains `::` or `/`                               → Unit
     bare lowercased slug                               → Component
   else fallback:
     Authored entry → Specification
     Reference entry → Item (the abstract fallback)
```

Steps 4 and 5 are mutually exclusive (each applies only to its own shape) and
are jointly equivalent to ADR-004 §Part 2 step 3 (“`Id:` value structure”). Step
6 covers the discriminating-attribute table in ADR-003 §Part 5 item 5.

The full URI scheme map for step 5 is in ADR-003 §Part 6 and is normative for
the core.

#### 1.3.2 Type-inference lint

Once a type is established (explicit or inferred), tooling reports:

- `MSL-T020` — `error` — `Type:` value is not a known abstract type, core
  concrete type, or active-profile concrete type. (ADR-004 §Annex A.)
- `MSL-T021` — `warning` — type resolved via late-stage inference (step ≥ 5).
  Suggests adding an explicit `Type:`. (ADR-004 §Annex A.)
- `MSL-T022` — `warning` — attribute presence inconsistent with resolved type
  (e.g., `Bus-protocol` on a `SoftwareComponent`). Profiles may promote to
  error. (ADR-003 §Part 5 “Validity check”.)

**Options analysis — `Type:` attribute design.**

| Alternative                                                           | Rejected because                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two attributes (Codebeamer-style `Stereotype` + `typeName`)           | Doubles the surface and pushes one classification across two fields. ADR-004 §Part 2 "Alignment" notes that ReqIF / DOORS / Polarion all carry a single typed reference, and a two-level vocabulary on one attribute reproduces the same semantics. |
| `Kind:` + `Role:` (ADR-002 Element vocabulary)                        | Two enums interact and let authors produce contradictory pairs (`Kind: artifact` + `Role: test`). ADR-004 §Annex A retires both in favour of one `Type:`.                                                                                           |
| Hardcoded automotive vocabulary in core (STK / SYS / SRS / SAD / SIT) | Locks the format to one domain and breaks ASPICE, IEC 62304, DO-178C, and pure tech-writing alike. ADR-002 supersession and ADR-003 §Part 8 document the swap.                                                                                      |

### 1.4 Universal attributes (apply to every entry)

The core defines a short universal attribute set (ADR-003 §Part 2 “Entry”;
ADR-002 §Part 1 §Universal attributes; ADR-004 §Part 3):

| Attribute       | Type          | Required      | Origin              | Description                                                                             |
| --------------- | ------------- | ------------- | ------------------- | --------------------------------------------------------------------------------------- |
| `Id`            | `id`          | yes           | assigned ‖ authored | ULID for Authored (assigned by `fmt` at creation), URI for Reference (author-provided). |
| `Title`         | _structural_  | yes           | authored            | First-line text after `[DISPLAY_ID]` in the title line; not a trailer key.              |
| `Source`        | `path‖uri`    | no            | authored            | SSoT pointer outside MarkSpec's authoring layer. Drives type inference step 3.          |
| `Origin`        | `enum`        | no            | authored            | `authored` (default) or `synthesized`.                                                  |
| `Type`          | `enum`        | no (inferred) | authored ‖ inferred | Information type (§1.3).                                                                |
| `Labels`        | `tag-list`    | no            | authored            | Free-form classification. `DRAFT` is a well-known value (ADR-002 §Draft state).         |
| `References`    | `citation`    | no            | authored            | Bibliographic citations to Reference entries, with optional free-text locator.          |
| `External-id`   | `external-id` | no            | authored            | Cross-system identifier(s) (PLM, DOORS, Codebeamer, Polarion).                          |
| `Supersedes`    | `id`          | no            | authored            | Same-shape entry this one replaces (ADR-002 §Retirement).                               |
| `Superseded-by` | `id`          | _(generated)_ | generated           | Inverse of `Supersedes`. Never committed.                                               |
| `Deprecated`    | `string`      | no            | authored            | Retirement reason when no successor exists.                                             |

`Title` is recorded as a model-level field but is **not** written as a trailer
key — it is the text on the title line. The trailers carry the other items.

Retirement semantics, draft state, and link-resolution severity are unchanged
from ADR-002 §Retirement and apply to every shape and every type.

### 1.5 Reference-shape core attributes (promoted from RefHub)

Two attributes previously declared by the RefHub profile are core for the
Reference shape (ADR-004 §Part 3):

| Attribute            | Type   | Required | Description                                                            |
| -------------------- | ------ | -------- | ---------------------------------------------------------------------- |
| `Reference-url`      | `url`  | no       | HTTPS navigation link, when distinct from the canonical `Id:` URN/DOI. |
| `Reference-document` | `text` | no       | Canonical citation string (e.g., `ISO 26262-6:2018`).                  |

Both apply to every Reference entry regardless of resolved information type.
`License` stays profile-declared because it narrows to the `dependency` subtype
(ADR-004 §Part 3 “Stays profile-declared”).

### 1.6 Per-abstract-type and per-concrete-type attributes

The information layer adds attributes per abstract / concrete type. The full
catalogue is ADR-003 §Part 2; this section is a normative cross-reference so the
parser knows which attribute keys are core-defined vs profile-declared.

| Type                | Core-defined attributes (in addition to universal)                    | ADR-003 anchor              |
| ------------------- | --------------------------------------------------------------------- | --------------------------- |
| `Item`              | `type`, `Content`                                                     | §Part 2 “Item”              |
| `Specification`     | `Derived-from`, `Satisfies`, `Allocated-to`                           | §Part 2 “Specification`     |
| `Requirement`       | _(inherits Specification)_                                            | §Part 2 “Requirement"       |
| `Test`              | `Verifies`, `Tests`, `Derived-from` _(narrowed to Test)_              | §Part 2 “Test"              |
| `Contract`          | `Schema-language`                                                     | §Part 2 “Contract"          |
| `Record`            | `Caused-by`, `Affects`                                                | §Part 2 “Record"            |
| `Risk`              | `Caused-by`, `Mitigated-by`                                           | §Part 2 “Risk"              |
| `Component`         | `Kind`, `Part-of`, `Realizes`, `Depends-on`, `Provides`, `Requires`   | §Part 2 “Component"         |
| `SoftwareComponent` | `License`, `Build-manifest`, `Package-manager`                        | §Part 2 “SoftwareComponent" |
| `HardwareComponent` | `Manufacturer`, `Part-number`, `Datasheet`                            | §Part 2 “HardwareComponent" |
| `SoftwareInterface` | _(inherits Contract → Specification; no additions in core)_           | §Part 2 “SoftwareInterface” |
| `HardwareInterface` | `Bus-protocol`, `Connector-type`, `Voltage-level`, `Signal-direction` | §Part 2 “HardwareInterface” |
| `Unit`              | `Part-of`, `Realizes`, `Depends-on`                                   | §Part 2 “Unit"              |
| `SoftwareUnit`      | `Source`, `Symbol`, `Language`                                        | §Part 2 “SoftwareUnit"      |
| `HardwareUnit`      | `Manufacturer`, `Part-number`, `Datasheet`, `Footprint`, `Value`      | §Part 2 “HardwareUnit"      |
| `Definition`        | `Aliases`, `See-also`                                                 | §Part 2 “Definition"        |

Cardinality, direction (upstream / downstream / metadata), and target-type
restrictions follow ADR-003 §Part 2 verbatim and are not duplicated here.

Generated inverses are listed in ADR-003 §Part 3. They are populated by the
compiler (Prompt 3 / Prompt 7), not by `fmt`. They never appear in source files
and never round-trip through the formatter — committing a generated key is an
error (`MSL-A030`).

### 1.7 Display-ID rules

| Shape     | Display ID pattern (core)                                                                      | ADR anchor                                                          |
| --------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Authored  | Free-form non-empty string. Profile may tighten via `display-id-pattern`.                      | ADR-002 §Part 2 “Display ID”, ADR-003 §Part 1 “Display-ID prefixes” |
| Reference | Slug — `^[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?$`, optional `@` prefix (Pandoc compatibility). | ADR-002 §Part 3 “Slug”, ADR-002 §Annex B                            |

Display IDs are renumberable by tooling; cross-references resolve against the
ULID (Authored) or URI (Reference), not the bracketed alias (ADR-002 §Part 2).

The five core display-ID prefixes for type inference step 4 are **`REQ` / `TST`
/ `ICD` / `REC` / `RSK`** (ADR-003 §Part 1). They are not the only valid
prefixes — profiles introduce more — but they are reserved at the core level and
inferred unconditionally.

### 1.8 Attribute value types

ADR-002 §Part 1 “Attribute value types” is the normative catalogue. The core
recognizes:

```
id · id-list · uri · url · path · path-or-id · enum · tag-list · text ·
citation · external-id · integer · date · boolean
```

Repeatable types (`id-list`, `tag-list`, `external-id`) accept multi-line and
CSV-on-one-line input. `citation` rejects CSV because locators may contain
commas (ADR-002 §Part 1 “CSV restriction”).

The formatter (§3) always rewrites repeatable values to **multi-line** form.

---

## 2. AST Node Specification

This section defines the syntax the parser must accept and the abstract syntax
tree (AST) it must produce. Three structural zones (ADR-005 §Decision):

```
Entry = TitleLine + Body + Trailers
```

### 2.1 Top-level entry shape

```
- [<DISPLAY_ID>] <Title>

  <Body block 1>

  <Body block 2>

      <Key>: <Value>
      <Key>: <Value>
```

Properties:

- A CommonMark list item (`-`, `*`, or `+`; canonical `-` per §3).
- The first inline content is `[<DISPLAY_ID>]`, optionally `[@<DISPLAY_ID>]` for
  the Reference shape (Pandoc compatibility, ADR-002 §Part 3).
- A non-empty `<Title>` continues on the same line, separated by one ASCII
  space.
- A blank line separates the title from the body.
- The body is one or more body blocks (§2.4).
- The trailers block is the **final indented code block** of the entry, with
  each line matching `^[A-Za-z][A-Za-z0-9-]*:[ \t].*$`.

The full grammar is given in §2.7 (Annex A — production rules) — informally
above, EBNF below.

### 2.2 Title line node

```ts
TitleLine {
  bullet: "-" | "*" | "+"            // canonical "-"
  displayId: string                  // text inside [ … ]
  citationSyntax: bool               // true if the source wrote "[@ID]"
  title: string                      // text after "]" up to end-of-line
  range: SourceRange
}
```

- `displayId` is recorded **without** any leading `@`. `citationSyntax` records
  whether the surface wrote `@`. Reformatting drops the `@` on title lines
  (ADR-002 §Part 3 “Pandoc compatibility”) and is normalized in §3.
- `title` must be non-empty after trimming trailing whitespace. Empty titles
  raise `MSL-P010`.

### 2.3 Trailers node

The trailers block is an indented code block (CommonMark §4.4) whose lines are
each parsed as a git trailer (ADR-002 §Part 1 “Syntactic form”). The block
**terminates the entry**; nothing follows it inside the same list item.

```ts
Trailers {
  raw: string                      // verbatim content of the code block (for round-trip)
  attributes: AttributeNode[]      // parsed pairs in source order
  range: SourceRange
}

AttributeNode {
  key: string                      // canonical case per §2.3.1
  rawKey: string                   // exact spelling in source
  value: string                    // trimmed of trailing whitespace
  valueType: ValueType             // resolved via §1.8 catalogue
  continuation: string[]           // joined continuation lines, if any
  range: SourceRange
}
```

#### 2.3.1 Key casing

Attribute keys are **case-insensitive on input** and **TitleCase-Hyphenated on
output** (ADR-002 §Part 1 examples are uniformly TitleCase-Hyphenated): `Id`,
`Type`, `Derived-from`, `Reference-url`, `Bus-protocol`. The formatter rewrites
to canonical form (§3.3.4). Mismatched casing on input is silently normalized;
it is not an error.

#### 2.3.2 Repeatable attributes

A repeatable attribute may appear as multiple trailer lines with the same key
(canonical) **or** as one trailer line with comma-separated values (ADR-002
§Part 1 “Repeatable attributes”). The parser yields a single `AttributeNode`
whose `value` is the list of joined values. The formatter re-emits in multi-line
form (§3.3.3).

`citation` (used by `References:`) rejects CSV input; `MSL-A011`.

#### 2.3.3 Continuation lines

Trailer values may continue on the next line if the continuation is indented two
spaces deeper than the trailer key (RFC 5322 unfolding convention; ADR-002
references the git-trailers rule). Continuations are joined with a single space.

### 2.4 Body block types

The body is a sequence of blocks. The catalogue is **closed**: ten types,
verbatim from ADR-005 §Part 1.

| AST node         | Surface syntax                                                | Notes                                                         |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| `Paragraph`      | CommonMark paragraph                                          | May carry inline markers (§2.5).                              |
| `List`           | CommonMark ordered/unordered list, nestable                   | Items may contain paragraphs / nested lists / inline markers. |
| `Table`          | GFM pipe table                                                | Per ADR-001 §GFM/GLFM shared extensions.                      |
| `Figure`         | `![alt](path)` (image link)                                   | PlantUML/SVG paths flagged for rendering.                     |
| `Code`           | Fenced code block, language-tagged                            | Tag determines syntax highlighting only.                      |
| `Feature`        | Fenced code block with info-string `gherkin`                  | Body is parsed as Gherkin; AST records scenarios/steps.       |
| `Math`           | `$$ … $$` block                                               | Per ADR-001 §GFM/GLFM shared extensions.                      |
| `DefinitionList` | `Term\n: definition` (GLFM)                                   | `Term` may use `$Identifier` (§2.5.2).                        |
| `Note`           | `> [!NOTE]`/`[!TIP]`/`[!IMPORTANT]`/`[!WARNING]`/`[!CAUTION]` | ADR-001 §Admonitions.                                         |
| `Blockquote`     | Plain `>` blockquote                                          | For external citation excerpts.                               |

#### 2.4.1 Excluded constructs

The following CommonMark/GFM constructs are **not allowed** inside an entry body
(ADR-005 §Part 1 “Excluded constructs”):

- Headings (`#`, `##`, …) — `MSL-B040`.
- Horizontal rules (`---`) — `MSL-B041`.
- Task lists (`- [ ]`) — `MSL-B042`.
- Raw HTML other than the `<!-- markspec:* -->` directive comments — `MSL-B043`.

These are parse-time errors against the body production, not against the file:
the surrounding Markdown document may still contain headings, HRs, etc.

### 2.5 Inline markers

Two classes (ADR-005 §Part 2). Recognized only inside Paragraph, List item,
Table cell, Note body, Blockquote, and DefinitionList term/definition. **Not
recognized** inside Code, Feature (Gherkin), or Math blocks — those are verbatim
content.

#### 2.5.1 Modal keywords

Recognized verbatim words. RFC 2119 and EARS (ADR-005 §Part 2 “Modal keywords”):

| Class    | Tokens (case-insensitive input; lowercase canonical)                    |
| -------- | ----------------------------------------------------------------------- |
| RFC 2119 | `shall`, `should`, `may`, `must`, `shall not`, `should not`, `must not` |
| EARS     | `When`, `While`, `Where`, `If…then`, `Unless`, ubiquitous form          |

The AST tags each occurrence with a `ModalMarker` annotation carrying class,
canonical form, and source range. No new syntax — these are already words in the
prose; the model recognizes them.

#### 2.5.2 Entity references — `$Identifier`

Inline `$Identifier` tokens carry semantics (ADR-005 §Part 2 “Entity
references”):

| Convention          | Pattern                     | Resolves to                                    |
| ------------------- | --------------------------- | ---------------------------------------------- |
| **PascalCase**      | `\$[A-Z][A-Za-z0-9]*`       | Type — class, struct, interface, RIDL type     |
| **camelCase**       | `\$[a-z][A-Za-z0-9]*`       | Instance, value, variable, port, signal        |
| **SCREAMING_SNAKE** | `\$[A-Z][A-Z0-9_]*[A-Z0-9]` | Constant — config value, compile-time constant |

The AST node:

```ts
EntityRef {
  ident: string                    // including the leading "$"
  convention: "type" | "instance" | "constant"
  range: SourceRange
}
```

Disambiguation:

- A fully uppercase identifier with no underscore (e.g., `$ASIL`) parses as
  **PascalCase** (one-character segment). To force the constant convention, the
  author must include an underscore (`$ASIL_LEVEL`). The constant pattern
  requires at least one of `[0-9_]` and ends with `[A-Z0-9]`.
- A leading `$$` is the Math fence and is **not** an entity reference.

Resolution chain and rendering rules are normative per ADR-005 §Part 2
“Resolution chain” / “Validation” / “Rendering”.

### 2.6 Captions

Numbered blocks accept an adjacent caption (ADR-005 §Part 3). Syntax mirrors a
trailer line but lives in the **body**, not the trailers block.

```
<block>

Caption-keyword: caption text
```

or

```
Caption-keyword: caption text

<block>
```

The caption must be separated from its block by exactly one blank line and must
be adjacent to a captionable block of the corresponding type.

| Caption keyword | Pairs with | Numbered as      |
| --------------- | ---------- | ---------------- |
| `Figure:`       | `Figure`   | Figure 1, 2, …   |
| `Table:`        | `Table`    | Table 1, 2, …    |
| `Listing:`      | `Code`     | Listing 1, 2, …  |
| `Feature:`      | `Feature`  | Feature 1, 2, …  |
| `Equation:`     | `Math`     | Equation 1, 2, … |
| `List:`         | `List`     | List 1, 2, …     |

The AST node:

```ts
Caption {
  keyword: "Figure" | "Table" | "Listing" | "Feature" | "Equation" | "List"
  text: string
  position: "above" | "below"     // relative to its block
  block: BlockNode                // resolved owner
  range: SourceRange
}
```

Disambiguation from trailers (ADR-005 §Part 4): captions live next to a
captionable block; trailers form the final indented code block of the entry. A
`Figure:` line is a caption iff it is adjacent to a `Figure` block; if it
appears inside the trailers code block, it is an attribute (and rejected as
unknown by the validator unless a profile registers `Figure:` as an attribute
key).

### 2.7 Annex A — Top-level grammar (EBNF, informative)

```
File              = Document
Document          = (BlockOuter | EntryBlock)*
BlockOuter        = <any CommonMark block that is NOT an EntryBlock>

EntryBlock        = ListMarker "[" CitationAt? DisplayId "]" SP+ Title NL
                    BlankLine
                    BodyBlock+
                    BlankLine
                    Trailers

CitationAt        = "@"
DisplayId         = AuthoredDisplayId | ReferenceSlug
AuthoredDisplayId = /[^\]\s]+(\s[^\]]+)*/
ReferenceSlug     = /[A-Za-z]([A-Za-z0-9._\/\-]*[A-Za-z0-9])?/

Title             = /[^\n]+/

BodyBlock         = Paragraph | List | Table | Figure | Code | Feature
                  | Math | DefinitionList | Note | Blockquote
                  | Caption

Trailers          = IndentedCodeBlock        # ≥4-space indent above list-item indent
                                              # each non-blank line is "Key: Value"

ListMarker        = "-" SP
SP                = " "
NL                = "\n"
BlankLine         = NL
```

Caption is recognized after `BodyBlock` parsing is otherwise complete and is
re-attached to its captionable neighbour. The grammar above does not enforce
attachment; §2.6 does.

---

## 3. Canonical Form for `markspec fmt`

`fmt` is a **formatter**, not a linter: it transforms source into canonical
form, deterministically, byte-for-byte reproducible across machines (AGENTS.md
“Formatters over linters-that-format”).

This section specifies the canonical form for every author-visible surface.

### 3.1 Determinism contract

Three statements about `fmt` are part of the contract surface (round-trip
invariants in §5):

1. **Idempotence.** `fmt(fmt(x)) == fmt(x)` for every input `x`.
2. **Total function.** Every well-formed input has exactly one canonical output.
3. **Bytewise reproducibility.** Identical input produces byte-identical output
   on every supported platform and runtime.

If a transformation is described in this section as “normalized” or “rewritten”,
the rule must be deterministic. If two implementations could disagree, the rule
is under-specified and is a defect.

### 3.2 Title-line canonical form

```
- [DISPLAY_ID] Title
```

- Bullet character: `-` (rewritten from `*` or `+`).
- Exactly one ASCII space after the bullet.
- Display ID inside `[…]` with no whitespace inside the brackets.
- For the Reference shape, a leading `@` inside the brackets is **dropped on
  title lines** (`[@ISO-26262-6]` → `[ISO-26262-6]`). The `@` is retained only
  inline in prose citations (`[@ISO-26262-6]` as a reference). ADR-002 §Part 3.
- Exactly one ASCII space between `]` and the title.
- Title trimmed of trailing whitespace; no transformations to the title text.

### 3.3 Trailers canonical form

#### 3.3.1 Block indentation

Trailers are an indented code block per CommonMark §4.4, placed inside the list
item. Since list-item content is indented by 2 spaces (for a `-` marker with one
space), trailer lines start at column 7 (= 2 + 4 + 1 for marker / content-indent
/ code-block-indent). The canonical column for the start of the trailer key is
column 7. Wider indents are accepted on input and re-emitted at column 7.

A single blank line separates the body from the trailers. Multiple blank lines
are collapsed.

#### 3.3.2 Key ordering

Within the trailers block, attributes are emitted in this order. Within each
group, sub-groups are emitted in the order shown; within a sub-group, attributes
appear in their listed order.

```
1. Identity & classification
     Id
     Type
     Source
     Origin
2. Reference-shape navigation
     Reference-document
     Reference-url
3. Trace — upstream (authored relations)
     Part-of
     Derived-from
     Satisfies
     Verifies
     Tests
     Realizes
     Provides
     Requires
     Depends-on
     Caused-by
     Mitigated-by
     Allocated-to
     Affects
4. Type-specific data
     Schema-language
     License
     Build-manifest
     Package-manager
     Manufacturer
     Part-number
     Datasheet
     Bus-protocol
     Connector-type
     Voltage-level
     Signal-direction
     Symbol
     Language
     Footprint
     Value
     Aliases
     See-also
5. Universal trailing
     References
     External-id
     Labels
     Supersedes
     Deprecated
6. Profile-declared attributes (in profile-declaration order)
```

Generated-origin attributes (`Superseded-by`, every inverse from ADR-003
§Part 3) are never emitted by `fmt` and are an error if found in source
(`MSL-A030`).

The ordering follows three rules:

- **Identity first.** A reader scanning the trailer should see what the entry
  _is_ before how it relates.
- **Trace before data.** Trace relations (upstream-pointing) come before
  type-specific attribute payload, so the connection to the rest of the graph is
  immediately visible.
- **Universal trailing.** `Labels`, `Supersedes`, `Deprecated` are the
  housekeeping section and live at the bottom.

#### 3.3.3 Repeatable values

Repeatable attribute values are emitted in **multi-line form**, one trailer line
per value (ADR-002 §Part 1 “Repeatable attributes”):

```
Derived-from: 01HGW2R0NPQR4STVWXYZABCDEF
Derived-from: 01HGW2S1PQRS5TVWXYZABCDEFG
Labels: ASIL-B
Labels: safety
```

Values within a repeatable attribute are emitted in **source order** — `fmt`
never reorders them. Authors may sort manually; the formatter preserves the
sort.

#### 3.3.4 Key casing

Keys are emitted **TitleCase-Hyphenated**: first character uppercase, every
character after a `-` uppercase, all others lowercase. Examples: `Id`,
`Derived-from`, `Reference-url`, `Bus-protocol`.

#### 3.3.5 Whitespace

- One ASCII space between `:` and the value.
- No trailing whitespace on any line.
- Continuation lines (§2.3.3) are re-emitted only if the original input used
  them; `fmt` does not introduce continuations.

#### 3.3.6 Pruning

The formatter does not delete any trailer it does not understand. Unknown
trailer keys are preserved verbatim and placed in the “profile-declared” group
at the bottom of the trailers block in source order. The lint reports `MSL-A020`
(unknown key) but does not let `fmt` remove it.

### 3.4 Body canonical form

#### 3.4.1 Modal keywords

Modal keywords (§2.5.1) are normalized to **lowercase** (ADR-005 §Part 2):

```
The driver SHALL debounce …    →    The driver shall debounce …
```

Mixed-case combining `If…then` is normalized to lowercase `if…then`. The EARS
keywords on a sentence-initial position retain CommonMark's natural
capitalization (the sentence starts with a capital `W`/`I`/`U`); within a
sentence they normalize to lowercase. The rule is mechanical: lowercase unless
the token is the first word of a sentence.

#### 3.4.2 Entity references

`$Identifier` tokens (§2.5.2) are emitted verbatim. `fmt` does not change case;
case is **semantic** (PascalCase / camelCase / SCREAMING_SNAKE) and
distinguishes the resolver target. A case fix is the author's responsibility and
the lint's job (`MSL-M050`, style warning, ADR-005 §Part 2 “Validation”).

#### 3.4.3 Captions

`fmt` preserves author choice of position (above or below the block) — see
ADR-005 §Part 3 “Position”. A blank line separates the caption from its block;
multiple blank lines collapse to one. The caption keyword is TitleCase
(`Figure:`, not `figure:`).

A project may pin a caption position via configuration (ADR-005 §Part 3), in
which case `fmt` rewrites to the pinned side; without a pin, `fmt` preserves
position.

#### 3.4.4 Definition lists

The GLFM definition-list form is canonical (ADR-005 §Part 1). The colon that
introduces the definition is indented to **two spaces** beneath the term:

```
$DEBOUNCE_WINDOW
:   Configurable duration between 1 ms and 100 ms, default 10 ms.
```

(or equivalently `Term : definition` on one line; both forms accepted on input,
the colon-on-next-line variant is canonical for multi-paragraph definitions).

#### 3.4.5 Lists, tables, code, math, notes, blockquotes

These follow `dprint` formatting for the surrounding Markdown (AGENTS.md “Code
style”). `markspec fmt` does **not** override CommonMark formatting for these
blocks — it delegates. The exception is the inline-marker normalization in
§3.4.1 / §3.4.2 which runs inside Paragraph / List / Table-cell / Note /
Blockquote / DefinitionList content.

### 3.5 Id assignment for new Authored entries

When a new Authored entry is written without an `Id:`, `fmt` assigns one
(ADR-002 §Identity “Assignment”, ADR-003 §Part 4 “Synthesized entry behavior”):

- For `Origin: authored` (default): a fresh random ULID.
- For `Origin: synthesized`: a deterministic ULID derived from `Source:` via
  `ULID(timestamp=0, randomness=truncate(SHA-256(canonical(Source)), 80))`
  (ADR-003 §Part 1 “Authored”).

`fmt` never reassigns an existing `Id:`. Renames at the display-ID level do not
touch the ULID. The canonical-form rule is: once `Id:` is present, it is
preserved verbatim.

For new Reference entries without `Id:`, `fmt` does not invent a URI; it emits
`MSL-I002` (Reference entry missing identity, error). The author supplies the
URI.

### 3.6 Options analysis — canonical-form decisions

| Decision                                      | Alternative considered                   | Why rejected                                                                                                                                                                                                                                               |
| --------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trailers as indented code block               | YAML front matter at the top of the file | Front matter is a per-file construct; entries are per-list-item. Putting attributes in front matter would force one entry per file. Indented code blocks renderlike-data on GitHub/GitLab and survive every CommonMark parser. ADR-001 §Document metadata. |
| Trailers as indented code block               | Inline `attr=value` after the title line | Loses git-trailer compatibility (which makes `git interpret-trailers` work directly on entries) and crowds the title. ADR-002 §Part 1 picks git-trailers explicitly.                                                                                       |
| Multi-line canonical for repeatable values    | CSV canonical                            | CSV breaks for `citation` (locators may contain commas) and for any future value type that admits commas. Multi-line is grep-friendly and diff-friendly. ADR-002 §Part 1 “Repeatable attributes”.                                                          |
| Keep source order for repeatable values       | Alphabetical canonical                   | Authors often have intentional ordering (priority of `Derived-from` parents, primary `Provides` interface first). Alphabetizing destroys that signal.                                                                                                      |
| Fixed cross-key ordering in trailers (§3.3.2) | Preserve author order                    | Diff noise when two authors reorder identically-keyed trailers. The fixed order is the single canonical form mandated by the determinism contract (§3.1).                                                                                                  |
| Lowercase modal-keyword canonical             | Uppercase `SHALL`                        | Uppercase RFC 2119 is loud and breaks sentence flow when used inside prose. Tools (lint, rendering) detect the words by lookup, not by case. ADR-005 §Part 2 picks lowercase.                                                                              |
| Case-significant `$Identifier`                | Case-folded identifiers                  | The three case conventions carry semantics (type / instance / constant) — folding would erase the signal. ADR-005 §Part 2 “Entity references”.                                                                                                             |
| Drop leading `@` on title lines               | Keep `@` in both title and inline        | Inline `[@key]` is a Pandoc citation in prose; on the title line it is the **declaration** of the slug. Keeping `@` both places conflates declaration with use. ADR-002 §Part 3 “Pandoc compatibility”.                                                    |
| No deletion of unknown trailers               | Strip unrecognized keys                  | A formatter must be **lossless** for keys it does not own. Stripping would destroy profile-declared attributes when running without the profile loaded.                                                                                                    |

---

## 4. Validation Rules and Error Codes for `markspec lint`

Error codes are namespaced `MSL-<C><nnn>` (Markspec Lint, Category letter,
3-digit ordinal) so each diagnostic carries a stable identifier. The category
letter:

| Letter | Category                                    |
| ------ | ------------------------------------------- |
| `P`    | Parse — surface syntax cannot become an AST |
| `I`    | Identity — `Id:` value or shape resolution  |
| `T`    | Type — `Type:` value or resolution          |
| `A`    | Attribute — trailer key / value rules       |
| `B`    | Body — body-block content rules             |
| `M`    | Marker — inline marker rules                |
| `C`    | Caption — caption placement rules           |
| `R`    | Reference — cross-entry resolution (trace)  |
| `F`    | Format — `fmt --check` diff reports         |

`fmt` uses the same code namespace when in `--check` mode (§5 round-trip
invariants).

### 4.1 Parse errors (P)

| Code       | Severity | Meaning                                                                                                                                                                 |
| ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSL-P001` | error    | List item starts with `[…]` but the bracketed content is empty.                                                                                                         |
| `MSL-P002` | error    | Title line missing title text after `]`.                                                                                                                                |
| `MSL-P003` | error    | Display-ID brackets unterminated (missing `]` before newline).                                                                                                          |
| `MSL-P010` | error    | Title is empty after trimming.                                                                                                                                          |
| `MSL-P020` | error    | Trailers block is not the final indented code block of the entry.                                                                                                       |
| `MSL-P021` | error    | Trailer line does not match `Key: Value` syntax.                                                                                                                        |
| `MSL-P022` | error    | Trailer key contains characters outside `[A-Za-z][A-Za-z0-9-]*`.                                                                                                        |
| `MSL-P030` | error    | Body contains no body block (entry has a title and trailers but no body). For Authored shape: error. For Reference shape: allowed (ADR-002 §Part 3 “Body is optional”). |

### 4.2 Identity & shape (I)

| Code       | Severity | Meaning                                                                                                                                                                              |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MSL-I001` | error    | `Id:` value is neither a ULID (`^[0-9A-HJKMNP-TV-Z]{26}$`) nor an RFC 3986 URI.                                                                                                      |
| `MSL-I002` | error    | Reference-shape entry without `Id:`. `fmt` cannot mint URIs (ADR-002 §Identity).                                                                                                     |
| `MSL-I003` | error    | Authored-shape entry without `Id:` and `fmt` did not run (would have minted one).                                                                                                    |
| `MSL-I004` | error    | Multiple `Id:` trailers on the same entry.                                                                                                                                           |
| `MSL-I005` | error    | Display ID is empty.                                                                                                                                                                 |
| `MSL-I006` | error    | Reference-shape display ID does not match the slug pattern in §1.7.                                                                                                                  |
| `MSL-I007` | error    | Duplicate `Id:` value across the project (same ULID or same URI on two entries).                                                                                                     |
| `MSL-I008` | warning  | Duplicate display ID within the same shape. Cross-references resolve by `Id:` (ADR-002), so this is style-only — distinct entries should still have distinct human-readable aliases. |

### 4.3 Type (T)

| Code       | Severity | Meaning                                                                                                                                                             |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSL-T020` | error    | `Type:` value resolves to neither a core abstract / concrete type nor an active-profile type. (ADR-004 §Annex A.)                                                   |
| `MSL-T021` | warning  | Type resolved by late-stage inference (chain step ≥ 5). Suggests writing an explicit `Type:`. (ADR-004 §Annex A.)                                                   |
| `MSL-T022` | warning  | Attribute presence inconsistent with resolved type (e.g., `Bus-protocol` on `SoftwareComponent`). Profile may promote to error. (ADR-003 §Part 5 “Validity check”.) |
| `MSL-T023` | error    | `Type:` value is profile-only but no profile is loaded. (ADR-009 “core-only mode”.)                                                                                 |

### 4.4 Attributes (A)

| Code       | Severity | Meaning                                                                                                                                                          |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSL-A010` | error    | Repeatable attribute used CSV form but a value contains a comma (e.g., `citation` locator).                                                                      |
| `MSL-A011` | error    | `citation`-typed attribute (`References:`) used CSV form. Always rejected per §2.3.2.                                                                            |
| `MSL-A012` | error    | Repeatable attribute value list is empty.                                                                                                                        |
| `MSL-A013` | error    | Single-cardinality attribute appears more than once.                                                                                                             |
| `MSL-A020` | warning  | Trailer key is not a core attribute and is not declared by the active profile. Preserved by `fmt`.                                                               |
| `MSL-A030` | error    | Generated-origin attribute present in source (`Superseded-by`, `Derives`, every inverse from ADR-003 §Part 3).                                                   |
| `MSL-A040` | error    | `Id:`, `Type:`, or any core-defined key has been redefined / shadowed by a profile. (ADR-009 §6 reserves `Id:`; this spec also reserves the 15-type vocabulary.) |
| `MSL-A050` | error    | Value does not parse against the declared value type (§1.8) — e.g., a `date` field whose value is not ISO-8601.                                                  |

### 4.5 Body (B)

| Code       | Severity | Meaning                                                                                                                                                     |
| ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSL-B040` | error    | Heading inside entry body.                                                                                                                                  |
| `MSL-B041` | error    | Horizontal rule inside entry body.                                                                                                                          |
| `MSL-B042` | error    | Task list inside entry body.                                                                                                                                |
| `MSL-B043` | error    | Raw HTML inside entry body (other than `<!-- markspec:* -->`).                                                                                              |
| `MSL-B044` | warning  | Feature block (Gherkin) declared but body contains another labelled “Acceptance criteria” list — single canonical form is Feature blocks (ADR-005 §Part 1). |

### 4.6 Markers (M)

| Code       | Severity | Meaning                                                                                                                                                   |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSL-M050` | warning  | `$Identifier` case convention does not match resolved entity kind (PascalCase ↔ type, camelCase ↔ instance, SCREAMING_SNAKE ↔ constant). ADR-005 §Part 2. |
| `MSL-M051` | error    | `$Identifier` does not resolve to any known entity. ADR-005 §Part 2 “Validation”.                                                                         |
| `MSL-M060` | warning  | Modal keyword appears in uppercase (`SHALL`) — will be normalized by `fmt`.                                                                               |
| `MSL-M061` | info     | Requirement-type entry contains no modal keyword. Style hint; profile may promote.                                                                        |

> **Implementation status (`main`).** `MSL-M060`/`MSL-M061` are implemented.
> `MSL-M050`/`MSL-M051` are **deferred-by-dependency**: their resolution chain
> ("ADR-005 §Part 2") is normative per the nextgen content-model ADR, which is
> **not landed on `main`** — no in-project entity-resolution model is specified
> here, so they cannot be implemented without inventing one. See
> [ADR-014](../architecture/adr-014-canonical-body-ast.md) (and
> [ADR-012](../architecture/adr-012-diagnostic-code-scheme.md) §6). `MSL-B044`
> (§4.5) and `MSL-C072` (§4.7) are implemented on the body-AST.

### 4.7 Captions (C)

| Code       | Severity | Meaning                                                                               |
| ---------- | -------- | ------------------------------------------------------------------------------------- |
| `MSL-C070` | error    | Caption keyword not adjacent to a captionable block of the matching type.             |
| `MSL-C071` | error    | Caption block-type mismatch (`Equation:` next to a `Figure`).                         |
| `MSL-C072` | warning  | Caption position violates project-configured convention (ADR-005 §Part 3 “Position”). |

### 4.8 References / trace (R)

| Code       | Severity | Meaning                                                                                                                                                                       |
| ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSL-R080` | error    | `Satisfies:` / `Derived-from:` / `Verifies:` / `Tests:` / `Realizes:` / `Mitigated-by:` / etc. points to an unknown `Id:`. (ADR-002 §Link-resolution severity, “Unresolved”.) |
| `MSL-R081` | warning  | Link target is retired (`Superseded-by` set OR `Deprecated` set). (ADR-002 §Link-resolution severity, “Retired”.)                                                             |
| `MSL-R082` | info     | Link target carries `Labels: DRAFT`. (ADR-002 §Link-resolution severity, “Labels: DRAFT”.)                                                                                    |
| `MSL-R083` | error    | Link target's type is incompatible with the relation's allowed target set (ADR-003 §Part 2 per-relation columns).                                                             |
| `MSL-R084` | error    | `Supersedes:` crosses shape (Authored ↔ Reference). ADR-002 §Part 1 “`Supersedes` operates within a shape”.                                                                   |
| `MSL-R085` | warning  | `References:` cites a slug that does not appear as a Reference-shape entry in scope.                                                                                          |

### 4.9 Format reports (F)

These appear only under `fmt --check` and indicate diffs `fmt` would apply. They
are not errors against the data model; they are reports.

| Code       | Severity | Meaning                                                         |
| ---------- | -------- | --------------------------------------------------------------- |
| `MSL-F100` | info     | Trailer key would be re-cased.                                  |
| `MSL-F101` | info     | Trailer order would change.                                     |
| `MSL-F102` | info     | Repeatable attribute would be rewritten from CSV to multi-line. |
| `MSL-F103` | info     | Modal keyword would be lowercased.                              |
| `MSL-F104` | info     | `[@…]` would be stripped to `[…]` on title line.                |
| `MSL-F105` | info     | Multiple blank lines would collapse.                            |
| `MSL-F106` | info     | `Id:` would be assigned (Authored shape only).                  |

### 4.10 Severity model

Severity follows ADR-002 §Link-resolution severity for trace, and ADR-003 §Part
5 “Validity check” for type-vs-attribute mismatch:

- **error** — the entry / project is malformed; CI fails.
- **warning** — the project is well-formed but the diagnostic indicates a smell.
  CI may fail at the project's discretion (`--strict`).
- **info** — informational; does not affect exit code.

Profiles may promote any `warning` or `info` to `error`. Profiles cannot demote
a core-defined `error` (ADR-009 §profile-extension).

---

## 5. Round-Trip Invariants

The contract surface between authors and tooling — the set of guarantees the
implementation must uphold.

### 5.1 Preserved byte-identically

`fmt` **must not change**:

- Body prose text, character-for-character, except for the modal-keyword
  normalization in §3.4.1 and the inline-marker normalization in §3.4.2.
- Fenced code block contents (including Feature / Gherkin and language-tagged
  Code blocks) — verbatim. Indentation of the fence itself may shift if the
  enclosing list-item indent changed; the content inside the fence does not.
- Math block contents (`$$ … $$`).
- Image links (`![alt](path)`) — alt text and path verbatim.
- Trailing-backslash line continuation if the author used it (ADR-001 §Line
  breaks).
- `$Identifier` tokens — case, spelling, position.
- Pandoc `[@key]` citations inside prose (not on title lines).

### 5.2 May be rewritten

`fmt` **may change** (deterministically, per §3):

- The list-item bullet character (`*`, `+` → `-`).
- Whitespace around `[ … ]` on the title line.
- The leading `@` on title-line display IDs (dropped — §3.2).
- Trailer key casing (→ TitleCase-Hyphenated, §3.3.4).
- Trailer key ordering across keys (§3.3.2).
- Repeatable-attribute form (CSV → multi-line, §3.3.3).
- Trailer block column (start at column 7 inside `-` list item, §3.3.1).
- Modal keyword case (→ lowercase except sentence-initial, §3.4.1).
- Caption keyword case (→ TitleCase, §3.4.3).
- Blank-line runs inside the body (collapsed to one, §3.4.3).
- `Id:` of an Authored entry that had no `Id:` (newly assigned, §3.5).

### 5.3 Determinism guarantees

- **Idempotence.** `fmt(fmt(x)) == fmt(x)` for every well-formed input. Verified
  by the e2e test in Prompt 3.
- **Total.** Every input either has a unique canonical output or raises a
  `P`/`I`/`T`/`A`/`B`/`M`/`C` error — `fmt` never emits two valid forms.
- **Platform-independent.** Identical input produces byte-identical output on
  macOS / Linux / Windows / Deno / Node / WASM.
- **Order-stable for synthesis.** When `Origin: synthesized` derives a ULID from
  `Source:`, the derivation is deterministic per ADR-003 §Part 1 (timestamp 0,
  randomness from SHA-256 of canonical `Source` value).

### 5.4 Loss-of-information guarantees

`fmt` is **lossless** for content it does not own:

- Unknown trailer keys are preserved verbatim in source order (§3.3.6).
- Body block types it does not understand (a future profile extension to the
  block catalogue would require an ADR amendment; until then there are no such
  block types).
- Comments inside fenced code blocks.
- HTML comments outside entry bodies.

### 5.5 Round-trip test obligations (for Prompt 3 e2e)

The Prompt-3 e2e suite must include, at a minimum:

1. Idempotence over a fixture corpus of every body block type, every caption
   type, every shape × type combination from §1.
2. Stability under attribute reordering: random shuffles of valid trailer sets
   produce the same output.
3. Stability under repeatable-value form mixing: CSV input and multi-line input
   that resolve to the same value list produce the same output.
4. ULID stability for `Origin: synthesized` across runs and platforms.
5. Lossless preservation of unknown trailer keys when no profile is loaded.

### 5.6 AST-equivalence contract (SP3)

The round-trip invariant for body content is not byte-identity but
**AST-equivalence** (ADR-015). The normative statement:

```
build(format(x)) ≈ normalizeBodyAst(build(x))
```

where:

- `build` = `buildBodyAst` (mdast → `BodyBlock[]`).
- `format` = `markspec fmt` applied to the entry's source.
- `normalizeBodyAst` = the deterministic, formatter-only AST pass that applies
  §3.4.1 modal-keyword case normalization (and any future §3.4 body rewrites) as
  an AST→AST transform. It is **never called on the validate path**.
- `≈` = `astEquivalent` — strict `BodyBlock[]` structural deep-equality ignoring
  every `SourceRange` field. Defined in `core/ast/equivalence.ts` and exported
  from `core/mod.ts`.

**What this replaces.** ADR-014 Decision-2 gated body emission on byte-identity
(`render(build(body)) === body`). That guard is retired by ADR-015: the
formatter's gate is now
`astEquivalent(buildBodyAst(format(x)), normalizeBodyAst(buildBodyAst(x)))`. A
**defensive string-keep fallback** (diagnosed as `MSL-F900`) is retained but
never fires over the corpus or project documents.

**Scope.** This contract covers the body zone only. Title-line and trailer-block
rewrites (§3.2, §3.3) are separate deterministic rules whose correctness is
established by the §5.3 determinism guarantees and the §5.5 e2e obligations.

**Fidelity matrix.** The end-state matrix
(`docs/product/ast-fidelity-matrix.md`) shows `OK=56, UNOWNED=2, RESIDUAL=0`
over 58 corpus samples. `UNOWNED` rows are all-Unknown-verbatim (excluded
constructs preserved as-is per §2.4.1 and §5.4); they do not fail the contract.
The staleness gate (`scripts/check_ast_fidelity_matrix.sh`) is a CI gate.

See [ADR-015](../architecture/adr-015-ast-equivalence-formatting-contract.md)
for the full decision record.

---

## 6. Profiles and extensions

Profiles are the MarkSpec extension mechanism: a versioned, distributable
package that layers domain-specific concrete types, attributes, and rules on top
of the frozen core. This section is a conceptual overview; the normative
definition is in [markspec-profile-schema.md](markspec-profile-schema.md).

### 6.1 What a profile declares

A profile is a `markspec.yaml` manifest (plus any referenced files) that may
declare:

- **Concrete types** — subtypes of any core type, via `extends:`. Convention:
  lowercase-with-hyphens (e.g., `requirement` extending `Requirement`, `hazard`
  extending `Risk`). Profile types participate in the type-resolution chain at
  step 2 (§1.3.1) — before all core inference steps.
- **Attributes** — new trailer keys scoped to a specific type or to all entries.
  Must not shadow any core-reserved key (§1.4–§1.6); violations are `MSL-A040`.
- **Relations** — additional trace-attribute names and their allowed target-type
  constraints.
- **Label concerns** — label values with defined semantics (e.g., `ASIL-B`,
  `safety`, `DRAFT`).
- **Conventions** — project-level rules that promote existing `warning`
  diagnostics to `error`, or add domain-specific style rules.

### 6.2 Extends chain

Profiles compose via `extends:` in the manifest, forming a linear inheritance
chain:

```
default → compliance → org → team → project
```

Each tier inherits everything from its parent and may add or narrow — never
remove. The **effective profile** is the single merged view produced by
collapsing the whole chain. The validator and compiler consume only the
effective profile.

A project binds to the chain via `.markspec.yaml` in the project root. The
binding is optional — without it, only the core vocabulary is active (core-only
mode, §6.4). `markspec profile show` displays the active chain and effective
configuration.

### 6.3 What profiles cannot do

The core taxonomy and universal attribute set are **reserved**:

- Profiles cannot redefine `Id`, `Type`, `Title`, or any of the 15 core concrete
  type names. Violation: `MSL-A040`.
- Profiles cannot remove core-defined attributes from a type's attribute set.
- Profiles cannot demote a core-defined `error` severity to `warning` or `info`.
- Profiles cannot alter shape discrimination (§1.2) — shape is always decided by
  the `Id:` value format alone, not by any profile rule.

### 6.4 Core-only mode

The toolchain operates correctly without any profile loaded. In core-only mode:

- Only the 4 abstract and 15 concrete core types are recognised.
- Any unrecognised `Type:` value is `MSL-T020` (error).
- Any unrecognised trailer key is `MSL-A020` (warning, preserved verbatim by
  `fmt`).
- Label-concern and convention rules are inactive.

This is the mode used by `markspec check` and `markspec compile` when no
`.markspec.yaml` is found by walking up from the working directory.

---

## 7. Open questions

Capped at five per the prompt's constraints.

1. **ADR-002bis location.** ADR-005 cites ADR-002bis as the authoritative source
   for the trailers block format, but ADR-002bis does not exist as a separate
   file. This spec treats ADR-002 §Part 1 (“Syntactic form” and “Attribute value
   types”) as authoritative and incorporates the trailer rules in §2.3 and §3.3.
   Should ADR-002bis be split out as its own ADR, or should ADR-002 §Part 1
   stand as the canonical trailers reference and the cross-references in ADR-003
   / ADR-005 be retargeted?

2. **Type-inference precedence when step 4 and step 5 disagree.** A
   Reference-shape entry may have a display-ID prefix that matches a known core
   prefix (e.g., `[REQ_FOO]` with `Id: doi:10.…`). §1.3.1 step 4 applies only to
   Authored entries and step 5 only to Reference entries, so the chain as
   written has no conflict — but a profile may declare a `display-id-pattern`
   (step 2) that matches a Reference entry, racing against the URI scheme map
   (step 5). Which wins, and is the answer profile-author-controllable?

3. **Single-shape document recommendation enforcement.** ADR-002 §Part 5
   recommends single-shape documents (or at least uniform-type documents) and
   lets directives surface style warnings. This spec encodes the directive
   system at §1.3.1 step 7 but does not define a `MSL-D…` category for
   directive-vs-content style warnings. Should a `MSL-Dnnn` subcategory be
   carved out, or do these stay as `MSL-T…` warnings?

4. **`Origin: synthesized` and the formatter.** ADR-003 §Part 4 “Synthesized
   entry behavior” says synthesized entries' bodies regenerate on every `fmt`
   run and hand-edits are overwritten. The §5.4 “lossless” guarantee in this
   spec contradicts that for `Origin: synthesized` entries. The contradiction is
   intentional (synthesis _is_ overwriting), but should `fmt` separate “format”
   from “synthesize” into two subcommands so that ordinary `fmt` is always
   lossless and `markspec synthesize` is the explicit-regenerate path?

5. **Profile subtype attribute layering.** ADR-003 §Part 7 says profiles may
   only extend core types, never remove or replace. The spec defines per-core-
   type attribute sets in §1.6 but does not specify the layering rules when a
   profile concrete type (e.g., `hazard extends Risk`) adds attributes that
   share a name with a different core type's attribute (e.g., `Severity` on
   `hazard` vs a future `Severity` on `Record`). Are profile attribute names
   namespaced by their declaring profile, or is the global trailer-key space
   first-come-first-served with collision diagnostics?

---

## Annex A — Cross-reference summary

This spec consolidates the following ADR sections. Implementations of Prompt 1
trace requirements back to these anchors.

| Section here                     | Source                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| §0 (Terminology)                 | ADR-003 §Part 1; ADR-004 §Part 1                                                           |
| §1.1 (Two layers)                | ADR-004 §Part 1                                                                            |
| §1.2 (Shape discrimination)      | ADR-002 §Part 4; ADR-004 §Part 1; ADR-003 §Part 1                                          |
| §1.3 (`Type:` and resolution)    | ADR-004 §Part 2; ADR-003 §Part 5 / §Part 6                                                 |
| §1.4 (Universal attributes)      | ADR-003 §Part 2 “Entry”; ADR-002 §Part 1; ADR-004 §Part 3                                  |
| §1.5 (Reference core attributes) | ADR-004 §Part 3                                                                            |
| §1.6 (Per-type attributes)       | ADR-003 §Part 2                                                                            |
| §1.7 (Display-ID rules)          | ADR-002 §Part 2 / §Part 3; ADR-003 §Part 1                                                 |
| §1.8 (Value types)               | ADR-002 §Part 1 “Attribute value types”                                                    |
| §2 (AST)                         | ADR-005 §Decision and §Parts 1–4                                                           |
| §2.5 (Inline markers)            | ADR-005 §Part 2                                                                            |
| §2.6 (Captions)                  | ADR-005 §Part 3                                                                            |
| §3 (Canonical form)              | ADR-001 §Line breaks; ADR-002 §Part 1; ADR-005 throughout                                  |
| §3.5 (Id assignment)             | ADR-002 §Identity; ADR-003 §Part 1 “Authored”                                              |
| §4 (Lint codes)                  | ADR-002 §Link-resolution severity; ADR-003 §Part 5; ADR-004 §Annex A; ADR-005 §Parts 1 & 2 |
| §5 (Round-trip)                  | ADR-001 §Line breaks; ADR-002 §Part 1 “CSV restriction”; ADR-003 §Part 1                   |

---

## Annex B — Worked examples

### B.1 Authored Requirement (default profile)

```markdown
- [REQ-107] Sensor input debouncing

  The $sensorDriver shall debounce $rawPressure to eliminate electrical noise
  before processing within $DEBOUNCE_WINDOW.

  $DEBOUNCE_WINDOW : Configurable duration between 1 ms and 100 ms, default 10
  ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Requirement
      Derived-from: 01HGW2R0NPQR4STVWXYZABCDEF
      References: ISO-26262-6 §9.4.5
      Labels: ASIL-B
```

- Shape: **Authored** (ULID `Id:`).
- Type: explicit `Type: Requirement`, matches the core concrete type.
- Trailer order: identity → trace upstream → universal trailing.
- Modal `shall` lowercase, entity refs verbatim.

### B.2 Reference Specification (cited standard)

```markdown
- [ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional safety — Part 6: Software level.

      Id: urn:iso:std:iso:26262:-6:ed-2
      Type: Requirement
      Derived-from: IEC-61508-3
      Reference-document: ISO 26262-6:2018
      Reference-url: https://www.iso.org/standard/68383.html
      Labels: functional-safety, automotive
```

- Shape: **Reference** (URI `Id:`).
- Type: `Requirement` (also reachable by step-5 inference from `urn:iso:` — here
  explicit).
- `Reference-document` / `Reference-url` are core attributes (§1.5).
- The title-line `[ISO-26262-6]` drops any leading `@` even if the source wrote
  `[@ISO-26262-6]`.

### B.3 Authored Component (project crate)

```markdown
- [braking-core] DriftSys braking core crate

  Core logic for brake pressure calculation and sensor filtering.

      Id: 01HGW3B2NPQR5GHIJKLMNOPQRST
      Type: SoftwareComponent
      Part-of: 01HGW3A0AAAA1AAAAAAAAAAAAAA
      Realizes: 01HGW3A1BBBB2BBBBBBBBBBBBBB
      License: Apache-2.0 OR MIT
      Build-manifest: Cargo.toml
      Package-manager: cargo
      Labels: rust, ASIL-B
```

### B.4 Reference Component (third-party dependency)

```markdown
- [serde] Serde Rust serialization framework

      Id: pkg:cargo/serde@1.0.193
      Type: SoftwareComponent
      Reference-url: https://serde.rs
      Labels: rust, runtime
```

- Type inferred at step 5 from the `pkg:cargo/` URI scheme (ADR-003 §Part 6).
- `License` deliberately omitted at the core level — present only when the
  RefHub-style profile is loaded.

### B.5 Authored Unit (production function)

```markdown
- [braking_core::controller::debounce_input] Debounce function

  Rejects transient noise on raw sensor readings.

      Id: 01HGW3D6QRST7IJKLMNOPQRSTUV
      Type: SoftwareUnit
      Source: src/braking/controller.rs
      Symbol: braking_core::controller::debounce_input
      Language: rust
      Part-of: 01HGW3B2NPQR5GHIJKLMNOPQRST
      Realizes: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Labels: rust, ASIL-B
```

- Display ID contains `::`, so step 8 would infer `Unit` even without explicit
  `Type:` — here explicit `Type: SoftwareUnit` upgrades to the concrete subtype.
- `Source:` drives step 3 fallback for synthesized entries (ADR-003 §Part 5).

---

## Annex C — Serialized form (compile output)

`markspec compile --output <dir>` writes the item model to disk as static files.
This annexe is the normative schema for that output.
[markspec-compile-output.md](markspec-compile-output.md) is retired; its
rationale and options analysis remain available there for historical reference.

### C.1 Directory layout

```text
<dir>/
├── manifest.json     # always JSON; always small (no entry bodies)
├── compiled.json     # small projects: < split-threshold entries (§C.4)
├── entries.ndjson    # large projects: one entry record per line
├── entries.idx       # byte-offset index: displayId/Id → (offset, length)
└── edges.ndjson      # generated inverse edges, one per line
```

The directory is static-servable (GitHub/GitLab Pages, S3, a file path). No
server or runtime is required. A consumer reads `manifest.json` first and
branches on `entries.format`.

### C.2 Manifest (`manifest.json`)

Always JSON, always small (target < 100 KB at 100k entries — holds no bodies):

```jsonc
{
  "markspecSchemaVersion": 1,
  "generator": { "release": "0.6.0", "coreSchema": 1 },
  "project": { "name": "...", "root": "urn:markspec:project:<id>" },
  "counts": {
    "entries": 1234,
    "edges": 5678,
    "byType": { "Requirement": 900 },
  },
  "entries": {
    "format": "ndjson",
    "file": "entries.ndjson",
    "index": "entries.idx",
  },
  "edges": { "format": "ndjson", "file": "edges.ndjson" },
  "sqliteMirror": null,
  "federation": [],
  "reserved": {},
}
```

The manifest is deterministic: byte-identical for identical input. No timestamps
or run metadata unless `--with-run-metadata` is passed.

### C.3 Entry record (one NDJSON line)

Each line is one JSON object carrying:

- `displayId`, `id` (ULID or URI), `shape` (`Authored` | `Reference`)
- `type` — resolved type (§1.3), `null` when unresolvable
- `title`, `body` — the entry's authoring content
- `rawAttributes` — trailer key/value pairs in source order
- `location` — `{ file, line, column }`
- `properties` — observed facts: `file.*`, `git.*`, `source.*` (ADR-006).
  `sync.*` is **never** included (§C.5 privacy).

Generated inverse edges are **not** inlined on the entry record — they live in
`edges.ndjson` so a hub entry's large reverse-edge list never bloats the record.
Unknown trailer keys are preserved verbatim (§5.4 lossless guarantee).

### C.4 Small-project degenerate form

Below `--split-threshold` (default 1000 entries), `compile` writes a single
`compiled.json` instead of `entries.ndjson` + `entries.idx`. The manifest points
at it via `"entries": { "format": "inline", "file": "compiled.json" }`.
Consumers branch on `entries.format`; both paths are equivalent.

### C.5 Privacy

- `sync.*` properties (external-system state, ADR-006) are **never** in the
  compile output. Hard exclusion enforced at serialization.
- `git.contributors` is included only with `--with-contributors` (default off).
- No credentials or `.markspec/sync/**` content ever enters the output
  directory.

### C.6 Versioning

`markspecSchemaVersion` (manifest root) is the integer core-schema contract
version. Consumers refuse a version they do not implement. Within one version,
changes are **additive-only**: new keys may appear; existing keys never change
type or disappear. Consumers **must** ignore unknown keys.

Pre-1.0 there is no cross-version compatibility guarantee — the compile output
is a derived artifact; recompile from source is the upgrade path. The
additive-only rule becomes binding at 1.0.
