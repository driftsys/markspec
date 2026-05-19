#set page(paper: "a4", flipped: true, margin: (x: 0.6cm, y: 0.6cm))
#set text(font: "IBM Plex Sans", size: 8pt)
#set par(leading: 0.4em, spacing: 0.6em)
#show heading.where(level: 1): it => {
  v(0.7em)
  text(size: 10pt, weight: "bold", it.body)
  v(0.15em)
}
#show heading.where(level: 2): it => {
  v(0.3em)
  text(size: 8pt, weight: "bold", it.body)
  v(0.05em)
}
#show heading.where(level: 3): set text(size: 7.5pt, weight: "bold")
#show raw: set text(font: "IBM Plex Mono", size: 7pt)

#let code(body) = block(
  fill: luma(245), radius: 2pt, inset: 4pt, width: 100%, body,
)

// ── Page 1: Markdown Flavor & Entries ──────────────────────────────────

#align(center, text(14pt, weight: "bold")[MarkSpec Cheat Sheet — Flavor & Entries])
#v(0.4em)

#columns(3, gutter: 14pt)[

= Markdown flavor

#table(
  columns: (1fr, 1fr),
  stroke: 0.4pt + luma(180),
  inset: 3pt,
  table.header[*Feature*][*MarkSpec*],
  [Headings], [`#` ATX only],
  [Emphasis], [`_text_` underscores],
  [Strong], [`**text**` asterisks],
  [Lists], [`-` dashes only],
  [Code fences], [Backticks + lang required],
  [Line breaks], [Trailing `\` only],
  [Horiz. rules], [`---` only],
  [Inline HTML], [Comments only],
  [H1], [First line, exactly one],
  [Heading levels], [No skipping],
  [Images], [Alt text required],
  [Front matter], [Not allowed],
)

== GFM / GLFM shared

Tables (pipe) · Strikethrough `~~text~~` · Task lists `- [x]` · Footnotes `[^1]` · Math `$x$` `$$x$$`

== Alerts

#code[```markdown
> [!WARNING]
> **Custom title** — Body.
```]

`NOTE` · `TIP` · `IMPORTANT` · `WARNING` · `CAUTION`

== Formatting rules

#table(
  columns: (1fr, 1fr),
  stroke: 0.4pt + luma(180),
  inset: 3pt,
  [Line width], [80 (configurable)],
  [Prose wrap], [`always` (configurable)],
  [Line endings], [`lf`],
  [List indent], [2 spaces],
  [Final newline], [Single `\n`],
  [Formatter], [dprint (not Prettier)],
)

== Autolinks

`<https://example.com>` · `<user@example.com>`

= Captions

== Table caption (above table)

#code[```markdown
_Table: Sensor thresholds_

| Col | Col |
| --- | --- |
| val | val |
```]

Slug: `tbl.sensor-thresholds`

== Figure caption (below image)

#code[```markdown
![Alt text](image.svg)

_Figure: Architecture overview_
```]

Slug: `fig.architecture-overview`

#colbreak()

= Entry blocks

#code[```markdown
- [SRS_BRK_0107] Sensor debouncing

  The sensor driver shall debounce
  raw inputs to eliminate noise.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Derived-from: 01HGW2R0NPQR4STVWXYZABCDEF
      Labels: ASIL-B
```]

No `_emphasis_` inside entries. `**Strong**` and `` `code` `` ok.

== Two shapes (single `Id:`)

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + luma(180),
  inset: 3pt,
  table.header[*Shape*][*`Id:` value*],
  [Authored], [Bare ULID, assigned by `format`],
  [Reference], [URI w/ scheme: `urn:` `doi:` `pkg:` `https:`],
)

#code[```text
Id: 01HGW2P4KFR7ABCDEFGHJKMNPQ
Id: urn:iso:std:iso:26262:-6:ed-2
Id: pkg:cargo/serde@1.0.0
```]

== EARS patterns (requirement body)

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + luma(180),
  inset: 3pt,
  table.header[*Form*][*Template*],
  [Ubiquitous], [_The system_ `shall` _…_],
  [State], [`While` _state,_ _system_ `shall` _…_],
  [Event], [`When` _event,_ _system_ `shall` _…_],
  [Unwanted], [`If` _condition,_ _system_ `shall` _…_],
  [Optional], [`Where` _feature,_ _system_ `shall` _…_],
)

== GWT pattern (test body)

#code[```markdown
- [SWT_BRK_0030] Debounce rejects short pulses

  Given the debounce threshold is 10 ms,
  When a pulse of 5 ms arrives,
  Then the output shall remain unchanged.
```]

#colbreak()

= Universal attributes

Apply to every entry (both shapes).

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + luma(180),
  inset: 3pt,
  table.header[*Attr*][*Description*],
  [`Id`], [ULID or URI; required],
  [`Labels`], [Free-form tags (`DRAFT`, …)],
  [`References`], [Cite referenced entries (locator ok)],
  [`External-id`], [Cross-system identifier],
  [`Supersedes`], [Same-shape predecessor],
  [`Superseded-by`], [Generated inverse],
  [`Deprecated`], [Retirement reason],
)

= Referenced entry

#code[```markdown
- [@ISO-26262-6] ISO 26262 Part 6

      Id: urn:iso:std:iso:26262:-6:ed-2
      Reference-url: https://www.iso.org/...
      Reference-document: ISO 26262-6:2018
```]

Body optional. `Reference-*` are default-profile, not core.

= Profile layer

Core defines 15 concrete types (`Requirement`, `Test`, `Contract`, `Record`,
`Risk`, `SoftwareComponent`, `HardwareComponent`, `SoftwareInterface`,
`HardwareInterface`, `SoftwareUnit`, `HardwareUnit`, `Definition`, …).
Profiles extend via `extends:` — adding subtypes, attributes, relations.

- *Subtypes* — `requirement extends Requirement`, `hazard extends Risk`, …
- *Relations* — `Derived-from`, `Satisfies`, `Verifies`, `Tests`,
  `Realizes`, `Allocated-to`, `Depends-on`, `Part-of`, …
- *Domain attrs* — `Test-level`, `ASIL`, `License`, …

Profiles chain: `default → compliance → org → project`. Active chain
set via `.markspec.yaml`. No profile = core-only mode.

= In-code entries

#code[```kotlin
/**
 * [unit-test-debounce] Debounce test
 *
 *     Id: 01HGW3R9QNP4ABCDEFGHJKMNPQ
 *     type: test
 *     Verifies: 01HGW2Q8MNP3RSTVWXYZABCDEF
 */
@Test fun debounce() { }
```]

Rust `///` · Kotlin `/** */` · C `/** */` · Java 23+ `///`

]

// ── Page 2: Directives, Books, References ──────────────────────────────

#pagebreak()

#align(center, text(14pt, weight: "bold")[MarkSpec Cheat Sheet — Directives, Books & References])
#v(0.6em)

#columns(3, gutter: 14pt)[

= Directives

HTML comments: `<!-- markspec:NAME -->`. Invisible on GitHub/GitLab.

== Document directives (after H1)

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + luma(180),
  inset: 3pt,
  table.header[*Directive*][*Purpose*],
  [`glossary`], [Term definitions],
  [`summary`], [Book table of contents],
  [`deck`], [Slide deck],
  [`references`], [Standards registry],
  [`deprecated`], [Mark deprecated],
  [`paginate`], [Pagination (deck)],
)

Auto-detected: `glossary` from `GLOSSARY.md`, `summary` from `SUMMARY.md`.

== Inline directives

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + luma(180),
  inset: 3pt,
  table.header[*Directive*][*Purpose*],
  [`break page`], [Page break],
  [`break column`], [Column break],
  [`columns 2`], [Multi-column],
  [`section Name`], [Deck section],
  [`notes`], [Speaker notes],
  [`disable ID`], [Suppress lint],
  [`disable-next-line`], [Suppress next line],
  [`ignore`], [Skip block],
)

Close range directives with `<!-- markspec:end NAME -->`.

== Multi-column

#code[```markdown
<!-- markspec:columns 2 -->

Left column.

<!-- markspec:break column -->

Right column.

<!-- markspec:end columns -->
```]

== Speaker notes (deck)

#code[```markdown
<!--
markspec:notes
Mention the 150ms requirement.
-->
```]

== Lint suppression

#code[```markdown
<!-- markspec:disable MSL-R011 -->

- [SRS_BRK_0108] Legacy req

<!-- markspec:end disable -->
```]

#colbreak()

= Deck (presentations)

`---` = slide break. `==` starts each slide.

== Markdown source

#code[```markdown
# Presentation Title

<!-- markspec:deck -->

## First Slide

Content here.

---

## Second Slide

More content.

<!-- markspec:section Demo -->

## Demo Slide
```]

= Mustache references

#code[```text
{{namespace.id}}
```]

Two braces. No sections or partials. Not resolved inside code fences.

== Namespaces

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + luma(180),
  inset: 3pt,
  table.header[*NS*][*Resolves*],
  [`project`], [`project.yaml` field (`name`, `version`)],
  [`req`], [Entry by display ID (e.g. `{{req.SRS_BRK_0107}}`)],
  [`fig`], [Figure caption slug],
  [`tbl`], [Table caption slug],
)

Profile-declared types may add namespaces (e.g. `ref`, `h`).

= Reference entries

Display ID = slug. `Id:` is a URI (URN/DOI/purl/ISBN/HTTPS).

#code[```markdown
- [@ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional
  safety — Part 6: Software.

      Id: urn:iso:std:iso:26262:-6:ed-2
      Reference-document: ISO 26262-6:2018
      Reference-url: https://www.iso.org/...
      Labels: functional-safety
```]

`Id:` is core; `Reference-*` and `License` are default-profile.

#colbreak()

= Book structure

== SUMMARY.md

#code[```markdown
# Book Title

[Overview](overview.md)

---

# Part Name

- [Chapter](chapter.md)
  - [Sub](sub.md)

# Another Part

- [Chapter 2](chapter2.md)

---

[Glossary](GLOSSARY.md)
[Contributing](CONTRIBUTING.md)
```]

- First H1 = book title
- Other H1s = part headings (dividers)
- `---` = separators
- Front/back = unnested, no numbering
- Every link target must exist
- Human-authored, tooling validates

== Glossary format

H1 = title, H2 = letter groups, H3 = terms. Link refs at end, alphabetical.

#code[```markdown
# Glossary

## A

### ASIL

Automotive Safety Integrity Level...

[ASIL]: #asil
```]

= Document types

#table(
  columns: (auto, auto, 1fr),
  stroke: 0.4pt + luma(180),
  inset: 3pt,
  table.header[*Type*][*Detection*][*Description*],
  [`doc`], [default], [Any Markdown file],
  [`glossary`], [name/directive], [Terms],
  [`summary`], [name/directive], [Book TOC],
  [`references`], [name/directive], [Standards],
  [`deck`], [directive only], [Slides],
  [`code`], [extension], [Source + doc comments],
)

]
