// MarkSpec entry block rendering — admonition-style requirement blocks.

#import "tokens.typ": *

/// Resolve the theme color for an entry type.
///
/// - type (str): one of "req", "spec", "test"
/// - theme (module): a theme module with entry-req, entry-spec, entry-test
/// -> color
#let entry-color(type, theme) = {
  if type == "spec" { theme.entry-spec }
  else if type == "test" { theme.entry-test }
  else { theme.entry-req }
}

/// Map an entry type prefix to its color category.
///
/// - prefix (str): e.g. "STK", "SYS", "SWE", "SRS", "ARC", "ICD", "TST", etc.
/// -> str: "req", "spec", or "test"
#let entry-category(prefix) = {
  if prefix in ("ARC", "SAD", "ICD") { "spec" }
  else if prefix in ("TST", "VAL", "SIT", "SWT") { "test" }
  else { "req" }
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
#let cross-ref(target) = {
  link(label(target))[
    #underline(
      stroke: (dash: "dashed", paint: luma(200), thickness: 0.5pt),
      offset: 2pt,
      target,
    )
  ]
}

/// Render a full entry block with admonition-style left border.
///
/// - type (str): color category — "req", "spec", or "test"
/// - display-id (str): human-readable display ID (e.g. "SWE_BRK_0107")
/// - title (str): entry title
/// - body (content): body content
/// - attrs (array): array of (key, value) pairs for the metadata line
/// - labels (array): array of label strings for pill rendering
/// - theme (module): theme module for colors
/// -> content
#let req-block(
  type: "req",
  display-id: "",
  title: "",
  body: [],
  attrs: (),
  labels: (),
  theme: none,
) = {
  let color = entry-color(type, theme)

  block(
    stroke: (left: 2pt + color),
    inset: (left: 12pt, top: 0pt, bottom: 4pt, right: 0pt),
    width: 100%,
    {
      // Title line
      {
        text(size: size-body, weight: "medium", fill: color, display-id)
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

      // Body
      if body != [] and body != "" {
        v(space-1)
        text(size: size-body, body)
      }

      // Metadata line
      if attrs.len() > 0 {
        v(space-2)
        set text(size: size-small, style: "italic", fill: theme.secondary)
        let traceability-keys = ("Satisfies", "Verifies", "Derived-from")
        let parts = ()
        for (key, value) in attrs {
          if key in traceability-keys {
            // Split comma-separated references
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
