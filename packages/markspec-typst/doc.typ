// MarkSpec document template — A4 PDF output.

#import "tokens.typ": *
#import "themes/light.typ" as theme

#let markspec-doc(
  title: none,
  project: "MarkSpec",
  version: none,
  date: datetime.today(),
  classification: none,
  dark: false,
  body,
) = {
  let t = if dark { import "themes/dark.typ"; dark } else { theme }

  set page(
    paper: page-size,
    margin: page-margin,
    fill: t.bg,
    header: context {
      if counter(page).get().first() > 1 {
        set text(size: size-footer, fill: t.secondary)
        title
        h(1fr)
        counter(page).display()
        line(length: 100%, stroke: 0.5pt + t.border)
      }
    },
    footer: {
      set text(size: size-footer, fill: t.secondary)
      [#project #version]
      h(1fr)
      date.display("[year]-[month]-[day]")
      v(-2pt)
      line(length: 100%, stroke: 0.5pt + t.border)
    },
  )

  set text(
    font: font-sans,
    size: size-body,
    fill: t.text,
    lang: "en",
  )

  set par(leading: leading-body, spacing: space-3)

  show heading.where(level: 1): set text(size: size-h1, weight: "semibold")
  show heading.where(level: 2): set text(size: size-h2, weight: "semibold")
  show heading.where(level: 3): set text(size: size-h3, weight: "semibold")
  show heading.where(level: 4): set text(size: size-h4, weight: "semibold")

  show raw: set text(font: font-mono, size: size-code)
  show raw.where(block: true): block.with(
    fill: t.bg-code,
    stroke: 0.5pt + t.border,
    radius: 3pt,
    inset: space-3,
    width: 100%,
  )

  show link: set text(fill: t.accent)

  // Cover page
  if title != none {
    set page(header: none, footer: none)
    align(center + horizon)[
      #text(size: 28pt, weight: "semibold", title)
      #v(space-4)
      #if version != none {
        text(size: size-h4, fill: t.secondary, version)
      }
      #v(space-2)
      #text(size: size-body, fill: t.secondary, date.display("[year]-[month]-[day]"))
      #v(4em)
      #if classification != none {
        text(size: size-body, weight: "semibold", fill: t.accent, classification)
      }
    ]
    pagebreak()
  }

  body
}
