// MarkSpec slide deck template — 16:9 presentations.
// Designed for use with Touying or standalone.

#import "tokens.typ": *
#import "themes/light.typ" as theme

#let markspec-deck(
  title: none,
  subtitle: none,
  date: datetime.today(),
  classification: none,
  dark: false,
  body,
) = {
  let t = if dark { import "themes/dark.typ"; dark } else { theme }

  set page(
    width: 254mm,
    height: 142.9mm,
    margin: (x: slide-margin-x, y: slide-margin-y),
    fill: t.bg,
    footer: {
      set text(size: 14pt, fill: t.secondary)
      h(1fr)
      counter(page).display()
    },
  )

  set text(
    font: font-sans,
    size: 24pt,
    fill: t.text,
    lang: "en",
  )

  show heading.where(level: 1): set text(size: 48pt, weight: "semibold")
  show heading.where(level: 2): set text(size: 36pt, weight: "semibold")

  show raw: set text(font: font-mono, size: 20pt)
  show raw.where(block: true): block.with(
    fill: t.bg-code,
    stroke: 0.5pt + t.border,
    radius: 3pt,
    inset: space-4,
    width: 100%,
  )

  show link: set text(fill: t.accent)

  // Title slide
  if title != none {
    set page(footer: none)
    align(center + horizon)[
      #text(size: 48pt, weight: "semibold", title)
      #if subtitle != none {
        v(space-2)
        text(size: 24pt, fill: t.secondary, subtitle)
      }
      #v(space-4)
      #text(size: 18pt, fill: t.secondary, date.display("[year]-[month]-[day]"))
      #if classification != none {
        v(space-6)
        text(size: 18pt, weight: "semibold", fill: t.accent, classification)
      }
    ]
    pagebreak()
  }

  body
}
