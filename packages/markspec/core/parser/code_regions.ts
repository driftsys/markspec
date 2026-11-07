/**
 * @module core/parser/code_regions
 *
 * Source regions of CommonMark code nodes, using the shared remark parser.
 * This module depends only on remark and mdast types so prose passes can use
 * it without importing the entry parser or creating an AST dependency cycle.
 */
import type { Root, RootContent } from "mdast";
import { processor } from "./remark.ts";

/** Code boundaries in the original document, with zero-based indices. */
export interface CodeRegions {
  readonly fencedLines: ReadonlySet<number>;
  /** Half-open source offsets, including the inline-code delimiters. */
  readonly inlineCode: readonly { start: number; end: number }[];
}

/**
 * Collect fenced-code lines and inline-code source ranges. Reuse the supplied
 * tree for this exact source when available; otherwise parse the document once.
 * A fenced node starts at its marker, after any list or quote prefix. An
 * indented code node starts at its indentation, so it cannot match here.
 * Indented code is deliberately excluded: MarkSpec trailers use that syntax.
 * Node ends at column one are exclusive of that line (for example when an
 * unclosed fence ends at a sibling list item). All other end lines include
 * content or a closing delimiter and belong to the fenced region.
 */
export function parseCodeRegions(
  markdown: string,
  tree: Root = processor.parse(markdown),
): CodeRegions {
  const fencedLines = new Set<number>();
  const inlineCode: { start: number; end: number }[] = [];
  const visit = (node: Root | RootContent): void => {
    const position = node.position;
    if (position) {
      const { start, end } = position;
      if (
        node.type === "code" && start.offset !== undefined &&
        /^(?:`{3,}|~{3,})/.test(markdown.slice(start.offset, start.offset + 3))
      ) {
        const lastLine = end.line - (end.column === 1 ? 1 : 0);
        for (let line = start.line; line <= lastLine; line++) {
          fencedLines.add(line - 1);
        }
      } else if (
        node.type === "inlineCode" && start.offset !== undefined &&
        end.offset !== undefined
      ) {
        inlineCode.push({ start: start.offset, end: end.offset });
      }
    }
    if ("children" in node) {
      for (const child of node.children) visit(child as RootContent);
    }
  };
  visit(tree);
  return { fencedLines, inlineCode };
}
