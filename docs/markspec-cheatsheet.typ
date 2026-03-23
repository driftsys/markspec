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
#v(0.6em)

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

  Id: SRS_01HGW2Q8MNP3\
  Satisfies: SYS_BRK_0042\
  Labels: ASIL-B
```]

No `_emphasis_` inside entries. `**Strong**` and `` `code` `` ok.

== Display ID format

`TYPE_XXX_NNNN`

- *TYPE* — STK, SYS, SRS, SAD, ICD, VAL, SIT, SWT
- *XXX* — 2–6 uppercase letters (project abbrev)
- *NNNN* — zero-padded, unique in project

== ULID

`TYPE_01HGW2Q8MNP3` — 12–13 chars. Assigned by tooling, never changes.

== Entry types

#table(
  columns: (auto, auto, 1fr),
  stroke: 0.4pt + luma(180),
  inset: 3pt,
  table.header[*Cat.*][*Type*][*Name*],
  [Req], [STK], [Stakeholder requirement],
  [], [SYS], [System requirement],
  [], [SRS], [Software requirement],
  [Arch], [SAD], [Architecture description],
  [], [ICD], [Interface control document],
  [Test], [VAL], [Acceptance test],
  [], [SIT], [System integration test],
  [], [SWT], [Software test],
)

= In-code entries

#code[```kotlin
/**
 * [SRS_BRK_0107] Sensor debouncing
 *
 * The sensor driver shall reject
 * transient noise shorter than the
 * configured debounce window.
 *
 * Id: SRS_01HGW2R9QLP4\
 * Satisfies: SYS_BRK_0042\
 * Labels: ASIL-B
 */
@Test
fun `swt_brk_0107 debounce`() { }
```]

== Code annotations

#code[```kotlin
/** Verifies: SRS_BRK_0107 */
/** Implements: SRS_BRK_0107 */
```]

Languages: Rust `///` · Kotlin `/** */` · C++ `///` · C `/** */` · Java 23+ `///`

#colbreak()

= Attributes

== Authored (committed)

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + luma(180),
  inset: 3pt,
  table.header[*Attr*][*Description*],
  [`Id`], [ULID, mandatory],
  [`Satisfies`], [Upstream parent ID(s)],
  [`Derived-from`], [External ref + section],
  [`Labels`], [Comma-separated tags],
)

== Generated (never in source)

`Verified-by` · `Implemented-by`

== SAD-specific

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + luma(180),
  inset: 3pt,
  [`Allocates`], [SRS display ID(s)],
  [`Component`], [Name or registry ID],
  [`Constrains`], [Component name(s)],
)

== ICD-specific

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + luma(180),
  inset: 3pt,
  [`Between`], [Two parties, comma-separated],
  [`Interface`], [RIDL ref `{{ridl.id}}`],
)

== Derived-from format

#code[```text
Derived-from: ISO-26262-6 §9.4
```]

ID validated; section locator is free text.

= ATDD example (Kotlin + Gherkin)

#code[```kotlin
/**
 * [SYS_BRK_0042] Sensor noise filtering
 *
 * Scenario: Reject transient noise
 *   Given a raw sensor input of 512
 *   And a noise spike of 50 lasting 2ms
 *   When the debounce window is 5ms
 *   Then the output shall remain 512
 *
 * Id: SYS_01HGW2P4KFR7\
 * Satisfies: STK_BRK_0001\
 * Labels: ASIL-B
 */
@Test
fun `sit_brk_0042 reject transient noise`() {
    val sensor = SensorDriver(debounceMs = 5)
    sensor.feed(512, spikeOf(50, durationMs = 2))
    assertEquals(512, sensor.output())
}
```]

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

`---` = slide break. H2 starts each slide.

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
  table.header[*NS*][*Example*],
  [`req`], [`{{req.SRS_BRK_0107}}`],
  [`arch`], [`{{arch.SAD_BRK_0001}}`],
  [`test`], [`{{test.SWT_BRK_0107}}`],
  [`ref`], [`{{ref.ISO-26262-6}}`],
  [`fig`], [`{{fig.system-overview}}`],
  [`tbl`], [`{{tbl.sensor-thresholds}}`],
  [`h`], [`{{h.section-heading}}`],
)

= Reference entries

Only in `references` document type. Display ID = slug.

#code[```markdown
- [ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional
  safety — Part 6: Software.

  Document: ISO 26262-6:2018\
  URL: https://www.iso.org/...
```]

== Reference attributes

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + luma(180),
  inset: 3pt,
  table.header[*Attribute*][*Description*],
  [`Document`], [Full document ID],
  [`URL`], [Canonical URL],
  [`Status`], [active / withdrawn / superseded],
  [`Superseded-by`], [Replacement entry ID],
  [`Derived-from`], [Parent standard],
)

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
