// MarkSpec entry block rendering — admonition-style requirement blocks.

#import "tokens.typ": *

/// Resolve the theme color for an entry.
///
/// - color (str | none): a palette hue name ("blue", "cyan", "teal",
///   "orange", "red", "purple", "grey") or `none` for an uncolored block.
/// - theme (module): a theme module that exports `entry-<hue>` colors.
/// -> color | none
#let entry-color(color, theme) = {
  if color == none { none }
  else if color == "blue" { theme.entry-blue }
  else if color == "cyan" { theme.entry-cyan }
  else if color == "teal" { theme.entry-teal }
  else if color == "orange" { theme.entry-orange }
  else if color == "red" { theme.entry-red }
  else if color == "purple" { theme.entry-purple }
  else if color == "grey" { theme.entry-grey }
  else { theme.entry-blue }  // fallback for unexpected input
}

/// Render a label pill (rounded badge).
///
/// - label (str): label text (e.g. "ASIL-B")
/// - theme (module): theme module for colors
/// -> content
#let pill(label, theme) = box(
  fill: theme.bg-code,
  radius: 9pt,
  inset: (x: 7pt, y: 1pt),
  text(size: size-small, weight: "medium", fill: theme.secondary, label),
)

/// Render a cross-reference link with dashed underline.
///
/// - target (str): display ID of the referenced entry
/// -> content
///
/// Note: internal link navigation requires entry blocks to emit labeled
/// anchors — that is a follow-up concern. For now the dashed-underline
/// style is applied without a live link destination.
#let cross-ref(target) = underline(
  stroke: (dash: "dashed", paint: luma(200), thickness: 0.5pt),
  offset: 2pt,
  target,
)

/// Render a full entry block with admonition-style left border.
///
/// - color (str | none): palette hue name or `none` for uncolored.
/// - display-id (str): human-readable display ID (e.g. "SWE_BRK_0107").
/// - title (str): entry title
/// - body (content): body content
/// - attrs (array): array of (key, value) pairs for the metadata line
/// - labels (array): array of label strings for pill rendering
/// - theme (module): theme module for colors
/// -> content
#let req-block(
  color: none,
  display-id: "",
  title: "",
  body: [],
  attrs: (),
  labels: (),
  theme: none,
) = {
  let resolved = entry-color(color, theme)

  block(
    stroke: if resolved == none { none } else { (left: 2pt + resolved) },
    inset: (left: 12pt, top: 0pt, bottom: 4pt, right: 0pt),
    width: 100%,
    {
      // Title line
      {
        let id-fill = if resolved == none { theme.text } else { resolved }
        text(size: size-body, weight: "medium", fill: id-fill, display-id)
        h(6pt)
        text(size: size-body, weight: "medium", title)
        if labels.len() > 0 {
          h(6pt)
          box({
            for (i, label) in labels.enumerate() {
              if i > 0 { h(4pt) }
              pill(label, theme)
            }
          })
        }
      }

      // Body (unchanged)
      if body != [] and body != "" {
        v(space-1)
        text(size: size-body, body)
      }

      // Metadata line (unchanged)
      if attrs.len() > 0 {
        v(space-2)
        set text(size: size-small, style: "italic", fill: theme.secondary)
        let traceability-keys = ("Satisfies", "Verifies", "Derived-from")
        let parts = ()
        for (key, value) in attrs {
          if key in traceability-keys {
            let refs = value.split(",").map(s => s.trim())
            let linked = refs.map(r => cross-ref(r))
            parts.push([#key: #linked.join([, ])])
          } else {
            parts.push([#key: #value])
          }
        }
        parts.join[ #sym.dot.c ]
      }
    },
  )
}
