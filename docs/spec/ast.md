# MarkSpec AST Extensions

This document specifies the MarkSpec abstract syntax tree extensions. The input
is a standard [mdast] tree produced by a CommonMark parser (remark). The
MarkSpec transform walks the tree and promotes recognized patterns into
extension nodes. Unrecognized nodes pass through unchanged.

The transform is a single post-processing pass over an already-parsed mdast
tree. It does not modify the parser grammar — it pattern-matches on existing
node types.

---

## Conventions

- **mdast** refers to the [Markdown Abstract Syntax Tree][mdast] specification.
- Node types use `camelCase` with an `ms` prefix (e.g., `msEntry`).
- Extension nodes replace the original mdast nodes in the tree. The original
  children are redistributed into the extension node's fields.
- All position information (`position` field) is preserved from the original
  nodes.
- Extension nodes are `Parent` nodes — they can be walked by any
  mdast-compatible visitor. Unknown node types are skipped by standard tools but
  readable by MarkSpec tools.

---

## §1 Entry block — `msEntry`

### Detection

The transform inspects every `list` node in the tree. For each `listItem` child,
it applies the following decision procedure:

```
listItem
  │
  ├─ Parent list is ordered?                           → Skip.
  ├─ Parent list is nested (depth > 1)?                → Skip.
  ├─ First child is not a paragraph?                   → Skip.
  │
  ├─ First inline of paragraph is a link node?         → Inline link. Skip.
  │     (mdast type: link — e.g., [text](url))
  │
  ├─ First inline of paragraph is a linkReference      → Reference link. Skip.
  │   with referenceType "full" or "collapsed"?
  │     (mdast type: linkReference — e.g., [text][ref] or [text][])
  │
  ├─ First inline of paragraph is a linkReference      → Shortcut ref link
  │   with referenceType "shortcut", AND a matching       resolved by
  │   definition node exists in the document?              definition. Skip.
  │     (e.g., [text] with [text]: url elsewhere)
  │
  ├─ Bracket content matches /^\[[ xX]\]/              → Task list item. Skip.
  │     (GFM checkbox)
  │
  ├─ listItem has no children beyond the first          → No body. Skip.
  │   paragraph? (single paragraph, no continuation)
  │
  ├─ Bracket content matches typed entry pattern        → msEntry (typed)
  │   /^[A-Z]+_[A-Z]{2,12}_\d{3,4}$/
  │
  ├─ Bracket content matches reference entry pattern    → msEntry (reference)
  │   /^[A-Za-z0-9-]+$/ AND document type is
  │   "references"
  │
  └─ Otherwise                                         → Normal listItem.
                                                         Skip.
```

**"Has body"** means the `listItem` contains children beyond the opening
paragraph. In mdast terms: `listItem.children.length > 1`, or the first
paragraph is followed by additional block-level content (paragraphs,
blockquotes, code blocks, etc.) at the list item's indentation level.

**"Depth > 1"** means the `list` node's parent chain includes another
`listItem`. Entry blocks must be top-level list items — nested list items are
never promoted.

**Link resolution** relies on the mdast tree. A CommonMark parser resolves
`[text]` shortcut references against `definition` nodes in the same document. If
the parser produced a `linkReference` node (of any `referenceType`) whose
`identifier` matches a `definition` node, the bracket content is a link — not an
entry candidate.

### Node type

```typescript
interface MsEntry extends mdast.Parent {
  type: "msEntry";
  entryKind: "typed" | "reference";
  displayId: string;
  title: MsEntryTitle;
  body: mdast.BlockContent[];
  attributes: MsAttribute[];
}

interface MsEntryTitle extends mdast.Parent {
  type: "msEntryTitle";
  children: mdast.PhrasingContent[];
}

interface MsAttribute {
  key: string;
  value: string;
  position: mdast.Position;
}
```

**Fields:**

| Field        | Source                                                            |
| ------------ | ----------------------------------------------------------------- |
| `entryKind`  | `"typed"` if display ID matches typed pattern, else `"reference"` |
| `displayId`  | Text content inside `[...]` brackets                              |
| `title`      | Inline content after the closing `]` on the first line            |
| `body`       | All block-level children between title and attribute block        |
| `attributes` | Parsed from the trailing `Key: Value\` lines                      |

### Attribute block extraction

The last paragraph in the `listItem` body is inspected for attribute lines. A
paragraph is an attribute block when every line matches:

```
Key: Value[\]
```

Where `Key` is a capitalized word (`[A-Z][a-z-]*`), `:` is the separator,
`Value` is the remainder, and `\` is an optional trailing backslash (line
continuation). The last line has no backslash.

If the trailing paragraph is an attribute block, it is removed from `body` and
its lines are parsed into `MsAttribute` entries. If it is not an attribute
block, `attributes` is empty and the paragraph stays in `body`.

### Examples

**Input mdast (simplified):**

```
list (unordered, depth 0)
  listItem
    paragraph
      text "[SRS_BRK_0001] Sensor debouncing"
    paragraph
      text "The sensor driver shall debounce..."
    paragraph
      text "Id: SRS_01HGW2Q8MNP3\"
      softBreak
      text "Satisfies: SYS_BRK_0042\"
      softBreak
      text "Labels: ASIL-B"
```

**Output:**

```
msEntry (typed)
  displayId: "SRS_BRK_0001"
  title
    text "Sensor debouncing"
  body
    paragraph
      text "The sensor driver shall debounce..."
  attributes
    { key: "Id", value: "SRS_01HGW2Q8MNP3" }
    { key: "Satisfies", value: "SYS_BRK_0042" }
    { key: "Labels", value: "ASIL-B" }
```

**Not promoted — inline link:**

```markdown
- [See documentation](https://example.com) for details.
```

mdast: `listItem > paragraph > link`. First inline is a `link` node → skip.

**Not promoted — shortcut reference link with definition:**

```markdown
- [CommonMark] is the baseline grammar.

[CommonMark]: https://commonmark.org
```

mdast: `listItem > paragraph > linkReference (shortcut)`. A `definition` node
with identifier `commonmark` exists → skip.

**Not promoted — nested list item:**

```markdown
- Parent item
  - [SRS_BRK_0002] This is nested

    Body text.

    Id: SRS_01HGW2R9QLP4
```

The inner `list` has depth > 1 (parent chain includes a `listItem`) → skip.

**Not promoted — no body:**

```markdown
- [SRS_BRK_0003] Title only, no indented content
```

`listItem.children.length === 1` (single paragraph) → skip.

---

## §2 Attribute block — `msAttributeBlock`

Attribute blocks are always extracted as part of `msEntry` detection (§1). They
do not exist as standalone nodes — they are a structural component of an entry
block.

When an entry block is detected, the trailing paragraph is tested for the
attribute pattern. If it matches, it is consumed into the `msEntry.attributes`
array and removed from the tree.

Outside of entry blocks, `Key: Value\` paragraphs are not recognized as
attribute blocks — they remain normal paragraphs.

---

## §3 Table caption — `msTableCaption`

### Detection

A paragraph node containing a single `emphasis` child whose text content starts
with `Table:` and is immediately followed by a `table` sibling node.

"Immediately followed" means the `table` is the next sibling in the parent's
children array — no intervening block nodes.

### Node type

```typescript
interface MsTableCaption extends mdast.Parent {
  type: "msTableCaption";
  slug: string;
  caption: mdast.PhrasingContent[];
  table: mdast.Table;
}
```

**Fields:**

| Field     | Source                                                    |
| --------- | --------------------------------------------------------- |
| `slug`    | `tbl.` + GFM anchor of caption text after `Table:` prefix |
| `caption` | Inline content after stripping `Table:` prefix            |
| `table`   | The sibling `table` node, reparented under this node      |

The `msTableCaption` node replaces both the caption paragraph and the `table`
node in the parent's children array.

### Example

```markdown
_Table: Sensor thresholds_

| Sensor   | Min | Max  |
| -------- | --- | ---- |
| Pressure | 0   | 1023 |
```

**Output:**

```
msTableCaption
  slug: "tbl.sensor-thresholds"
  caption: [text "Sensor thresholds"]
  table: (the pipe table node)
```

**Not promoted:**

```markdown
_This is just italic text._

| Column A | Column B |
| -------- | -------- |
```

Emphasis text does not start with `Table:` → both nodes unchanged.

---

## §4 Figure caption — `msFigureCaption`

### Detection

An `image` node followed by a paragraph containing a single `emphasis` child
whose text content starts with `Figure:`. Alternatively, an `image` node with
non-empty `alt` text and no explicit caption paragraph.

"Followed by" means the caption paragraph is the next sibling after the `image`
node — no intervening block nodes.

### Node type

```typescript
interface MsFigureCaption extends mdast.Parent {
  type: "msFigureCaption";
  slug: string;
  caption: mdast.PhrasingContent[];
  image: mdast.Image;
}
```

**Fields:**

| Field     | Source                                                   |
| --------- | -------------------------------------------------------- |
| `slug`    | `fig.` + GFM anchor of caption text                      |
| `caption` | Explicit: inline content after `Figure:`. Alt: alt text. |
| `image`   | The `image` node, reparented under this node             |

Explicit caption takes precedence over alt text.

### Example

```markdown
![System overview](overview.svg)

_Figure: High-level architecture of the braking system_
```

**Output:**

```
msFigureCaption
  slug: "fig.high-level-architecture-of-the-braking-system"
  caption: [text "High-level architecture of the braking system"]
  image: (the image node)
```

---

## §5 Directive — `msDirective`

### Detection

An `html` node (HTML comment) whose content contains one or more lines starting
with `markspec:`.

### Node type

```typescript
interface MsDirective extends mdast.Literal {
  type: "msDirective";
  directives: MsDirectiveEntry[];
}

interface MsDirectiveEntry {
  name: string;
  payload: string;
  position: mdast.Position;
}
```

**Fields:**

| Field        | Source                                               |
| ------------ | ---------------------------------------------------- |
| `directives` | One entry per `markspec:` line in the comment        |
| `name`       | Token after `markspec:` (e.g., `deck`, `references`) |
| `payload`    | Remainder of line + continuation lines               |

### Parsing rules

1. Scan the `html` node value for lines starting with `markspec:`.
2. Token after `markspec:` is the directive name.
3. Remainder of line is the start of the payload.
4. Subsequent lines not starting with `markspec:` are payload continuation.
5. A new `markspec:` line or end of comment (`-->`) terminates the payload.

### Example

```markdown
<!--
markspec:deck
markspec:deprecated Superseded by braking-v2.md which
  implements the revised sensor interface.
-->
```

**Output:**

```
msDirective
  directives:
    { name: "deck", payload: "" }
    { name: "deprecated", payload: "Superseded by braking-v2.md which\n  implements the revised sensor interface." }
```

Range directives (`markspec:columns`, `markspec:disable`, `markspec:ignore`)
produce a start `msDirective` and are closed by a separate `msDirective` node
containing `markspec:end NAME`. The transform does not pair them into a single
range node — range matching is a validation concern, not a parse concern.

---

## §6 Inline reference — `msInlineRef`

### Detection

A `text` node containing `{{namespace.id}}` patterns. The text node is split
into alternating `text` and `msInlineRef` nodes.

References inside `code` and `inlineCode` nodes are not detected — they render
as literal text.

### Node type

```typescript
interface MsInlineRef extends mdast.Literal {
  type: "msInlineRef";
  namespace: string;
  refId: string;
}
```

**Fields:**

| Field       | Source                                  |
| ----------- | --------------------------------------- |
| `namespace` | Text before the first `.` inside `{{}}` |
| `refId`     | Text after the first `.` inside `{{}}`  |

### Example

```markdown
This module implements {{req.SRS_BRK_0107}}.
```

**Output:**

```
paragraph
  text "This module implements "
  msInlineRef
    namespace: "req"
    refId: "SRS_BRK_0107"
  text "."
```

---

## Transform order

The transform processes the tree in a single depth-first pass, in this order:

1. **Directives** (§5) — HTML comments → `msDirective`. Must run first so that
   `markspec:ignore` ranges can suppress subsequent transforms.
2. **Entry blocks** (§1) — list items → `msEntry`. Depends on link `definition`
   nodes being present (they are never removed).
3. **Table captions** (§3) — emphasis + table pairs → `msTableCaption`.
4. **Figure captions** (§4) — image + emphasis pairs → `msFigureCaption`.
5. **Inline references** (§6) — `{{...}}` in text nodes → `msInlineRef`.

Steps 3 and 4 are independent and could run in either order. Step 5 runs last
because it operates on `text` nodes inside any parent — including inside
`msEntry` body content.

---

## Non-goals

- **In-code entries** (doc comments in source files) are handled by a separate
  source parser (`core/parser/source.ts`), not by the mdast transform. The
  source parser produces the same `MsEntry` data structure but extracts it from
  tree-sitter ASTs, not mdast.
- **Validation** (MSL rules) is not part of the AST transform. The transform
  produces the extended tree; the validator inspects it.
- **Formatting** (ULID stamping, attribute normalization) operates on the
  extended tree but is a separate pass.

---

[mdast]: https://github.com/syntax-tree/mdast
