# ADR-001: Markdown format

Status: Accepted\
Date: 2026-03-01\
Scope: MarkSpec

## Context

MarkSpec needs a documentation format that is simple, portable, Git-native, and
readable without tooling. The format must support compliance documentation while
staying true to the "simplicity as a discipline" principle.

Several formats were evaluated: Markdown, AsciiDoc, and Typst. AsciiDoc offers
richer semantics but introduces authoring complexity. Typst is powerful for PDF
rendering but its primary role is typesetting, not authoring. Markdown is
universally known, rendered by every platform, and has the lowest barrier to
entry.

The key insight is that the richness belongs in the tooling layer, not in the
document format. Markdown stays pure. The build pipeline adds what's needed.

## Decision

### Authoring format

The documentation format is **CommonMark** extended with the shared subset of
GFM (GitHub Flavored Markdown) and GLFM (GitLab Flavored Markdown). Only
extensions supported by both platforms are used. This ensures portability across
GitHub and GitLab with no degradation.

Platform-specific extensions (GitLab TOC, GitLab includes, GitLab placeholders,
GitHub-only features) are not used. These capabilities are handled by tooling
instead.

### CommonMark baseline

All standard CommonMark features are supported:

- Headings
- Bold / italic
- Links / images
- Blockquotes
- Ordered / unordered lists
- Fenced code blocks
- Inline code
- Horizontal rules
- Inline HTML (`<details>`, `<summary>`, `<kbd>`, etc.)

### GFM / GLFM shared extensions

The following extensions beyond CommonMark are supported on both GitHub and
GitLab:

1. Tables (pipe syntax)
2. Strikethrough (`~~text~~`)
3. Task lists (`- [ ]` / `- [x]`)
4. Footnotes (`[^label]`)
5. Autolinks
6. Syntax highlighting (`` ```rust ``)
7. Math (`$inline$` and `$$block$$`)
8. Alerts (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`,
   `> [!CAUTION]`)

### Admonitions

Standard alerts are used without custom titles to maintain cross-platform
compatibility. The five supported types are NOTE, TIP, IMPORTANT, WARNING, and
CAUTION.

When a custom title is needed, bold text inside a standard alert is the portable
pattern:

```markdown
> [!WARNING]
> **Data deletion** — The following instructions will make your data
> unrecoverable.
```

Additional semantic admonition types (e.g., SAFETY, RATIONALE, REVIEW) may be
defined by tooling and rendered as styled blocks in PDF output. These use the
same `> [!TYPE]` syntax and degrade to plain blockquotes on platforms that don't
recognize them.

### Variable substitution

**Mustache** (`{{variable}}`) is the templating syntax for variable and ID
substitution in Markdown documents. Mustache is logic-less by design — no
conditionals, no control flow, just key-value lookup. If logic is needed, it
belongs in the build step, not the template.

Variables are resolved from the project's tooling or from document front matter.
Examples: `project.name`, `project.version`, `project.asil`, `project.repo`,
`project.home`, `project.modules`, `module.name`, `module.owner`.

```markdown
# {{module.name}}

Project: {{project.name}} | ASIL: {{project.asil}} | Version:
{{project.version}}
```

### Footnotes

Footnotes are reserved for supplementary context — external standard references,
design rationale, or clarifications. They are not used for traceability.

```markdown
The fault handler shall complete within the watchdog window.[^1]

[^1]: See ISO 26262 Part 6, Section 9.4 for guidance on fault handling timing.
```

### Line breaks

When consecutive lines need to render as separate lines (e.g., attribute
blocks), trailing backslash (`\`) or blank lines are used for line separation.
Both are valid CommonMark. Teams choose their convention.

Trailing backslash is recommended when compactness matters — it keeps lines
grouped as a visual block. Blank lines between lines are acceptable for shorter
or less dense content.

Trailing double-space is not recommended — it is invisible in source, stripped
by most editors, and does not survive formatting or linting.

### Document metadata and review

Git history is the metadata. A merged PR/MR captures authorship, review,
approval, timestamp, and diff. No `status: approved` frontmatter that can drift
from reality. The merge commit is the approval record.

### Color palettes

#### Monochrome palette (default)

Use this palette by default. It works in every context — screen, print, PDF,
light mode, dark mode.

| Role           | Color       | Hex       | Use                            |
| -------------- | ----------- | --------- | ------------------------------ |
| Primary stroke | Black       | `#000000` | Lines, borders, text           |
| Primary fill   | White       | `#FFFFFF` | Backgrounds, containers        |
| Secondary fill | Light gray  | `#E0E0E0` | Inactive elements, grouping    |
| Tertiary fill  | Medium gray | `#9E9E9E` | De-emphasized elements         |
| Accent fill    | Dark gray   | `#424242` | Highlighted elements, emphasis |

**PlantUML monochrome theme:**

```plantuml
skinparam monochrome true
skinparam shadowing false
skinparam defaultFontName Arial
skinparam defaultFontSize 13
skinparam backgroundColor #FFFFFF
skinparam ArrowColor #000000
skinparam ArrowThickness 1.5
```

#### Color palette (when needed)

Based on the Okabe-Ito palette (Wong, Nature Methods 2011). This is the gold
standard for colorblind-safe scientific figures and is recommended by Nature
journals.

Use color sparingly — only when it adds meaning that monochrome cannot convey.
Limit to 3–4 colors per diagram.

| Role             | Color        | Hex       | Use                                     |
| ---------------- | ------------ | --------- | --------------------------------------- |
| Primary          | Blue         | `#0072B2` | Default accent, primary elements        |
| Alert / critical | Vermillion   | `#D55E00` | Warnings, safety-critical paths, errors |
| Success / safe   | Bluish green | `#009E73` | Verified, passing, safe states          |
| Highlight        | Orange       | `#E69F00` | Attention, in-progress, pending         |
| Secondary        | Sky blue     | `#56B4E9` | Secondary elements, backgrounds         |
| Neutral          | Black        | `#000000` | Text, strokes, borders                  |

#### Usage guidelines

- **Default to monochrome.** Only add color when it carries meaning.
- **Never rely on color alone.** Always pair color with another visual cue —
  stroke weight, pattern, label, or shape.
- **Limit to 3–4 colors per diagram.** Beyond that, readers cannot reliably
  distinguish categories.
- **Test in grayscale.** If the diagram is unreadable in grayscale, rethink the
  use of color.
- **Avoid red-green pairings.** The Okabe-Ito palette avoids this by design —
  use vermillion and bluish green instead.

## Consequences

- Markdown stays pure GFM/GLFM — no custom syntax, no dialect, no learning
  curve.
- All richness (variables, rendering) lives in the tooling layer.
- Documents are readable raw and rendered correctly on GitHub and GitLab.
- The format is portable across GitHub and GitLab with no degradation.
- Color palettes are colorblind-safe and grayscale-compatible.
