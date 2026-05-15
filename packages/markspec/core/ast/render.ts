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

  // The bullet prefix for the first block.
  const bullet = ordered ? `${index}.` : "-";

  // Render the first block. For a paragraph, the text follows the bullet
  // directly. For any other block, we render it indented.
  let firstLine: string;
  let extraLines: string[] = [];

  if (firstBlock.kind === "paragraph") {
    // `- text` — inline with the bullet.
    const text = (firstBlock as ParagraphNode).content.text;
    const textLines = text.split("\n");
    firstLine = `${bullet} ${textLines[0]}`;
    if (textLines.length > 1) {
      // Continuation lines of a multi-line paragraph are indented to align
      // with the first character after the bullet (`- ` = 2 chars).
      extraLines = textLines.slice(1).map((l) => (l ? `  ${l}` : ""));
    }
  } else {
    // Block content that isn't a paragraph: render on its own line(s),
    // indented by 2 spaces.
    firstLine = bullet;
    const blockStr = renderBlock(firstBlock);
    extraLines = blockStr.split("\n").map((l) => (l ? `  ${l}` : ""));
  }

  const allLines = [firstLine, ...extraLines];

  // Remaining blocks in the item — separated by blank lines, indented.
  for (const block of restBlocks) {
    allLines.push(""); // blank line before next block
    const blockStr = renderBlock(block);
    for (const l of blockStr.split("\n")) {
      allLines.push(l ? `  ${l}` : "");
    }
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
  return `![${node.alt}](${node.path})`;
}

function renderCode(node: CodeNode): string {
  const lang = node.lang ?? "";
  return `\`\`\`${lang}\n${node.text}\n\`\`\``;
}

function renderFeature(node: FeatureNode): string {
  return `\`\`\`gherkin\n${node.source}\n\`\`\``;
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
  return `> [!${node.admonition}]\n` +
    text.split("\n").map((l) => l ? `> ${l}` : `>`).join("\n");
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
  return `${node.keyword}: ${node.text}`;
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
