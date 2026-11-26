/**
 * @module core/parser/code_regions
 *
 * Source regions of CommonMark code nodes and other verbatim inline syntax,
 * using the shared remark parser.
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
  /**
   * Half-open source offsets of inline syntax whose text is not prose: link
   * destinations, titles and labels, autolinks, images, link reference
   * definitions, footnote labels and raw HTML. The visible text of a
   * `[text](url)` or `[text][label]` link and the content of a footnote
   * definition are prose and are not included. Sorted by `start`.
   */
  readonly verbatimInline: readonly { start: number; end: number }[];
}

/** Nodes whose whole source is verbatim. */
const VERBATIM_NODE_TYPES: ReadonlySet<string> = new Set([
  "image",
  "imageReference",
  "definition",
  "footnoteReference",
  "html",
]);

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
  const verbatimInline: { start: number; end: number }[] = [];
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
      } else if (start.offset !== undefined && end.offset !== undefined) {
        const range = { start: start.offset, end: end.offset };
        if (node.type === "link" || node.type === "linkReference") {
          // An autolink's visible text is its URL: keep the whole node.
          if (!collectLinkSyntax(node, markdown, verbatimInline)) {
            verbatimInline.push(range);
            return;
          }
        } else if (VERBATIM_NODE_TYPES.has(node.type)) {
          verbatimInline.push(range);
          return;
        } else if (node.type === "footnoteDefinition") {
          // Keep the `[^label]:` part; the definition content is prose.
          verbatimInline.push({
            start: range.start,
            end: node.children[0]?.position?.start.offset ?? range.end,
          });
        }
      }
    }
    if ("children" in node) {
      for (const child of node.children) visit(child as RootContent);
    }
  };
  visit(tree);
  verbatimInline.sort((a, b) => a.start - b.start);
  return { fencedLines, inlineCode, verbatimInline };
}

/**
 * Sorted half-open source offsets of text that is not prose: inline code
 * (with its delimiters) and the verbatim inline syntax of
 * {@linkcode CodeRegions.verbatimInline}. The `fmt` modal casing pass keeps
 * these ranges unchanged, and the body-token scanner and the MSL-Q500 rule
 * skip them, so all three use this one definition (#1017).
 */
export function nonProseRanges(
  markdown: string,
  tree?: Root,
): { start: number; end: number }[] {
  const regions = parseCodeRegions(markdown, tree);
  return [...regions.inlineCode, ...regions.verbatimInline]
    .sort((a, b) => a.start - b.start);
}

/**
 * For a `[text](url)` or `[text][label]` link, push the source around its
 * visible text (the destination, title or label) to `out` and return `true`.
 * Return `false` when the visible text is not prose: an autolink (`<url>` or
 * a GFM literal), whose source does not start with `[`, and a shortcut or
 * collapsed reference, whose text is its label. Also return `false` for a
 * link with no positioned text.
 */
function collectLinkSyntax(
  node: RootContent,
  markdown: string,
  out: { start: number; end: number }[],
): boolean {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined || markdown[start] !== "[") {
    return false;
  }
  // The visible text of a shortcut `[label]` or collapsed `[label][]`
  // reference is its label.
  if (node.type === "linkReference" && node.referenceType !== "full") {
    return false;
  }
  const children = "children" in node ? node.children : [];
  const first = children[0]?.position?.start.offset;
  const last = children.at(-1)?.position?.end.offset;
  if (first === undefined || last === undefined) return false;
  out.push({ start, end: first }, { start: last, end });
  return true;
}
