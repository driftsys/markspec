/**
 * @module parser/references
 *
 * Inline reference detection. Scans Markdown prose for `{{namespace.id}}`
 * patterns, skipping code spans and fenced code blocks.
 */

import type { InlineRef } from "../model/mod.ts";
import { processor } from "./remark.ts";

/** Valid inline ref pattern: `{{namespace.id}}`. */
const INLINE_REF_RE = /\{\{([a-z]+)\.([A-Za-z0-9_-]+)\}\}/g;

/** Node types whose text children should be skipped. */
const CODE_TYPES = new Set(["code", "inlineCode"]);

/** Options for {@linkcode detectInlineRefs}. */
export interface DetectInlineRefsOptions {
  /** File path used in source locations. */
  readonly file?: string;
}

/**
 * Detect `{{namespace.id}}` inline references in Markdown prose.
 *
 * Walks the mdast AST and scans every `text` node for the pattern,
 * skipping text inside `code` (fenced code blocks) and `inlineCode` nodes.
 *
 * @param markdown - Markdown source text
 * @param options - Detection options (file path for source locations)
 * @returns Array of detected inline references
 */
export function detectInlineRefs(
  markdown: string,
  options?: DetectInlineRefsOptions,
): InlineRef[] {
  const file = options?.file ?? "<unknown>";
  const tree = processor.parse(markdown) as unknown as AstNode;
  const refs: InlineRef[] = [];

  walkText(tree, false, (text, line, column) => {
    INLINE_REF_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = INLINE_REF_RE.exec(text.value)) !== null) {
      // Compute the column offset of this match within the text node.
      // For single-line text nodes, add match index to the starting column.
      // For multi-line, count from the last newline.
      const before = text.value.slice(0, match.index);
      const lastNewline = before.lastIndexOf("\n");
      let matchLine: number;
      let matchColumn: number;
      if (lastNewline === -1) {
        matchLine = line;
        matchColumn = column + match.index;
      } else {
        const newlineCount = before.split("\n").length - 1;
        matchLine = line + newlineCount;
        matchColumn = match.index - lastNewline;
      }

      refs.push({
        namespace: match[1],
        refId: match[2],
        location: { file, line: matchLine, column: matchColumn },
      });
    }
  });

  return refs;
}

/** Minimal AST node shape for tree walking. */
interface AstNode {
  type: string;
  value?: string;
  position?: { start: { line: number; column: number } };
  children?: AstNode[];
}

/**
 * Recursively walk the AST and invoke `callback` for every `text` node
 * that is NOT inside a code or inlineCode parent.
 */
function walkText(
  node: AstNode,
  insideCode: boolean,
  callback: (
    text: { value: string },
    line: number,
    column: number,
  ) => void,
): void {
  const inCode = insideCode || CODE_TYPES.has(node.type);

  if (node.type === "text" && !inCode && node.value !== undefined) {
    const line = node.position?.start.line ?? 1;
    const column = node.position?.start.column ?? 1;
    callback({ value: node.value }, line, column);
  }

  if (node.children) {
    for (const child of node.children) {
      walkText(child, inCode, callback);
    }
  }
}
