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
      Type: requirement
      Derived-from: SRS_BRK_0042
      Labels: ASIL-B
```]

Structure: title · body (optional) · trailer (4+ space indent).
No `_emphasis_` inside entries. `**Strong**` and `` `code` `` ok.

== Two shapes (single `Id:`)

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + luma(180),
  inset: 3pt,
  table.header[*Shape*][*`Id:` value*],
  [Authored], [Bare ULID — assigned by `format`],
  [Reference], [URI: `urn:` `doi:` `pkg:` `https:`],
)

#code[```text
Id: 01HGW2P4KFR7ABCDEFGHJKMNPQ
Id: urn:iso:std:iso:26262:-6:ed-2
Id: doi:10.1109/IEEESTD.2018.8299595
Id: pkg:cargo/serde@1.0.197
Id: https://www.rfc-editor.org/rfc/rfc2119
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

Fenced `feature` block — analysed as full Gherkin:

#code[````markdown
- [SWT_BRK_0030] Debounce rejects short pulses

  ```feature
  Scenario: Spike shorter than window
    Given a debounce window of 10 ms
    When a pulse of 5 ms arrives
    Then the output remains unchanged
  ```

      Id: 01HGW3R9QNP4ABCDEFGHJKMNPQ
      Type: test
      Verifies: SRS_BRK_0107
````]

== In-code entries

#code[```kotlin
/**
 * [SWT_BRK_0030] Debounce test
 *
 *     Id: 01HGW3R9QNP4ABCDEFGHJKMNPQ
 *     Type: test
 *     Verifies: SRS_BRK_0107
 */
@Test fun debounce() { }
```]

Rust `///` or `/** */`. Kotlin · Java · C/C++ · TS/JS · C\# use `/** */`.

#colbreak()

= Universal attributes

Apply to every entry (both shapes).

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + luma(180),
  inset: 3pt,
  table.header[*Attr*][*Description*],
  [`Id`], [ULID or URI; required],
  [`Type`], [Core or profile-declared type],
  [`Labels`], [Free-form tags (`DRAFT`, …)],
  [`References`], [Cite referenced entries (locator ok)],
  [`External-id`], [Cross-system identifier],
  [`Supersedes`], [Same-shape predecessor (Authored only)],
  [`Superseded-by`], [Generated inverse],
  [`Deprecated`], [Retirement reason],
  [`Discipline`], [Author-asserted discipline kind],
  [`Discipline-frozen`], [Cached derivation snapshot],
)

= typl bindings

Declare typed identifiers in entry bodies: `$Name : kind shape`.

== Three surfaces

Fence — multiple bindings + typedefs:

#code[```typl
type Track = { id: int, range_m: float[0..300] }
$Track   : signal Track
$CycleHz : const int[10]
```]

Bullet — annotate list items:

#code[```markdown
- $Window : config int[1..50]
- $Stable : signal bool
```]

Inline — one identifier in prose:

#code[```markdown
Gain `$Gain : signal float[0.5..2.0]` selected.
```]

== Kinds (closed set)

`value` (default) · `event` · `signal` · `command` · `state` · `const` · `config` · `document` · `stream`

== Shapes

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + luma(180),
  inset: 3pt,
  table.header[*Example*][*Shape*],
  [`int` `float` `bool` `string` `bytes`], [primitive],
  [`int[0..300]` `int[42]`], [range / literal],
  [`string[3..6]` `bytes[32]`], [length],
  [`pattern /^[A-Z]{3}$/`], [regex],
  [`int[]` `float[](1..64)`], [array],
  [`'low' | 'mid' | 'high'`], [enum],
  [`{ id: int, msg: string }`], [record],
  [`Track`], [typedef ref],
  [`int?` `string[32]?`], [optional],
)

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

`---` = slide break. `##` starts each slide.

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

`@slug` convention — the `@` is stripped from the display ID
(`@ISO-26262-6` → `ISO-26262-6`). Body optional.

#code[```markdown
- [@ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional safety
  — Part 6: Software.

      Id: urn:iso:std:iso:26262:-6:ed-2
      Reference-document: ISO 26262-6:2018
      Reference-url: https://www.iso.org/...
      License: ISO-proprietary
      Labels: functional-safety
```]

`Id:` schemes: `urn:` `doi:` `pkg:` `https:`. `Id:` and `Type:`
are core; `Reference-*` and `License` are default-profile.

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
