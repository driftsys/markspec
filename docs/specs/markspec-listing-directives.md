# MarkSpec — Listing Directives

Status: Draft (Prompt 2 of the next-gen refactor)\
Date: 2026-05-16\
Scope: The three parallel listing-document directives — `markspec:references`,
`markspec:glossary`, `markspec:components` — at the **data level**: grammar,
component Id-scheme parsers, validation\
Builds on: [markspec-core-data-model.md](markspec-core-data-model.md) (Prompt 1
output), [markspec-profile-schema.md](markspec-profile-schema.md) (companion —
Component type vocabulary, `term`→`Definition` binding), ADR-006 (listing
directives), ADR-003 (information & traceability model — §Part 6 URI scheme
map), ADR-001 (Markdown format — heading structure)

This spec freezes the **directive grammar**, the **glossary heading-shape
grammar** (distinct from the Entry/Reference shapes), the **exact per-scheme
parsers** for Component `Id:` values, and the **per-directive validation** rules
(empty-listing and missing-directive behaviour).

### Out of scope (rendering — Prompt 3 / Prompt 4)

ADR-006 §Context is explicit, and the Prompt-2 brief restates it: **book /
renderer behaviour is not specified here.** Out of scope:

- Suffix-chapter ordering and placement (bibliography / glossary / BOM as back
  matter).
- Anchor generation, slugging, and intra-book cross-reference resolution between
  listings and entries.
- Numbering, sort order presentation, column layout of the rendered BOM table.

This spec defines only what the **parser and validator** must accept and report.
Rendering consumes that model in Prompt 3 (toolchain) / Prompt 4 (user docs).

---

## 0. Terminology

Inherits [markspec-core-data-model.md §0](markspec-core-data-model.md) and
[markspec-profile-schema.md §0](markspec-profile-schema.md). Adds:

| Term                    | Meaning                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **listing directive**   | One of `markspec:references` / `markspec:glossary` / `markspec:components` (ADR-006 §Decision).                          |
| **listing document**    | A Markdown file carrying a listing directive (explicitly or by filename trigger).                                        |
| **glossary shape**      | The heading-based document structure (H1/H2/H3) that is **not** an entry — §4. Distinct from Authored/Reference shapes.  |
| **component Id scheme** | A URI scheme MarkSpec recognizes for a Component-type Reference `Id:` (purl, mfg, gtin, cpe, urn:system, urn:tool) — §5. |

---

## 1. The three parallel directives

ADR-006 §Decision fixes three patterns — **uniform in trigger and lifecycle,
distinct in grammar**:

| Pattern        | Filename        | Directive             | Lists                       | Underlying model                                                              |
| -------------- | --------------- | --------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| **References** | `references.md` | `markspec:references` | External published works    | Reference-shape entries; `Type:` resolves to Specification / Component        |
| **Glossary**   | `glossary.md`   | `markspec:glossary`   | Domain vocabulary, acronyms | **Not entries** — glossary heading shape (§4) → core `Definition` items       |
| **Components** | `components.md` | `markspec:components` | System components (BOM)     | Reference-shape (typically) or Authored Component-type entries; Id schemes §5 |

They are **siblings, not variants** (ADR-006 §Context): the glossary's grammar
is heading-based, not the trailers-bearing entry block — §4 specifies it
separately and the spec does not unify the three.

**Cross-references to the companion spec:**

- The Component types a `markspec:components` listing admits
  (`SoftwareComponent`, `HardwareComponent`, `SoftwareInterface`,
  `HardwareInterface`, and profile subtypes such as `dependency`, `ecu`) are
  core types per core-data-model §1.3; profile subtyping is
  [markspec-profile-schema.md §3/§4](markspec-profile-schema.md).
- The glossary produces core `Definition` items (core-data-model §1.3 / ADR-003
  §Part 2 "Definition"); the default profile's `term`→`Definition` binding is
  [markspec-profile-schema.md §7.1](markspec-profile-schema.md).
- A profile's per-type `id-schemes:` hint
  ([markspec-profile-schema.md §4.5](markspec-profile-schema.md)) is validated
  against the parsers in §5 of this spec.

---

## 2. Directive placement and triggering

### 2.1 Filename trigger vs explicit directive

ADR-006 §Decision: "Filename triggers the directive automatically; the explicit
directive is needed only when the file uses a different name."

- **Filename trigger.** A file whose basename (case-insensitive, extension
  stripped) is exactly `references`, `glossary`, or `components` is treated as
  carrying the corresponding directive, with no comment required.
- **Explicit directive.** Any file may carry an HTML-comment directive to opt in
  under a different name (ADR-006 §File organization — split files like
  `hardware-components.md`):

  ```text
  <!-- markspec:components -->
  <!-- markspec:references -->
  <!-- markspec:glossary -->
  ```

  The directive comment is the only raw-HTML form permitted outside an entry
  body (core-data-model §2.4.1 `MSL-B043` exempts `<!-- markspec:* -->`).

### 2.2 File-level vs block-level placement

- **File-level (canonical).** The directive (filename or comment) governs the
  **entire file**. A file-level directive comment, when present, MUST appear
  before the first entry / first H2 group (for glossary). This is the only
  placement ADR-006 specifies and the canonical form.
- **Block-level.** ADR-006 does not define a sub-file directive scope. This spec
  **does not introduce one**: a listing file is wholly one listing kind. Mixing
  (e.g. a `markspec:components` block inside a requirements document) is **not**
  supported — the directive is file-level only. Rationale: a single-kind file
  matches the split-file organization ADR-006 §File organization already
  provides (`hardware-components.md`, `software-components.md`), and per-block
  directives would reintroduce the heterogeneous-document smell ADR-006 §Context
  rejects. (See §7 Open Question 1.)

### 2.3 Conflicting / duplicate directives

| Situation                                                                           | Behaviour                                                                                                                               |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Filename `references.md` **and** an explicit `<!-- markspec:references -->` (agree) | Accepted; the explicit comment is redundant but not an error (`MSL-L010` info, "redundant directive").                                  |
| Filename `glossary.md` but explicit `<!-- markspec:components -->` (disagree)       | Error `MSL-L011`: directive conflicts with filename trigger. The explicit directive does **not** silently win — the author resolves it. |
| Two different explicit directives in one file                                       | Error `MSL-L012`: multiple listing directives in one file. A listing file is one kind (§2.2).                                           |
| No filename trigger and no explicit directive                                       | Not a listing document — see §6.4 (missing-directive behaviour). Not an error in itself.                                                |

The `MSL-L…` code category is introduced by this spec — see §6.5 options
analysis for why a new category rather than reusing `MSL-A…`/`MSL-R…`.

---

## 3. References listing

### 3.1 Model

A `markspec:references` document contains **Reference-shape entries**
(core-data-model §1.2 — `Id:` is a scheme-qualified URI). Their `Type:` resolves
(core-data-model §1.3.1) to **Specification** (standards, papers, regulations,
RFCs) or **Component** (packaged dependencies cited bibliographically). This is
the entry block of core-data-model §2, unchanged — the references listing adds
**no new grammar**; it is a _placement + validation_ convention over ordinary
Reference entries.

Already specified by core-data-model §2 (entry grammar), §1.5 (`Reference-url` /
`Reference-document` core attributes), and the published spec §2.3 (ADR-006
§References). This section only fixes the listing-level validation (§6.1).

### 3.2 Relationship to `References:`

An entry elsewhere citing a work via the universal `References:` citation
attribute (core-data-model §1.4) points at a Reference entry that **should**
live in a references listing. A `References:` locator citing a slug absent from
any in-scope Reference entry is `MSL-R085` (core-data-model §4.8) — unchanged;
the references listing is the conventional home that makes such citations
resolve.

---

## 4. Glossary heading-shape grammar

### 4.1 Why it is not the entry model

ADR-006 §Glossary: glossary entries are "**Not part of the entry model** — uses
the heading-based structure from ADR-001 (H1 title, H2 letter groups, H3 terms,
body is the definition, cross-references via Markdown link references at end of
file)." Distinct because (ADR-006 §Glossary): a heading + paragraph is enough;
glossary terms are not trace targets; mixing terms with bibliographic references
clutters both.

A glossary document therefore uses **headings**, which the entry body model
explicitly **forbids inside an entry** (core-data-model §2.4.1 `MSL-B040`). The
glossary shape lives at the _document_ level, not inside any entry — the two
never collide. Each glossary term produces one core **`Definition`** Item
(core-data-model §1.3; ADR-003 §Part 2 "Definition"), so glossary terms still
participate in the information model (citable via `{{def.<slug>}}` and
`References:`), without being Authored/Reference entries.

### 4.2 Grammar (EBNF, normative)

```ebnf
GlossaryDoc      = [ DirectiveComment ] Title FrontProse?
                   LetterGroup+ LinkRefBlock? ;

Title            = "#" SP TitleText NL BlankLine ;          (* exactly one H1 *)

FrontProse       = { ParagraphBlock } ;                     (* optional intro *)

LetterGroup      = "##" SP GroupHeading NL BlankLine
                   TermDef+ ;

GroupHeading     = /[^\n]+/ ;        (* conventionally a single letter "A".."Z"
                                        or "0–9"/"Symbols"; not enforced *)

TermDef          = "###" SP Term NL BlankLine
                   Definition
                   BlankLine ;

Term             = /[^\n]+/ ;        (* the term as displayed *)

Definition       = DefinitionBlock { BlankLine DefinitionBlock } ;

DefinitionBlock  = Paragraph | List | Table | Code | Math
                 | Note | Blockquote | DefinitionList ;     (* see 4.4 *)

LinkRefBlock     = { LinkRefDefinition } ;                  (* end of file *)
LinkRefDefinition= "[" LinkLabel "]:" SP URLorSlug [ SP Title ] NL ;

DirectiveComment = "<!--" SP "markspec:glossary" SP "-->" NL BlankLine ;
SP               = " " ;
NL               = "\n" ;
BlankLine        = NL ;
```

Normative rules:

- **R4-a — one H1.** Exactly one H1 (the glossary title). Zero or ≥2 →
  `MSL-L020` (error).
- **R4-b — H2 = group.** Every term lives under an H2 group. An H3 with no
  preceding H2 in the file is `MSL-L021` (error). The H2 text is conventionally
  a letter bucket but the grammar does not constrain it (rendering/sorting is
  out of scope — §Out of scope).
- **R4-c — H3 = term.** Each H3 is one term. The H3 text is the **display
  term**. The term **slug** (the identity used by `{{def.<slug>}}` resolution
  and `References:`, ADR-010 §6 / core-data-model §1.4) is derived
  deterministically: lowercase; trim; collapse internal whitespace runs to a
  single `-`; drop every character outside `[a-z0-9._/-]` (the display-ID token
  grammar of core-data-model §1.7 / §2.5.2). Two H3s deriving the same slug (in
  scope) → `MSL-L022` (error, duplicate term).
- **R4-d — body = definition.** The blocks between an H3 and the next H3/H2/EOF
  are the definition. An empty definition (no block) → `MSL-L023` (warning — a
  defined-but-empty term is a smell, not malformed).
- **R4-e — depth.** Headings deeper than H3 (`####`+) inside a glossary document
  are `MSL-L024` (error): the glossary shape is exactly three levels.
- **R4-f — link references at end.** Collected link-reference definitions
  (`[label]: target`) are permitted only **after the last term**, as a trailing
  block (ADR-006 §Glossary "cross-references via Markdown link references at end
  of file"). A link-reference definition interleaved between terms is `MSL-L025`
  (warning — CommonMark still resolves it, but it violates the convention).

### 4.3 Mapping to the `Definition` Item

Each `TermDef` yields one `Definition` Item (core-data-model §1.3 / ADR-003
§Part 2):

| `Definition` attribute (ADR-003 §Part 2) | Source in the glossary shape                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Id`                                     | A ULID assigned by `markspec fmt` (Authored-equivalent; glossary terms are project-owned). The slug (R4-c) is the display handle. |
| `type`                                   | `Definition` (fixed for the glossary shape).                                                                                      |
| `Content`                                | The H3 term text + definition blocks.                                                                                             |
| `Aliases`                                | Optional — see R4-g.                                                                                                              |
| `See-also`                               | Optional — derived from intra-glossary link references targeting other term slugs.                                                |

- **R4-g — aliases.** A parenthetical acronym in the H3 (e.g.
  `### Automotive Safety Integrity Level (ASIL)`) contributes the parenthetical
  token as an `Aliases` value **and** an additional resolvable slug. This is a
  convenience; profiles needing richer acronym modelling extend `Definition`
  ([markspec-profile-schema.md §3](markspec-profile-schema.md); ADR-010 §6
  "Profiles that need a richer glossary model … extend `term`").
- The `Id:` for glossary terms is assigned, not authored: glossary documents
  carry **no trailers block** (they are not entries). `fmt` maintains a sidecar
  identity binding (mechanism deferred to Prompt 3 — the _data_ rule here is
  only that a term's identity is its slug + an assigned ULID, stable across
  renames per core-data-model §1.2 properties).

### 4.4 Definition body blocks

A definition admits the **prose-bearing subset** of the closed body-block
catalogue (core-data-model §2.4): `Paragraph`, `List`, `Table`, `Code`, `Math`,
`Note`, `Blockquote`, `DefinitionList`. Excluded: `Figure` and `Feature` — a
glossary definition is textual; a figure or a Gherkin scenario in a glossary is
`MSL-L026` (warning). Inline markers (modal keywords, `$Identifier` entity
references — core-data-model §2.5) are recognized inside definition prose
exactly as in entry bodies.

### 4.5 Options analysis — glossary grammar

| Decision                                                   | Alternative                                                      | Why rejected                                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Heading shape (H1/H2/H3), not the entry block (**chosen**) | Model glossary terms as Authored entries with `Type: Definition` | ADR-006 §Glossary explicitly rejects this: a heading + paragraph is enough; a trailers block per term is ceremony. Headings are forbidden in entry bodies (core-data-model §2.4.1) so the two shapes cannot be unified anyway. |
| Slug derived from H3 text deterministically (R4-c)         | Require an explicit slug per term (e.g. `{#asil}` attribute)     | Adds authoring ceremony to the simplest document type; deterministic derivation matches the renumberable-display-ID model (core-data-model §1.7) and the published `[[term-slug]]` convention (ADR-010 §6).                    |
| H2 unconstrained text (R4-b)                               | Enforce single-letter A–Z buckets                                | Bucketing is a _rendering/sort_ concern (explicitly out of scope — §Out of scope). The parser should not reject `## Symbols` or `## 0–9`.                                                                                      |
| Three levels exactly (R4-e)                                | Allow nested sub-terms (H4)                                      | ADR-006 fixes "H3 terms"; sub-terms are a richer-glossary feature ADR-010 §6 delegates to profile extension, not the base shape.                                                                                               |

---

## 5. Component Id schemes — exact parsers

For a Component-type entry in a `markspec:components` listing (or anywhere a
Component Reference appears), the `Id:` value is a scheme-qualified URI
(core-data-model §1.2). ADR-006 §Component Id schemes + ADR-003 §Part 6 fix the
recognized schemes. This section gives the **exact parser** for each. Each
parser either **accepts** (and yields the structured components below, feeding
type inference per core-data-model §1.3.1 step 5 / ADR-003 §Part 6) or
**rejects** with the cited diagnostic.

A value that is a well-formed RFC 3986 URI but matches **none** of the schemes
below is still a valid Reference `Id:` (core-data-model §1.2) — it simply gets
no component-scheme classification (`MSL-L030` info: "unrecognized component Id
scheme; classified by fallback"). Scheme matching is **longest-declared-prefix
wins**, with profile-declared schemes taking precedence over the core set for
the prefixes they cover
([markspec-profile-schema.md §6](markspec-profile-schema.md); ADR-003 §Part 6
"Profile extension").

### 5.1 `pkg:` — Package URL (purl)

**Authoritative grammar:** the Package-URL (purl) specification,
`github.com/package-url/purl-spec` (the `PURL-SPECIFICATION.rst` ABNF). MarkSpec
**does not redefine** purl; it adopts the upstream grammar by reference
(Prompt-2 constraint — "purl has its own grammar; reuse it"). The canonical purl
string is:

```text
pkg:type/namespace/name@version?qualifiers#subpath
```

MarkSpec-relevant rules (a thin profile over the upstream spec — the upstream
spec is normative for anything not stated here):

- **P5.1-a.** `scheme` MUST be the literal `pkg` (lowercase). Else not a purl;
  fall through to other schemes.
- **P5.1-b.** `type` and `name` are REQUIRED; `namespace`, `version`,
  `qualifiers`, `subpath` are OPTIONAL — per the upstream spec. A missing
  required component → `MSL-L031` (error, "malformed purl: <reason>"), message
  quoting the upstream rule violated.
- **P5.1-c.** Percent-decoding, canonical lowercasing of `type`, and
  type-specific normalization (e.g. `pkg:golang` case rules) follow the upstream
  spec verbatim. MarkSpec performs no normalization the upstream spec does not
  mandate (preserves the round-trip / determinism contract, core-data-model §5).
- **P5.1-d — type → Item type.** The `pkg:` `type` segment maps to a core Item
  type per ADR-003 §Part 6 "Core scheme map"
  (`pkg:cargo|npm|maven|pypi|go|nuget|deno|swift` → `SoftwareComponent`;
  `pkg:hw|device` → `HardwareComponent`; `pkg:firmware` → `SoftwareComponent`; a
  purl carrying a `#<symbol-path>` subpath → `SoftwareUnit`). Profiles extend
  the map ([markspec-profile-schema.md §6](markspec-profile-schema.md)). An
  unmapped `pkg:` type is accepted (valid purl) and classified `Component`
  (abstract fallback, core-data-model §1.3.1) with `MSL-L030` info.

`pkg:` is the strongest convention (ADR-006 §Component Id schemes — SPDX,
CycloneDX, GitHub Dependency Graph). It is the recommended scheme for every
software dependency.

### 5.2 `mfg:vendor:partno` — manufacturer part

A MarkSpec-local convention (ADR-006 §Component Id schemes — "informal but
readable"; no upstream standard). Grammar (ABNF, normative; this spec owns it):

```abnf
mfg-id     = "mfg:" vendor ":" partno
vendor     = token
partno     = token *( ":" token )      ; partno MAY contain colons
token      = 1*( ALPHA / DIGIT / "-" / "." / "_" )
```

- **P5.2-a.** Exactly the literal prefix `mfg:`, then a non-empty `vendor`, then
  `:`, then a non-empty `partno`. `partno` MAY itself contain `:` (vendor part
  numbers do); the **first** `:` after `mfg:` ends the vendor, the remainder
  (which may contain further `:`) is the part number.
- **P5.2-b.** A missing `vendor` or `partno`, or a character outside `token`, is
  `MSL-L032` (error, "malformed mfg id").
- **P5.2-c — type.** Maps to `HardwareComponent` (ADR-003 §Part 6 — the
  `urn:<vendor>:<part-number>` row generalizes; `mfg:` is the readable form).
  Refined to `HardwareUnit` if the entry carries `Footprint`/`Value`
  (core-data-model §1.3.1 step 6 discriminating attributes).

### 5.3 `gtin:` — GS1 Global Trade Item Number

**Authoritative grammar:** GS1 General Specifications (GTIN). MarkSpec adopts it
by reference. Grammar (the MarkSpec-validated subset):

```abnf
gtin-id    = "gtin:" 1*DIGIT          ; 8, 12, 13, or 14 digits
```

- **P5.3-a.** After `gtin:`, exactly 8, 12, 13, or 14 decimal digits
  (GTIN-8/12/13/14). Any other length → `MSL-L033` (error, "gtin: expected
  8/12/13/14 digits").
- **P5.3-b.** The final digit is the GS1 mod-10 check digit. MarkSpec verifies
  it (GS1 standard check-digit algorithm); a failed check digit is `MSL-L034`
  (error, "gtin: check digit mismatch"). The algorithm is cited, not reproduced
  (GS1 General Specifications §7.9 "Check digit calculation").
- **P5.3-c — type.** `HardwareComponent` (cataloged part — ADR-006 §Component Id
  schemes "canonical for cataloged parts").

### 5.4 `cpe:` — Common Platform Enumeration

**Authoritative grammar:** NIST IR 7695 (CPE 2.3 Naming Specification),
Formatted-String binding. MarkSpec adopts it by reference and validates the
formatted-string form:

```text
cpe:2.3:part:vendor:product:version:update:edition:language:sw_edition:target_sw:target_hw:other
```

- **P5.4-a.** MUST begin `cpe:2.3:` then exactly **11** colon-separated
  components (`part` … `other`), per NIST IR 7695 §6.2. The legacy URI binding
  (`cpe:/…`, CPE 2.2) is **rejected** with `MSL-L035` (error, "cpe: use 2.3
  formatted-string binding") — a single canonical form (core-data-model §3.1
  determinism rationale).
- **P5.4-b.** `part` MUST be one of `a` (application), `o` (OS), `h` (hardware);
  else `MSL-L036` (error). Component escaping/quoting follows NIST IR 7695 §6.2
  verbatim.
- **P5.4-c — type.** `part: h` → `HardwareComponent`; `part: a`/`o` →
  `SoftwareComponent` (ADR-006 §Component Id schemes — "cpe: exists for
  platforms"; ADR-003 §Part 6 fallback to Component when ambiguous).

### 5.5 `urn:system:` and `urn:tool:`

URN forms (RFC 8141 URN syntax) for, respectively, an external system the
project integrates with and a development tool. ADR-006 treats these as trivial;
this spec fixes the ABNF (MarkSpec owns these NID-like conventions):

```abnf
system-id  = "urn:system:" segment *( ":" segment )
tool-id    = "urn:tool:"   segment *( ":" segment )
segment    = 1*( ALPHA / DIGIT / "-" / "." / "_" )
```

- **P5.5-a.** Non-empty after the prefix; each `segment` non-empty; characters
  restricted to `segment`. Violations → `MSL-L037` (error).
- **P5.5-b — type.** `urn:system:` → `Component` (external system; abstract
  fallback unless a profile maps it more specifically — ADR-003 §Part 6
  `urn:system:` row → Component / HardwareComponent per profile). `urn:tool:` →
  `SoftwareComponent` (development tool — ADR-003 §Part 6 "Development tool
  `urn:tool:`"). A profile may remap either prefix
  ([markspec-profile-schema.md §6](markspec-profile-schema.md)).

### 5.6 Scheme summary

| Scheme        | Grammar owner               | MarkSpec parser § | Default Item type (pre-profile)       |
| ------------- | --------------------------- | ----------------- | ------------------------------------- |
| `pkg:`        | purl spec (by reference)    | §5.1              | per type segment (ADR-003 §Part 6)    |
| `mfg:`        | this spec (ABNF)            | §5.2              | HardwareComponent                     |
| `gtin:`       | GS1 Gen. Specs (by ref.)    | §5.3              | HardwareComponent                     |
| `cpe:`        | NIST IR 7695 (by reference) | §5.4              | HardwareComponent / SoftwareComponent |
| `urn:system:` | this spec (ABNF)            | §5.5              | Component                             |
| `urn:tool:`   | this spec (ABNF)            | §5.5              | SoftwareComponent                     |

### 5.7 Options analysis — Id-scheme parsing

| Decision                                          | Alternative                                   | Why rejected                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adopt purl / CPE / GTIN by reference (**chosen**) | Re-specify each grammar inline in this spec   | The Prompt-2 brief is explicit ("Component Id schemes have authoritative upstream specs. … Don't reinvent"). Reproducing them invites drift and licensing review; referencing the canonical spec is the only maintainable choice.                                                               |
| Reject CPE 2.2 URI binding (P5.4-a)               | Accept both 2.2 and 2.3 bindings              | Two canonical forms for one identity violate the single-canonical-form principle (core-data-model §3.1) and complicate matching. 2.3 is the current NIST binding.                                                                                                                               |
| `mfg:` first-colon-splits-vendor (P5.2-a)         | Disallow `:` in part numbers                  | Real manufacturer part numbers contain `:`; forbidding it makes the scheme unusable for its purpose. The fixed `mfg:vendor:` prefix makes the split unambiguous.                                                                                                                                |
| New `MSL-L…` category for listing diagnostics     | Reuse `MSL-A…` (attributes) / `MSL-R…` (refs) | Listing/scheme errors are neither trailer-attribute nor cross-reference resolution failures; folding them into `A`/`R` blurs the category meaning core-data-model §4 fixes. A dedicated category keeps diagnostics greppable and lets profiles promote listing rules independently. (See §6.5.) |

---

## 6. Per-directive validation

### 6.1 References listing

- Every block-level item MUST be a Reference-shape entry (core-data-model §1.2).
  An Authored entry (ULID `Id:`) in a references listing → `MSL-L040` (warning —
  likely misplaced; a project-owned artifact is not a bibliographic reference,
  but the entry itself is well-formed).
- Each entry's resolved `Type:` SHOULD be `Specification` or `Component`
  (ADR-006 §References). A resolved `Unit` in a references listing → `MSL-L041`
  (warning).
- `Reference-document` / `Reference-url` are core attributes (core-data-model
  §1.5) and are **not required** by the listing (a bare URN-only reference is
  valid).

### 6.2 Glossary listing

- The file MUST satisfy the §4.2 grammar; violations are the `MSL-L02x` codes in
  §4.2.
- A glossary file MUST NOT contain entry blocks (`- [ID] …` with a trailers
  block). An entry in a glossary file → `MSL-L042` (error — the glossary is not
  the entry model; ADR-006 §Glossary).

### 6.3 Components listing

- Every item MUST resolve to a Component-family `Type:`
  (`Component`/`SoftwareComponent`/`HardwareComponent`/`SoftwareInterface`/`HardwareInterface`
  or a profile subtype of one — core-data-model §1.3;
  [markspec-profile-schema.md §3](markspec-profile-schema.md)). A non-Component
  type in a components listing → `MSL-L043` (error).
- A Reference-shape component's `Id:` MUST parse under some §5 scheme **or** be
  a valid RFC 3986 URI (the `MSL-L030` info fallback applies; not an error —
  ADR-006 §Component Id schemes allows "any scheme that satisfies RFC 3986").
- An Authored-shape component (project-owned crate / in-house ECU — ADR-006
  §Components "may include Entry-authored Components") is valid; its `Id:` is a
  ULID and §5 does not apply.

### 6.4 Empty-listing and missing-directive behaviour

| Situation                                                                                  | Behaviour                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listing document present, **zero** items (no entries / no terms)                           | `MSL-L050` **info**, not error: an empty `references.md`/`components.md`/`glossary.md` is a valid placeholder (a new project legitimately has none). Rendering (out of scope) decides whether to emit an empty chapter.                                                                                                             |
| Listing document with only front prose, no items                                           | Same as above (`MSL-L050`).                                                                                                                                                                                                                                                                                                         |
| A `References:` / `{{def.<slug>}}` citation with **no** listing document anywhere in scope | Not a listing error. Resolution falls to the existing core codes: `MSL-R085` (unresolved `References:` slug, core-data-model §4.8) / the `Definition`-resolution warning. The listing is conventional, not mandatory — its absence degrades to ordinary unresolved-reference diagnostics, never a hard "missing directive" failure. |
| A file that _looks_ like a listing (e.g. `glossary.md`) but is empty / malformed           | Filename trigger still applies; §4 / §6.2 validation runs and reports. The trigger is structural, not opt-in.                                                                                                                                                                                                                       |

**Missing-directive principle:** the listing directives are an **organizational
convention**, not a precondition for validation. Their absence never escalates a
reference/definition resolution issue beyond the core code that already covers
it (core-data-model §4.8). This keeps a profile-free, listing-free project valid
(ADR-009 §10 core-only mode).

### 6.5 Diagnostic category — `MSL-L…`

This spec introduces the `MSL-L` (Listing) category, extending the
core-data-model §4 namespace (which reserves `P/I/T/A/B/M/C/R/F`). `L` is
**additive** and does not alter any core code. Codes used here:
`MSL-L010`–`L012` (directive placement, §2.3), `L020`–`L026` (glossary grammar,
§4), `L030`–`L037` (Id schemes, §5), `L040`–`L043` (per-directive content,
§6.1–6.3), `L050` (empty listing, §6.4). Severity follows the core model
(core-data-model §4.10): errors are malformed listings; warnings are smells;
info is advisory. Profiles may promote any `MSL-L` warning/info to error
([markspec-profile-schema.md §4.3](markspec-profile-schema.md); core-data-model
§4.10) and may not demote an `MSL-L` error.

---

## 7. Open questions

Capped at five (Prompt-2 constraint).

1. **Block-level directive scope.** §2.2 forbids sub-file directive scoping and
   relies on ADR-006's split-file organization instead. A monorepo with one
   `components.md` per package may still want a single aggregated file with
   per-section scoping. Is the file-level-only restriction permanent, or does a
   future ADR carve a block-level directive (and how would it interact with
   core-data-model §2.4.1 `MSL-B043` raw-HTML rules)?
2. **Glossary identity persistence.** §4.3 says a glossary term's identity is
   its slug + an assigned ULID, stable across renames, with `fmt` maintaining a
   sidecar binding — but the sidecar mechanism is deferred to Prompt 3. What is
   the on-disk form, and does a renamed H3 (slug change) preserve the ULID the
   way a renamed display ID does for entries (core-data-model §1.2)?
3. **`See-also` derivation (R4 table).** §4.3 derives `Definition.See-also` from
   intra-glossary link references. The exact rule (which `[label]: target` forms
   count, how a target slug is matched) is sketched, not pinned. Should
   `See-also` be author-explicit instead of derived?
4. **purl `qualifiers` and identity.** §5.1 adopts purl verbatim, but purl
   `qualifiers` (e.g. `?repository_url=…`) can make two strings denote the same
   artifact. Does MarkSpec treat purl identity as the canonical-normalized form
   (so `Id:` dedup, core-data-model §4.2 `MSL-I007`, sees them as equal), and is
   that normalization in scope for Prompt 3?
5. **Profile-supplied component schemes vs §5 parsers.** §5 fixes parsers for
   six schemes; [markspec-profile-schema.md §6](markspec-profile-schema.md) lets
   profiles add scheme→type mappings. A profile can map a _prefix_ but cannot
   supply a _parser/validator_ for it (that is hook territory, ADR-012). Until
   hooks land, is "prefix mapping without structural validation" sufficient for
   compliance profiles, or do common hardware schemes (e.g. IEC 61360) need
   first-class parsers here?

---

## Annex — Cross-reference summary

| Section here                | Source                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| §1 Three directives         | ADR-006 §Decision; core-data-model §1.2/§1.3                                                                         |
| §2 Placement / triggering   | ADR-006 §Decision/§File organization; core-data-model §2.4.1                                                         |
| §3 References listing       | core-data-model §1.2/§1.5/§2/§4.8; ADR-006 §References                                                               |
| §4 Glossary heading shape   | ADR-006 §Glossary; ADR-001 §heading structure; core-data-model §1.3/§2.4.1; ADR-003 §Part 2 "Definition"; ADR-010 §6 |
| §5 Component Id schemes     | ADR-006 §Component Id schemes; ADR-003 §Part 6; purl spec; NIST IR 7695; GS1 Gen. Specs; RFC 8141; RFC 3986          |
| §6 Per-directive validation | ADR-006 §Consequences; core-data-model §4.8/§4.10; ADR-009 §10                                                       |
| §1/§5/§6 profile cross-refs | [markspec-profile-schema.md](markspec-profile-schema.md) §3/§4.5/§6/§7.1                                             |
