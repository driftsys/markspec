/**
 * @module parser/source
 *
 * Source-code doc-comment parser. Extracts MarkSpec entry blocks from doc
 * comments in Rust, Kotlin, C, C++, and Java source files. Delegates parsed
 * content to the markdown parser for entry extraction.
 */

import type { SyntaxNode } from "web-tree-sitter";
import Parser from "web-tree-sitter";
import type { Entry, ExtractorRule } from "../model/mod.ts";
import { parseMarkdown } from "./markdown.ts";
import { buildBlockLineMap } from "./line_map.ts";
import type {
  LanguageDocCommentSpec,
  SupportedLanguage,
} from "./language_spec.ts";
import { LANGUAGE_SPECS } from "./language_spec.ts";

/** Options for {@linkcode parseSource}. */
export interface ParseSourceOptions {
  /** File path used in source locations. */
  readonly file?: string;
  /** Pre-loaded tree-sitter language grammar. */
  readonly language: Parser.Language;
  /**
   * Language id for the active grammar — used by the walker to look up
   * the doc-comment dispatch row in `LANGUAGE_SPECS`. The caller maps
   * file extension → languageId via `languageIdForExtension` before
   * calling `parseSource`.
   */
  readonly languageId: SupportedLanguage;
}

/** Result of parsing a source file. */
export interface ParseSourceResult {
  /** Entries found in doc comment blocks. */
  readonly entries: Entry[];
}

/** A contiguous doc comment block extracted from source. */
interface DocCommentBlock {
  /** Cleaned lines (comment prefix stripped). */
  readonly lines: string[];
  /** 1-based line number of the first comment line. */
  readonly startLine: number;
  /** 1-based column of the first comment line. */
  readonly startColumn: number;
  /** One value per cleaned line — bytes stripped from source to produce
   * the line. Length equals `lines.length`. */
  readonly prefixWidths: readonly number[];
  /** Which extractor rule produced this block. */
  readonly rule: ExtractorRule;
  /** Name of the enclosing function/class/struct/impl/mod/trait extracted
   * via `spec.itemName` from the immediately-following item node. Undefined
   * when no enclosing item is found, the item is anonymous, or the
   * extractor failed to extract a name. */
  readonly itemName?: string;
}

/**
 * Parse a source file and return entries extracted from doc comments.
 *
 * Uses tree-sitter to parse the source, walks the AST to find doc comment
 * nodes, strips comment prefixes, and delegates to the markdown parser for
 * entry extraction. Doc comments that don't contain entry blocks are ignored.
 *
 * @param content - Source file text
 * @param options - Parse options (language grammar, file path)
 */
export function parseSource(
  content: string,
  options: ParseSourceOptions,
): ParseSourceResult {
  const file = options.file ?? "<unknown>";
  const spec = LANGUAGE_SPECS[options.languageId];
  const parser = new Parser();
  parser.setLanguage(options.language);
  const tree = parser.parse(content);

  const blocks: DocCommentBlock[] = [];
  walkForDocComments(tree.rootNode, blocks, spec);
  const entries: Entry[] = [];

  for (const block of blocks) {
    const markdown = wrapAsListItem(block.lines);
    const lineMap = buildBlockLineMap({
      startLine: block.startLine,
      startColumn: block.startColumn,
      prefixWidths: block.prefixWidths,
    });
    const { entries: parsed } = parseMarkdown(markdown, { file, lineMap });

    for (const entry of parsed) {
      // entry.location, bodyAst ranges, and bodyTokens are already
      // file-relative thanks to the lineMap post-pass inside parseMarkdown.
      // Source files have no front matter; properties.file is derived from
      // the translated entry.location.
      entries.push({
        ...entry,
        source: {
          kind: "doc-comment",
          language: options.languageId,
          function: block.itemName,
          rule: block.rule,
        },
        properties: {
          file: {
            path: file,
            line: entry.location.line,
            column: entry.location.column,
          },
        },
      });
    }
  }

  tree.delete();
  parser.delete();
  return { entries };
}

/** Maximum sibling-walk length before giving up. Generous for typical
 * attribute stacks; bounds pathological inputs. */
const ENCLOSING_ITEM_LOOKAHEAD = 10;

/** Search the doc-comment's siblings for an enclosing item, skipping
 * attribute/annotation/comment nodes per the language spec. Returns
 * the item-name string or undefined. */
function findItemName(
  commentNode: SyntaxNode,
  spec: LanguageDocCommentSpec,
): string | undefined {
  let sibling = commentNode.nextSibling;
  let examined = 0;
  while (sibling !== null && examined < ENCLOSING_ITEM_LOOKAHEAD) {
    examined++;
    if (spec.enclosingItemTypes.includes(sibling.type)) {
      return spec.itemName(sibling);
    }
    if (!spec.attributeSkipTypes.includes(sibling.type)) {
      // Hit something that isn't an item AND isn't a skippable attribute —
      // structural surprise. Give up rather than walk forever.
      return undefined;
    }
    sibling = sibling.nextSibling;
  }
  return undefined;
}

function walkForDocComments(
  node: SyntaxNode,
  blocks: DocCommentBlock[],
  spec: LanguageDocCommentSpec,
): void {
  let currentLines: string[] = [];
  let currentPrefixWidths: number[] = [];
  let currentStartLine = 0;
  let currentStartColumn = 0;
  let currentRule: "outer-doc-comment" | "inner-doc-comment" =
    "outer-doc-comment";
  let lastRow = -2;
  let currentLastCommentNode: SyntaxNode | null = null;

  function flushLineBlock() {
    if (currentLines.length > 0) {
      const itemName = currentLastCommentNode
        ? findItemName(currentLastCommentNode, spec)
        : undefined;
      blocks.push({
        lines: currentLines,
        startLine: currentStartLine,
        startColumn: currentStartColumn,
        prefixWidths: currentPrefixWidths,
        rule: currentRule,
        itemName,
      });
      currentLines = [];
      currentPrefixWidths = [];
      currentRule = "outer-doc-comment";
      currentLastCommentNode = null;
      lastRow = -2;
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;

    const isLineComment = spec.lineCommentTypes.includes(child.type) &&
      spec.isDocLine(child.text);
    if (isLineComment) {
      const row = child.startPosition.row;
      if (currentLines.length > 0 && row !== lastRow + 1) {
        flushLineBlock();
      }
      if (currentLines.length === 0) {
        currentStartLine = row + 1;
        currentStartColumn = child.startPosition.column + 1;
      }
      const { text, prefixWidth, rule } = stripLineCommentPrefix(child);
      if (currentLines.length === 0) {
        currentRule = rule;
      }
      currentLines.push(text);
      currentPrefixWidths.push(prefixWidth);
      currentLastCommentNode = child;
      lastRow = row;
      continue;
    }

    const isBlockComment = spec.blockCommentTypes.includes(child.type) &&
      spec.isDocBlock(child.text);
    if (isBlockComment) {
      flushLineBlock();
      const { lines, prefixWidths, openerSkipped } = stripBlockCommentPrefix(
        child.text,
      );
      if (lines.length === 0) continue;
      const startRow = child.startPosition.row + (openerSkipped ? 1 : 0);
      const itemName = findItemName(child, spec);
      blocks.push({
        lines,
        startLine: startRow + 1,
        startColumn: child.startPosition.column + 1,
        prefixWidths,
        rule: "block-doc-comment",
        itemName,
      });
      continue;
    }

    // Non-comment node — flush pending line comments, then recurse.
    flushLineBlock();
    if (child.childCount > 0) {
      walkForDocComments(child, blocks, spec);
    }
  }

  flushLineBlock();
}

/** Result of stripping a prefix from one source line. */
interface PrefixStripResult {
  readonly text: string;
  /** Number of source characters stripped to produce `text`. */
  readonly prefixWidth: number;
  /** Which rule the line-comment strip helper matched: "outer-doc-comment"
   * for `///`, "inner-doc-comment" for `//!`. */
  readonly rule: "outer-doc-comment" | "inner-doc-comment";
}

/**
 * Strip the `///` or `//!` prefix from a line comment node.
 * Uses the `doc_comment` child if available, otherwise strips manually.
 */
export function stripLineCommentPrefix(node: SyntaxNode): PrefixStripResult {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (child.type === "doc_comment") {
      let text = child.text.replace(/\n$/, "");
      // The line_comment node's text starts with `///` (or `//!`); the
      // doc_comment child is the substring after the marker. Compute
      // prefixWidth as (line_comment_text_length - doc_comment_text_length)
      // before stripping the conventional leading space.
      const rawDoc = child.text.replace(/\n$/, "");
      let prefixWidth = node.text.replace(/\n$/, "").length - rawDoc.length;
      if (text.startsWith(" ")) {
        text = text.slice(1);
        prefixWidth += 1;
      }
      const rule: "outer-doc-comment" | "inner-doc-comment" =
        node.text.startsWith("//!") ? "inner-doc-comment" : "outer-doc-comment";
      return { text, prefixWidth, rule };
    }
  }
  // Fallback: manual prefix stripping
  const raw = node.text.replace(/\n$/, "");
  if (raw.startsWith("/// ")) {
    return { text: raw.slice(4), prefixWidth: 4, rule: "outer-doc-comment" };
  }
  if (raw.startsWith("///")) {
    return { text: raw.slice(3), prefixWidth: 3, rule: "outer-doc-comment" };
  }
  if (raw.startsWith("//! ")) {
    return { text: raw.slice(4), prefixWidth: 4, rule: "inner-doc-comment" };
  }
  if (raw.startsWith("//!")) {
    return { text: raw.slice(3), prefixWidth: 3, rule: "inner-doc-comment" };
  }
  return { text: raw, prefixWidth: 0, rule: "outer-doc-comment" };
}

/** Result of stripping a block comment. */
interface BlockStripResult {
  readonly lines: string[];
  /** One value per element of `lines` — chars stripped per emitted line. */
  readonly prefixWidths: number[];
  /**
   * True when the block's opener line (`/**`) had no content after the
   * marker and was therefore not emitted into `lines`. Used by the walker
   * to advance `startLine` by 1.
   */
  readonly openerSkipped: boolean;
}

/**
 * Strip block-comment delimiters and leading ` * ` prefixes.
 * Returns cleaned lines, per-line prefix widths, and a flag indicating
 * whether the opener was skipped (bare `/**\n`).
 */
export function stripBlockCommentPrefix(text: string): BlockStripResult {
  const rawLines = text.split("\n");
  const lines: string[] = [];
  const prefixWidths: number[] = [];
  let openerSkipped = false;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const trimmed = raw.trim();

    // Opening `/**` line. May have content after it.
    if (i === 0) {
      // Locate the `/**` marker; for canonical javadoc it's at the line
      // start, but be defensive.
      const markerIdx = raw.indexOf("/**");
      const afterMarker = markerIdx >= 0
        ? raw.slice(markerIdx + 3).replace(/^\s+/, "")
        : "";
      if (afterMarker && afterMarker !== "/") {
        // Compute prefixWidth so that for "/** Title", afterMarker="Title"
        // and prefixWidth = (raw.length - afterMarker.length) = 4 if
        // raw="/** Title", which matches the spec table.
        const prefixWidth = raw.length - afterMarker.length;
        lines.push(afterMarker);
        prefixWidths.push(prefixWidth);
      } else {
        openerSkipped = true;
      }
      continue;
    }

    // Closing `*/` line — skip.
    if (i === rawLines.length - 1 && trimmed === "*/") continue;

    // Strip leading ` * ` or ` *` or bare prose.
    if (trimmed.startsWith("* ")) {
      // Strip up through "* " — find leading-whitespace + "* "
      const starIdx = raw.indexOf("* ");
      const stripped = raw.slice(starIdx + 2);
      lines.push(stripped);
      prefixWidths.push(starIdx + 2);
    } else if (trimmed === "*") {
      lines.push("");
      prefixWidths.push(raw.indexOf("*") + 1);
    } else if (trimmed === "") {
      lines.push("");
      prefixWidths.push(0);
    } else {
      lines.push(trimmed);
      prefixWidths.push(raw.length - trimmed.length);
    }
  }

  return { lines, prefixWidths, openerSkipped };
}

/**
 * Wrap cleaned doc comment lines as a Markdown list item so the
 * existing `parseMarkdown()` can extract entries.
 *
 * Doc comments use `[DISPLAY_ID] Title` without the `- ` bullet.
 * This wraps to `- [DISPLAY_ID] Title\n\n  body...` which parseMarkdown
 * recognizes as an entry block.
 */
export function wrapAsListItem(lines: string[]): string {
  if (lines.length === 0) return "";
  const first = `- ${lines[0]}`;
  const rest = lines.slice(1).map((line) => line === "" ? "" : `  ${line}`);
  return [first, ...rest].join("\n");
}
