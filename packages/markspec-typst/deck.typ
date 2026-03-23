// MarkSpec slide deck theme — Touying-based 16:9 presentations.
//
// Usage:
//   #import "@preview/touying:0.6.1": *
//   #import "@driftsys/markspec:0.1.0": markspec-deck, markspec-title-slide, markspec-focus-slide
//
//   #show: markspec-deck.with(aspect-ratio: "16-9")
//
//   #markspec-title-slide(
//     title: [My Presentation],
//     subtitle: [Subtitle],
//   )
//
//   == First Slide
//   Content with #pause animation.
//   #speaker-note[Remember to mention X.]

#import "@preview/touying:0.6.1": *
#import "tokens.typ": *
#import "themes/light.typ" as light

/// Main theme function — apply with `#show: markspec-deck.with(...)`.
///
/// Heading-based slide detection:
/// - `= Section` creates a section divider
/// - `== Slide Title` creates a content slide
///
/// All Touying primitives work: `#pause`, `#speaker-note`, `#uncover`, etc.
#let markspec-deck(
  aspect-ratio: "16-9",
  dark: false,
  ..args,
  body,
) = {
  let t = if dark { import "themes/dark.typ"; dark } else { light }

  show: touying-slides.with(
    config-page(
      paper: "presentation-" + aspect-ratio,
      margin: (x: slide-margin-x, y: slide-margin-y),
      fill: t.bg,
    ),
    config-colors(
      primary: t.accent,
      secondary: t.secondary,
      neutral: t.text,
    ),
    ..args,
  )

  // ── Typography ────────────────────────────────────────────────────────

  set text(font: font-sans, size: 24pt, fill: t.text, lang: "en")

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

  body
}

/// Title slide — centered project metadata.
#let markspec-title-slide(
  title: none,
  subtitle: none,
  date: datetime.today(),
  classification: none,
) = touying-slide-wrapper(self => {
  let colors = self.colors
  touying-slide(self: self, repeat: 1)[
    #align(center + horizon)[
      #text(size: 48pt, weight: "semibold", title)
      #if subtitle != none {
        v(space-2)
        text(size: 24pt, fill: colors.secondary, subtitle)
      }
      #v(space-4)
      #text(size: 18pt, fill: colors.secondary, date.display("[year]-[month]-[day]"))
      #if classification != none {
        v(space-6)
        text(size: 18pt, weight: "semibold", fill: colors.primary, classification)
      }
    ]
  ]
})

/// Focus slide — accent background, large centered text.
#let markspec-focus-slide(body) = touying-slide-wrapper(self => {
  let colors = self.colors
  touying-slide(self: self, repeat: 1, setting: content => {
    set page(fill: colors.primary)
    content
  })[
    #set text(fill: white, size: 36pt, weight: "semibold")
    #align(center + horizon, body)
  ]
})
