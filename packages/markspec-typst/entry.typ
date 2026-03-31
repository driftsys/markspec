// Requirement entry styling — visually distinct blocks for
// requirement entries in rendered documents.

#import "tokens.typ": *

/// Render a requirement entry with distinct styling.
///
/// - id: Display ID string (e.g., "SRS_BRK_0001")
/// - title: Entry title
/// - body: Body content as Typst content
/// - attrs: Array of (key, value) pairs for the attribute table
#let markspec-entry(id, title, body, attrs, theme) = {
  block(
    width: 100%,
    inset: (left: space-3, top: space-2, bottom: space-2, right: space-2),
    stroke: (left: 2pt + theme.accent),
    below: space-4,
    above: space-4,
  )[
    // ID line — monospace, accent color, small
    #text(font: font-mono, size: size-small, fill: theme.accent, id)
    #h(space-2)
    // Title — semibold
    #text(weight: "semibold", title)

    // Body
    #if body != none and body != [] {
      v(space-1)
      body
    }

    // Attributes — compact table with light background
    #if attrs.len() > 0 {
      v(space-2)
      block(
        width: 100%,
        fill: theme.bg-code,
        radius: 2pt,
        inset: space-2,
      )[
        #set text(size: size-small)
        #for (i, attr) in attrs.enumerate() {
          let (key, value) = attr
          text(weight: "semibold", key)
          h(space-1)
          text(font: font-mono, value)
          if i < attrs.len() - 1 {
            linebreak()
          }
        }
      ]
    }
  ]
}
