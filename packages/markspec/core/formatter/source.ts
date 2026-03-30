/**
 * @module formatter/source
 *
 * Source code formatter for doc comments. Extracts doc comment blocks,
 * formats them as Markdown using the standard formatter, and splices back
 * with appropriate comment prefixes.
 */

import type { SyntaxNode } from "web-tree-sitter";
import Parser from "web-tree-sitter";
import { format } from "./mod.ts";
import type { FormatOptions } from "./mod.ts";
import {
  stripBlockCommentPrefix,
  stripLineCommentPrefix,
  wrapAsListItem,
} from "../parser/mod.ts";

/** Options for {@linkcode formatSource}. */
export interface FormatSourceOptions extends FormatOptions {
  /** Pre-loaded tree-sitter language grammar. */
  readonly language: Parser.Language;
}

/** Result of a source file format operation. */
export interface FormatSourceResult {
  /** The formatted source text. */
  readonly output: string;
  /** Diagnostics emitted during formatting. */
  readonly diagnostics: readonly {
    code: string;
    severity: string;
    message: string;
    location?: { file?: string; line: number };
  }[];
  /** Whether any changes were made. */
  readonly changed: boolean;
}

/** Information about an extracted doc comment block. */
export interface DocCommentBlockInfo {
  /** Cleaned lines (comment prefix stripped). */
  readonly lines: string[];
  /** 1-based line number of the first comment line. */
  readonly startLine: number;
  /** 1-based column of the first comment line. */
  readonly startColumn: number;
  /** Type of comment: "line" (///) or "block" (/**) */
  readonly commentType: "line" | "block";
  /** Name of the function/item following this doc comment, if extractable. */
  readonly followingItem?: string;
}

/**
 * Extract doc comment blocks from source code.
 *
 * Uses tree-sitter to walk the AST and collect all doc comment blocks
 * (/// and /** variants). Returns block info for each block found.
 *
 * @param content - Source file text
 * @param language - Tree-sitter language grammar
 * @returns Array of extracted doc comment blocks
 */
export function extractDocCommentBlocks(
  content: string,
  language: Parser.Language,
): DocCommentBlockInfo[] {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(content);

  const blocks: DocCommentBlockInfo[] = [];
  walkForDocCommentInfo(tree.rootNode, blocks);

  tree.delete();
  parser.delete();
  return blocks;
}

/** Helper to walk AST and collect doc comment blocks with type info. */
function walkForDocCommentInfo(
  node: SyntaxNode,
  blocks: DocCommentBlockInfo[],
): void {
  let currentLines: string[] = [];
  let currentStartLine = 0;
  let currentStartColumn = 0;
  let lastRow = -2;
  let currentCommentType: "line" | "block" = "line";

  function flushLineBlock(followingItem?: string) {
    if (currentLines.length > 0) {
      blocks.push({
        lines: currentLines,
        startLine: currentStartLine,
        startColumn: currentStartColumn,
        commentType: currentCommentType,
        followingItem,
      });
      currentLines = [];
      lastRow = -2;
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;

    if (child.type === "line_comment" && isOuterDocComment(child)) {
      const row = child.startPosition.row;

      // Not consecutive — flush previous block
      if (currentLines.length > 0 && row !== lastRow + 1) {
        flushLineBlock();
      }

      if (currentLines.length === 0) {
        currentStartLine = row + 1; // 1-based
        currentStartColumn = child.startPosition.column + 1; // 1-based
        currentCommentType = "line";
      }

      currentLines.push(stripLineCommentPrefix(child));
      lastRow = row;
      continue;
    }

    if (child.type === "block_comment" && child.text.startsWith("/**")) {
      flushLineBlock();
      blocks.push({
        lines: stripBlockCommentPrefix(child.text),
        startLine: child.startPosition.row + 1,
        startColumn: child.startPosition.column + 1,
        commentType: "block",
      });
      continue;
    }

    // Non-comment node — flush pending line comments (capturing item name),
    // then recurse.
    if (currentLines.length > 0) {
      const itemName = extractItemName(child);
      flushLineBlock(itemName);
    }
    if (child.childCount > 0) {
      walkForDocCommentInfo(child, blocks);
    }
  }

  flushLineBlock();
}

/** Check if a line_comment node is a `///` outer doc comment. */
function isOuterDocComment(node: SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i)!.type === "outer_doc_comment_marker") return true;
  }
  return false;
}

/** Extract the identifier name from a function/item AST node. */
function extractItemName(node: SyntaxNode): string | undefined {
  // Skip attribute nodes — the item may be a sibling after attributes.
  let target = node;
  if (target.type === "attribute_item" || target.type === "annotation") {
    const next = target.nextSibling;
    if (next) target = next;
    else return undefined;
  }
  // Look for identifier/name child.
  for (let i = 0; i < target.childCount; i++) {
    const child = target.child(i)!;
    if (child.type === "identifier" || child.type === "name") {
      return child.text;
    }
  }
  return undefined;
}

/**
 * Unwrap a list item (markdown) back to plain lines.
 * Reverses the `wrapAsListItem` transformation.
 */
function unwrapListItem(markdown: string): string[] {
  const lines = markdown.split("\n");
  if (lines.length === 0) return [];

  // Remove leading "- " from first line
  let first = lines[0];
  if (first.startsWith("- ")) {
    first = first.slice(2);
  }

  // Remove leading indent from remaining lines
  const rest = lines.slice(1).map((line) => {
    if (line.startsWith("  ")) return line.slice(2);
    return line;
  });

  return [first, ...rest];
}

/**
 * Re-wrap lines with comment prefixes.
 * Handles both line (///) and block (/** *\/) comments.
 */
function rewrapComment(
  lines: string[],
  commentType: "line" | "block",
): string {
  if (lines.length === 0) return "";

  if (commentType === "line") {
    return lines
      .map((line) => (line ? `/// ${line}` : "///"))
      .join("\n");
  } else {
    // Block comment
    const content = lines
      .map((line, i) => {
        if (i === 0) return `/** ${line}`;
        if (line) return ` * ${line}`;
        return " *";
      })
      .join("\n");
    return `${content}\n */`;
  }
}

/**
 * Format a source file — extract doc comments, format them as Markdown,
 * splice back with comment prefixes.
 *
 * @param content - Source file text
 * @param options - Format options (domain, file, generateUlid)
 * @returns Format result with output text and diagnostics
 */
export function formatSource(
  content: string,
  options: FormatSourceOptions,
): FormatSourceResult {
  const blocks = extractDocCommentBlocks(content, options.language);

  if (blocks.length === 0) {
    return { output: content, diagnostics: [], changed: false };
  }

  const lines = content.split("\n");
  const diagnostics: {
    code: string;
    severity: string;
    message: string;
    location?: { file?: string; line: number };
  }[] = [];
  let changed = false;

  // Process blocks bottom-to-top so line splicing doesn't shift earlier blocks
  const sorted = [...blocks].sort((a, b) => b.startLine - a.startLine);

  for (const block of sorted) {
    // Format block as Markdown
    const markdown = wrapAsListItem(block.lines);
    const formatResult = format(markdown, options);

    // Unwrap the formatted Markdown
    const formatted = unwrapListItem(formatResult.output);

    // Re-wrap with comment prefixes
    const rewrapped = rewrapComment(formatted, block.commentType);

    // Find the line range to replace
    const endLine = block.startLine + block.lines.length - 1;
    const startIdx = block.startLine - 1;
    const endIdx = endLine;

    const oldBlock = lines.slice(startIdx, endIdx).join("\n");
    if (rewrapped !== oldBlock) {
      lines.splice(startIdx, endIdx - startIdx, ...rewrapped.split("\n"));
      changed = true;
    }

    // Add diagnostics
    for (const diag of formatResult.diagnostics) {
      diagnostics.push({
        code: diag.code,
        severity: diag.severity,
        message: diag.message,
        location: diag.location,
      });
    }
  }

  return { output: lines.join("\n"), diagnostics, changed };
}
