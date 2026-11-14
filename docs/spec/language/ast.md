# MarkSpec AST Extensions

> **Status (2026-04-23): partially updated.** The `entryKind` field has been
> renamed to `shape` with values `identified | referenced`. Entry-identity uses
> a single `Id:` attribute (ULID or URI). Examples below reflect these changes.
> The AST node interface (`MsEntry`) has not yet been updated in the actual
> codebase — the parser produces flat `Entry` objects, not mdast extension
> nodes. This document describes the planned AST layer. §7 (Feature block)
> describes the implemented entry body AST.

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
  ├─ Bracket content matches typed entry pattern        → msEntry (identified)
  │   /^[A-Z]{2,}_[A-Z]{2,12}_\d{3,4}$/
  │
  ├─ Bracket content matches reference entry pattern    → msEntry (referenced)
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
  shape: "identified" | "referenced";
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

| Field        | Source                                                                  |
| ------------ | ----------------------------------------------------------------------- |
| `shape`      | `"identified"` if display ID matches typed pattern, else `"referenced"` |
| `displayId`  | Text content inside `[...]` brackets                                    |
| `title`      | Inline content after the closing `]` on the first line                  |
| `body`       | All block-level children between title and attribute block              |
| `attributes` | Parsed from the trailing indented code block (`code` mdast node)        |

### Attribute block extraction

The trailing block of the `listItem` body is inspected. The attribute block is a
trailing indented `code` mdast node (4-space indent relative to body indent in
CommonMark) whose content lines each match:

```
Key: Value
```

Where `Key` matches `[A-Z][A-Za-z-]*` and `:` is the separator. The block
qualifies as an attribute block only when **every** content line matches.

If the trailing `code` node is an attribute block, it is removed from `body` and
its lines are parsed into `MsAttribute` entries. Otherwise, `attributes` is
empty and the `code` node stays in `body` (as a regular code block).

**Unindented trailers.** The parser also accepts a trailing `paragraph` whose
lines are all `Key: Value` when the paragraph holds an `Id:` line or uses only
core trailer keys, and a run of `Key: Value` lines at the end of the last
paragraph, directly under prose, when any line of the run is an `Id:` line
(`MSL-P020` warning). In Markdown the paragraph shape raises `MSL-P023`
(warning) when a trailer line is not indented, except in the legacy trailing-`\`
form. Any other trailing paragraph stays in `body`. A trailer line that ends
with `\` (the legacy hard-line-break form) is accepted in the indented `code`
node and in these shapes, and emits `MSL-DEPRECATED-ATTR-001`. See
[language.md](language.md) Part 1 §2 for the full rule.

### Examples

**Input mdast (simplified):**

```
list (unordered, depth 0)
  listItem
    paragraph
      text "[SRS_BRK_0001] Sensor debouncing"
    paragraph
      text "The sensor driver shall debounce..."
    code (indented)
      "Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\nSatisfies: SYS_BRK_0042\nLabels: ASIL-B"
```

**Output:**

```
msEntry (identified)
  displayId: "SRS_BRK_0001"
  title
    text "Sensor debouncing"
  body
    paragraph
      text "The sensor driver shall debounce..."
  attributes
    { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" }
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

    Id: 01HGW2R9QNP4ABCDEFGHJKMNPQ
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

When an entry block is detected, the trailing `code` mdast node is tested for
the attribute pattern. If every content line matches `Key: Value`, it is
consumed into the `msEntry.attributes` array and removed from the tree.
Otherwise, the `code` node stays in `body` as a regular code block.

The trailing position is required: if any block-level content appears after the
candidate `code` node, it does not qualify as an attribute block.

**Unindented shapes.** A trailing `paragraph` of `Key: Value` lines is also
recognized when it holds an `Id:` line or uses only core trailer keys (in
Markdown, `MSL-P023` warning when a trailer line is not indented, except in the
legacy trailing-`\` form). A trailer line with a hard line break (the legacy
trailing `\` form), in this shape or in the `code` node, triggers
`MSL-DEPRECATED-ATTR-001`. Any other trailing paragraph stays in `body`.

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
markspec:disable MSL-R011
-->
```

**Output:**

```
msDirective
  directives:
    { name: "deck", payload: "" }
    { name: "disable", payload: "MSL-R011" }
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

## §7 Feature block — `feature`

Unlike §1 to §6, this node is implemented. It is not an mdast extension node: it
is a block of the entry body AST (`Entry.bodyAst`, type `FeatureNode` in
`core/ast/nodes.ts`) that the body-AST builder produces from a fenced code node.
Rules for authors are in the language specification, §1.3 §8.

### Detection

A fenced code block whose info string is `gherkin` or `feature` becomes a
`FeatureNode`. Any other fence stays a `code` node.

### Node type

```typescript
interface FeatureNode {
  kind: "feature";
  source: string; // authored text, verbatim
  feature?: FeatureAst; // normalized AST
  parseError?: { line: number; column: number; message: string };
  range: SourceRange; // position of the node in the body
}
```

When the Gherkin parser is loaded, exactly one of `feature` and `parseError` is
set. When it is not loaded, neither is set. Both are pure functions of `source`.
`parseError.line` is relative to `source`, where line 1 is the first line of
`source`.

For an entry declared in a `.feature` file, the entry has one `FeatureNode`
whose `source` is the text of the owning node, from its first tag line or
keyword line to its last line. The text of a nested node that is its own entry
is blank in it. `feature` is the AST of the whole file reduced to the scenarios
that the entry owns, with every range relative to `source`. The Background steps
that the entry inherits from above its span keep ranges whose line can be 0 or
less (`projectFeature`, `core/gherkin/project.ts`). See the language
specification, §1.3 §7.

### Normalized AST

`FeatureAst` is built from the parser's `GherkinDocument` by `parseFeature` in
`core/gherkin/parse.ts`. It has these fields:

| Field         | Type               | Meaning                                                               |
| ------------- | ------------------ | --------------------------------------------------------------------- |
| `name`        | `string`           | Feature name, trimmed. Empty when the Feature line is synthetic.      |
| `keyword`     | `string`           | The Feature keyword as authored.                                      |
| `synthetic`   | `boolean`          | `true` when MarkSpec added the Feature line before parsing.           |
| `language`    | `string`           | Language code of the block; `en` unless a `# language:` line sets it. |
| `description` | `string`           | Feature description text.                                             |
| `tags`        | `string[]`         | Feature tags.                                                         |
| `scenarios`   | `ScenarioAst[]`    | Every scenario and scenario outline; Rules are flattened away.        |
| `backgrounds` | `StepAst[]`        | Steps of every Background (Feature and Rule), each once.              |
| `sections`    | `SectionAst[]`     | Every structural keyword in document order.                           |
| `comments`    | `GherkinComment[]` | Every comment line in document order, including `# language:`.        |

A `ScenarioAst` has `name` (trimmed, not normalized as a locator), `keyword`,
`tags` (its own tags, not inherited), `ruleName` (absent outside a Rule),
`description`, `descriptionEndLine` (absent without a description), `isOutline`,
`background` (Feature background steps, then Rule background steps), `steps`,
`examples` and `range`. A `StepAst` has `keyword` (as authored, trailing space
removed), `normalized`, `text`, `docString` (`mediaType`, `content`),
`dataTable` and `range`. `normalized` is one of `given`, `when`, `then`, `and`,
`but` and `step` (the `*` keyword), taken from the parser's keyword type in the
language of the block. An `ExamplesAst` has `name`, `keyword`, `tags`, `header`,
`rows` and `range`; an outline is not expanded. A `SectionAst` has `keyword` and
`range`. A `GherkinComment` has `line` and `text` (the trimmed line, including
the `#`); comments inside a doc string are not reported.

Steps, scenarios, examples and sections carry a `range` of `{ start, end }`
positions with 1-based `line` and `column`. The end column is exclusive. Lines
are relative to `source`: line 1 is its first line, and a synthetic Feature line
is not counted. A step with a doc string or data table ends after its last line;
a scenario ends after its last step or Examples row; a section covers its
keyword and the colon.

### Parser and loading

The parser is `@cucumber/gherkin` 42.0.1 with `@cucumber/messages` 34.2.1, both
pinned in `packages/markspec/deno.json`. It is imported dynamically by
`loadGherkin` (`core/gherkin/load.ts`); the result is cached and a failed load
is not. `parseFile` loads it only for a `.feature` file or for a text that holds
a `gherkin` or `feature` fence, so commands that read no Gherkin do not load it.
A load failure is not fatal for a fenced block: the node has neither `feature`
nor `parseError`, and the scenario names come from the line scanner (language
specification, §1.3 §8).

### When parsing fails

The node keeps `source` and sets `parseError` from the first parser error; it
has no `feature`. A block with no Feature keyword line is parsed after MarkSpec
inserts a synthetic Feature line, and `feature.synthetic` is `true` for it. If
the document has no Feature after parsing, the block counts as a failure with
the message `no Feature found in the Gherkin block`.

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

The feature block (§7) is not part of this pass; the body-AST builder produces
it from `code` nodes.

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
