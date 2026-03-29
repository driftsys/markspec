/**
 * @module parser/source
 *
 * Source-code doc-comment parser. Extracts MarkSpec requirement blocks from
 * doc comments in Rust, Kotlin, C, C++, and Java source files. Delegates
 * parsed content to the markdown parser for entry extraction.
 */

import type { SyntaxNode } from "web-tree-sitter";
import Parser from "web-tree-sitter";
import type { Entry } from "../model/mod.ts";
import { parseMarkdown } from "./markdown.ts";

/** Options for {@linkcode parseSource}. */
export interface ParseSourceOptions {
  /** File path used in source locations. */
  readonly file?: string;
  /** Pre-loaded tree-sitter language grammar. */
  readonly language: Parser.Language;
}

/** A contiguous doc comment block extracted from source. */
interface DocCommentBlock {
  /** Cleaned lines (comment prefix stripped). */
  readonly lines: string[];
  /** 1-based line number of the first comment line. */
  readonly startLine: number;
  /** 1-based column of the first comment line. */
  readonly startColumn: number;
}

/**
 * Parse a source file and return all MarkSpec entries found in doc comments.
 *
 * Uses tree-sitter to parse the source, walks the AST to find doc comment
 * nodes, strips comment prefixes, and delegates to the markdown parser
 * for entry extraction.
 *
 * @param content - Source file text
 * @param options - Parse options (language grammar, file path)
 * @returns Array of parsed entries with `source: "doc-comment"`
 */
export function parseSource(
  content: string,
  options: ParseSourceOptions,
): Entry[] {
  const file = options.file ?? "<unknown>";
  const parser = new Parser();
  parser.setLanguage(options.language);
  const tree = parser.parse(content);

  const blocks = extractDocCommentBlocks(tree.rootNode);
  const entries: Entry[] = [];

  for (const block of blocks) {
    const markdown = wrapAsListItem(block.lines);
    const parsed = parseMarkdown(markdown, { file });

    for (const entry of parsed) {
      entries.push({
        ...entry,
        source: "doc-comment",
        location: {
          file,
          line: block.startLine,
          column: block.startColumn,
        },
      });
    }
  }

  parser.delete();
  return entries;
}

/**
 * Extract contiguous doc comment blocks from the tree-sitter AST.
 *
 * Rust: consecutive `line_comment` nodes with `outer_doc_comment_marker`.
 * C/C++/Java/Kotlin: `block_comment` nodes starting with `/**`.
 */
function extractDocCommentBlocks(root: SyntaxNode): DocCommentBlock[] {
  const blocks: DocCommentBlock[] = [];
  let currentLines: string[] = [];
  let currentStartLine = 0;
  let currentStartColumn = 0;
  let lastRow = -2;

  for (let i = 0; i < root.childCount; i++) {
    const node = root.child(i)!;

    if (node.type === "line_comment" && isOuterDocComment(node)) {
      const row = node.startPosition.row;

      // Not consecutive — flush previous block
      if (currentLines.length > 0 && row !== lastRow + 1) {
        blocks.push({
          lines: currentLines,
          startLine: currentStartLine,
          startColumn: currentStartColumn,
        });
        currentLines = [];
      }

      if (currentLines.length === 0) {
        currentStartLine = row + 1; // 1-based
        currentStartColumn = node.startPosition.column + 1; // 1-based
      }

      currentLines.push(stripLineCommentPrefix(node));
      lastRow = row;
      continue;
    }

    if (node.type === "block_comment" && node.text.startsWith("/**")) {
      // Flush any pending line comments first
      if (currentLines.length > 0) {
        blocks.push({
          lines: currentLines,
          startLine: currentStartLine,
          startColumn: currentStartColumn,
        });
        currentLines = [];
        lastRow = -2;
      }

      blocks.push({
        lines: stripBlockCommentPrefix(node.text),
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column + 1,
      });
      continue;
    }

    // Non-comment node — flush any pending line comment block
    if (currentLines.length > 0) {
      blocks.push({
        lines: currentLines,
        startLine: currentStartLine,
        startColumn: currentStartColumn,
      });
      currentLines = [];
      lastRow = -2;
    }
  }

  // Flush trailing block
  if (currentLines.length > 0) {
    blocks.push({
      lines: currentLines,
      startLine: currentStartLine,
      startColumn: currentStartColumn,
    });
  }

  return blocks;
}

/** Check if a line_comment node is a `///` outer doc comment. */
function isOuterDocComment(node: SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i)!.type === "outer_doc_comment_marker") return true;
  }
  return false;
}

/**
 * Strip the `///` prefix from a line comment node.
 * Uses the `doc_comment` child if available, otherwise strips manually.
 */
function stripLineCommentPrefix(node: SyntaxNode): string {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (child.type === "doc_comment") {
      let text = child.text.replace(/\n$/, "");
      // Strip one leading space (convention: `/// text`)
      if (text.startsWith(" ")) text = text.slice(1);
      return text;
    }
  }
  // Fallback: manual prefix stripping
  const text = node.text.replace(/\n$/, "");
  if (text.startsWith("/// ")) return text.slice(4);
  if (text.startsWith("///")) return text.slice(3);
  return text;
}

/**
 * Strip block comment delimiters and leading ` * ` prefixes.
 * Returns cleaned lines.
 */
function stripBlockCommentPrefix(text: string): string[] {
  const rawLines = text.split("\n");
  const result: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();

    // Skip opening `/**` line (may have content after it)
    if (i === 0) {
      const afterOpening = trimmed.slice(3).trim();
      if (afterOpening && afterOpening !== "/") {
        result.push(afterOpening);
      }
      continue;
    }

    // Skip closing `*/`
    if (i === rawLines.length - 1 && trimmed === "*/") {
      continue;
    }

    // Strip leading ` * ` or ` *`
    if (trimmed.startsWith("* ")) {
      result.push(trimmed.slice(2));
    } else if (trimmed === "*") {
      result.push("");
    } else {
      result.push(trimmed);
    }
  }

  return result;
}

/**
 * Wrap cleaned doc comment lines as a Markdown list item so the
 * existing `parseMarkdown()` can extract entries.
 *
 * Doc comments use `[DISPLAY_ID] Title` without the `- ` bullet.
 * This wraps to `- [DISPLAY_ID] Title\n\n  body...` which parseMarkdown
 * recognizes as an entry block.
 */
function wrapAsListItem(lines: string[]): string {
  if (lines.length === 0) return "";
  const first = `- ${lines[0]}`;
  const rest = lines.slice(1).map((line) => line === "" ? "" : `  ${line}`);
  return [first, ...rest].join("\n");
}
