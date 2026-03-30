/**
 * @module parser/source
 *
 * Source-code doc-comment parser. Extracts MarkSpec requirement blocks from
 * doc comments in Rust, Kotlin, C, C++, and Java source files. Delegates
 * parsed content to the markdown parser for entry extraction.
 */

import type { SyntaxNode } from "web-tree-sitter";
import Parser from "web-tree-sitter";
import type { Entry, Link, LinkKind } from "../model/mod.ts";
import { parseMarkdown } from "./markdown.ts";

/** Options for {@linkcode parseSource}. */
export interface ParseSourceOptions {
  /** File path used in source locations. */
  readonly file?: string;
  /** Pre-loaded tree-sitter language grammar. */
  readonly language: Parser.Language;
}

/** Result of parsing a source file. */
export interface ParseSourceResult {
  /** Entries found in doc comment blocks. */
  readonly entries: Entry[];
  /** Standalone annotation links (Verifies/Implements) outside entry blocks. */
  readonly links: Link[];
}

/** A contiguous doc comment block extracted from source. */
interface DocCommentBlock {
  /** Cleaned lines (comment prefix stripped). */
  readonly lines: string[];
  /** 1-based line number of the first comment line. */
  readonly startLine: number;
  /** 1-based column of the first comment line. */
  readonly startColumn: number;
  /** Name of the function/item following this doc comment, if extractable. */
  readonly followingItem?: string;
}

/**
 * Standalone annotation pattern: `Verifies: ID1, ID2` or `Implements: ID1`.
 * Matches a single line that is NOT inside an entry block.
 */
const ANNOTATION_RE = /^(Verifies|Implements):\s+(.+)$/;

/**
 * Parse a source file and return entries and annotation links from doc comments.
 *
 * Uses tree-sitter to parse the source, walks the AST to find doc comment
 * nodes, strips comment prefixes, and delegates to the markdown parser
 * for entry extraction. Doc comments that don't contain entries are scanned
 * for standalone `Verifies:` / `Implements:` annotations.
 *
 * @param content - Source file text
 * @param options - Parse options (language grammar, file path)
 * @returns Parsed entries and annotation links
 */
export function parseSource(
  content: string,
  options: ParseSourceOptions,
): ParseSourceResult {
  const file = options.file ?? "<unknown>";
  const parser = new Parser();
  parser.setLanguage(options.language);
  const tree = parser.parse(content);

  const blocks: DocCommentBlock[] = [];
  walkForDocComments(tree.rootNode, blocks);
  const entries: Entry[] = [];
  const links: Link[] = [];

  for (const block of blocks) {
    const markdown = wrapAsListItem(block.lines);
    const parsed = parseMarkdown(markdown, { file });

    if (parsed.length > 0) {
      // Block contains entry blocks — extract entries.
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
    } else {
      // No entries — scan for standalone annotations.
      const from = block.followingItem ?? `${file}:${block.startLine}`;
      for (const line of block.lines) {
        const match = ANNOTATION_RE.exec(line.trim());
        if (!match) continue;
        const kind = match[1].toLowerCase() as LinkKind;
        const targets = match[2].split(",").map((s) => s.trim()).filter((s) =>
          s.length > 0
        );
        for (const to of targets) {
          links.push({
            from,
            to,
            kind,
            location: {
              file,
              line: block.startLine,
              column: block.startColumn,
            },
          });
        }
      }
    }
  }

  tree.delete();
  parser.delete();
  return { entries, links };
}

/**
 * Recursively walk the tree-sitter AST and collect doc comment blocks.
 *
 * At each level, consecutive `line_comment` nodes with
 * `outer_doc_comment_marker` are grouped into a single block.
 * `block_comment` nodes starting with `/**` become individual blocks.
 * Non-comment children are recursed into so that doc comments inside
 * `mod`, `impl`, and other nested scopes are discovered.
 */
function walkForDocComments(
  node: SyntaxNode,
  blocks: DocCommentBlock[],
): void {
  let currentLines: string[] = [];
  let currentStartLine = 0;
  let currentStartColumn = 0;
  let lastRow = -2;

  function flushLineBlock(followingItem?: string) {
    if (currentLines.length > 0) {
      blocks.push({
        lines: currentLines,
        startLine: currentStartLine,
        startColumn: currentStartColumn,
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
      walkForDocComments(child, blocks);
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

/**
 * Extract the identifier name from a function/item AST node.
 * Walks through attribute nodes (e.g., `#[test]`) to find the actual
 * item, then looks for its `name` or `identifier` child.
 */
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
