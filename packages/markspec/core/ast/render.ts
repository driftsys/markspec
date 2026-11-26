/**
 * @module core/ast/render
 *
 * Body-AST → canonical body-string renderer. The faithful inverse of
 * `buildBodyAst` on already-canonical input.
 *
 * Invariant: for any canonical body string `s` (i.e. after running the
 * MarkSpec formatter),
 *
 *     render(buildBodyAst(s)) === s
 *
 * `render` does NOT re-implement the formatter's normalisation passes
 * (bullet rewriting, blank-line collapse, modal lowercasing). It assumes
 * its input was produced from a body string that is already in canonical
 * form and simply reverses the structural mapping that `build.ts` applied.
 *
 * This module is pure library code: no `Deno.*` APIs.
 */

import type {
  BlockquoteNode,
  BodyBlock,
  CaptionNode,
  CodeNode,
  DefinitionListNode,
  FeatureNode,
  FigureNode,
  ListItemNode,
  ListNode,
  MathNode,
  NoteNode,
  ParagraphNode,
  TableNode,
  UnknownNode,
} from "./nodes.ts";

// ---------------------------------------------------------------------------
// Per-node serialisers
// ---------------------------------------------------------------------------

function renderParagraph(node: ParagraphNode): string {
  // The paragraph's text is stored verbatim (markers are recorded as spans
  // but the text is unchanged). Emit the text directly.
  return node.content.text;
}

function renderList(node: ListNode): string {
  const itemLines: string[] = [];
  for (const item of node.items) {
    const rendered = renderListItem(item, node.ordered, itemLines.length + 1);
    itemLines.push(rendered);
  }
  // Loose lists (spread=true) have blank lines between items in source;
  // tight lists do not.
  return itemLines.join(node.spread ? "\n\n" : "\n");
}

/** A thematic break line: 3 or more `-`, `*` or `_`, with optional spaces. */
const THEMATIC_BREAK_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

function renderListItem(
  item: ListItemNode,
  ordered: boolean,
  index: number,
): string {
  if (item.blocks.length === 0) {
    const bullet = ordered ? `${index}.` : "-";
    return bullet;
  }

  const firstBlock = item.blocks[0];
  const restBlocks = item.blocks.slice(1);
  const bullet = ordered ? `${index}.` : "-";

  // GFM task-list checkbox, re-emitted right after the bullet. Absent for
  // non-task items (`item.checked === undefined`); independent of
  // `ListNode.hasTaskItems`, so MSL-B042 is unaffected.
  const checkbox = item.checked === undefined
    ? ""
    : item.checked
    ? "[x] "
    : "[ ] ";

  // Every line after the marker line is indented to the item's content
  // column: 2 for `-`, 3 for `1.`, 4 for `10.`. A smaller indent moves a
  // block out of an ordered item (#1026, #1033). The checkbox is inline
  // content, so it does not move the content column. Known limitation: a
  // continuation line of a task item is not kept (`- [x] one\n  two` gives
  // MSL-F900); task lists are an excluded construct (MSL-B042).
  const pad = " ".repeat(bullet.length + 1);
  const indent = (l: string) => (l ? `${pad}${l}` : "");

  // The first block starts on the marker line when its first line starts
  // with a non-space character. A thematic break is excluded: `- ---` is a
  // top-level thematic break, not a list item. A first block on the line
  // below a bare marker can also be read as a setext underline of the
  // paragraph above (`- a\n  -\n    > q`), so the marker line is preferred.
  const [head, ...tail] = renderBlock(firstBlock).split("\n");
  const allLines = /^\S/.test(head) && !THEMATIC_BREAK_RE.test(head)
    ? [`${bullet} ${checkbox}${head}`, ...tail.map(indent)]
    : [
      checkbox ? `${bullet} ${checkbox}`.trimEnd() : bullet,
      ...[head, ...tail].map(indent),
    ];

  // Remaining blocks in the item, indented. A "loose" item
  // (`listItem.spread`, captured from mdast) separates its blocks with a
  // blank line in source; a tight item (e.g. a paragraph with a nested
  // list directly under it) does not. Gating on the item's own spread —
  // NOT the list-level `ListNode.spread` — keeps loose multi-block items
  // byte-identical while letting tight nested lists round-trip.
  for (const block of restBlocks) {
    if (item.spread) allLines.push(""); // blank line before next block
    allLines.push(...renderBlock(block).split("\n").map(indent));
  }

  return allLines.join("\n");
}

function renderTable(node: TableNode): string {
  // Emit the verbatim source substring captured at parse time.
  // This preserves author column widths exactly (e.g. a separator row
  // wider than its cell content) for byte-identical round-trip,
  // matching the behaviour of CodeNode, FeatureNode, MathNode, and
  // UnknownNode which also carry their raw source text.
  return node.raw;
}

function renderFigure(node: FigureNode): string {
  // The verbatim source keeps the title, alt markup and character
  // references, which `alt` and `path` do not hold (#1008).
  return node.raw;
}

/** The info-string text after the language tag, or the empty string when
 * there is none. `meta` holds its leading spaces itself (#1008). */
function infoSuffix(meta: string | undefined): string {
  return meta ?? "";
}

function renderCode(node: CodeNode): string {
  // The fence markers are canonical (three backticks); the content and the
  // info string are kept.
  const lang = node.lang ?? "";
  return `\`\`\`${lang}${infoSuffix(node.meta)}\n${node.text}\n\`\`\``;
}

function renderFeature(node: FeatureNode): string {
  return `\`\`\`gherkin${infoSuffix(node.meta)}\n${node.source}\n\`\`\``;
}

function renderMath(node: MathNode): string {
  // build.ts splits on `$$…$$`. The tex field is the inner content
  // (including any surrounding whitespace). Match what MATH_BLOCK_RE captured:
  // the regex is /^\$\$([\s\S]*?)\$\$$/ so tex may start/end with \n.
  return `$$${node.tex}$$`;
}

function renderDefinitionList(node: DefinitionListNode): string {
  return node.items
    .map((item) => `${item.term.text}\n: ${item.definition.text}`)
    .join("\n\n");
}

function renderNote(node: NoteNode): string {
  // build.ts stores the content text with `\n\n` between paragraphs
  // that were separated by a blank quoted line in the source. Reconstruct
  // by prefixing every non-empty content line with `> ` and every empty
  // line (the paragraph separator) with bare `>` (no trailing space),
  // matching the canonical blank-quoted-line format.
  const text = node.content.text;
  if (!text) return `> [!${node.admonition}]`;
  const lines = text.split("\n");
  if (node.markerInline) {
    // Body began on the marker line in source — reproduce that form:
    // first content line stays on `> [!KIND] …`, the rest are quoted.
    const [first, ...rest] = lines;
    return `> [!${node.admonition}] ${first}` +
      (rest.length
        ? "\n" + rest.map((l) => l ? `> ${l}` : `>`).join("\n")
        : "");
  }
  return `> [!${node.admonition}]\n` +
    lines.map((l) => l ? `> ${l}` : `>`).join("\n");
}

function renderBlockquote(node: BlockquoteNode): string {
  // build.ts stores the content text with `\n\n` between paragraphs
  // that were separated by a blank quoted line in the source. Re-add
  // `> ` to every non-empty line and bare `>` to every empty line for
  // byte-identical round-trip.
  const text = node.content.text;
  return text.split("\n").map((l) => l ? `> ${l}` : `>`).join("\n");
}

function renderCaption(node: CaptionNode): string {
  // The verbatim source keeps every line, link URL and inline markup of
  // the caption; `text` holds only the flattened first line (#1008).
  return node.raw;
}

function renderUnknown(node: UnknownNode): string {
  return node.raw;
}

// ---------------------------------------------------------------------------
// Block dispatcher
// ---------------------------------------------------------------------------

function renderBlock(block: BodyBlock): string {
  switch (block.kind) {
    case "paragraph":
      return renderParagraph(block as ParagraphNode);
    case "list":
      return renderList(block as ListNode);
    case "table":
      return renderTable(block as TableNode);
    case "figure":
      return renderFigure(block as FigureNode);
    case "code":
      return renderCode(block as CodeNode);
    case "feature":
      return renderFeature(block as FeatureNode);
    case "math":
      return renderMath(block as MathNode);
    case "definition-list":
      return renderDefinitionList(block as DefinitionListNode);
    case "note":
      return renderNote(block as NoteNode);
    case "blockquote":
      return renderBlockquote(block as BlockquoteNode);
    case "caption":
      return renderCaption(block as CaptionNode);
    case "unknown":
      return renderUnknown(block as UnknownNode);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialise a body AST back to canonical MarkSpec body text.
 *
 * This is the faithful inverse of `buildBodyAst` on already-canonical input:
 * for any canonical body string `s`, `render(buildBodyAst(s)) === s`.
 *
 * `render` assumes its input was produced from body text already normalised
 * by the MarkSpec formatter. It does not re-run normalisation passes.
 *
 * @param blocks - The `BodyBlock[]` produced by `buildBodyAst`.
 * @returns The canonical body string, with blocks separated by a single
 *   blank line (two newlines) and no trailing newline.
 */
export function render(blocks: readonly BodyBlock[]): string {
  if (blocks.length === 0) return "";
  return blocks.map(renderBlock).join("\n\n");
}
