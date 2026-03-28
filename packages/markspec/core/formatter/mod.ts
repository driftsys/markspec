/**
 * @module formatter
 *
 * Markdown formatter and ULID assigner. Handles write-back operations:
 * ULID stamping, indentation normalization, trailing backslash enforcement,
 * and requirement block insertion.
 */

import type { Attribute, Diagnostic } from "../model/mod.ts";
import { parseMarkdown } from "../parser/markdown.ts";

/** Canonical attribute ordering. Unknown keys go before Labels. */
const CANONICAL_ORDER: readonly string[] = [
  "Id",
  "Satisfies",
  "Derived-from",
  "Allocates",
  "Component",
  "Constrains",
  "Between",
  "Interface",
  "Labels",
];

/** Pattern matching a `Key: Value` line with optional trailing backslash. */
const ATTR_LINE_RE = /^[A-Z][A-Za-z-]*: .+\\?$/;

/** Options for {@linkcode format}. */
export interface FormatOptions {
  /** File path for diagnostic messages. */
  readonly file?: string;
  /** ULID generator override (for testing). */
  readonly generateUlid?: () => string;
}

/** Result of a format operation. */
export interface FormatResult {
  /** The formatted Markdown text. */
  readonly output: string;
  /** Diagnostics emitted during formatting (e.g., ULID assignments). */
  readonly diagnostics: readonly Diagnostic[];
  /** Whether any changes were made. */
  readonly changed: boolean;
}

/**
 * Format a Markdown string — normalize attribute blocks,
 * fix indentation, enforce canonical ordering.
 *
 * @param markdown - Markdown source text
 * @param options - Format options
 * @returns Format result with output text and diagnostics
 */
export function format(
  markdown: string,
  options?: FormatOptions,
): FormatResult {
  const file = options?.file ?? "<unknown>";
  const entries = parseMarkdown(markdown, { file });

  if (entries.length === 0) {
    return { output: markdown, diagnostics: [], changed: false };
  }

  const lines = markdown.split("\n");
  const diagnostics: Diagnostic[] = [];
  let changed = false;

  // Process bottom-to-top so line splicing doesn't shift earlier entries.
  const sorted = [...entries].sort((a, b) => b.location.line - a.location.line);

  for (const entry of sorted) {
    if (entry.attributes.length === 0) continue;

    const indent = (entry.location.column - 1) + 2;
    const range = findAttributeBlockRange(lines, entry.location.line, indent);
    if (!range) continue;

    const normalized = sortAttributes([...entry.attributes]);
    const newBlock = renderAttributeBlock(normalized, indent);
    const oldBlock = lines.slice(range.start, range.end).join("\n");

    if (newBlock !== oldBlock) {
      lines.splice(range.start, range.end - range.start, ...newBlock.split("\n"));
      changed = true;
    }
  }

  return { output: lines.join("\n"), diagnostics, changed };
}

/**
 * Sort attributes to canonical order.
 * Unknown keys are placed before Labels, preserving their relative order.
 */
export function sortAttributes(attributes: Attribute[]): Attribute[] {
  const known: (Attribute | undefined)[] = new Array(CANONICAL_ORDER.length);
  const unknown: Attribute[] = [];

  for (const attr of attributes) {
    const idx = CANONICAL_ORDER.indexOf(attr.key);
    if (idx >= 0) {
      known[idx] = attr;
    } else {
      unknown.push(attr);
    }
  }

  const result: Attribute[] = [];
  const labelsIdx = CANONICAL_ORDER.indexOf("Labels");

  for (let i = 0; i < known.length; i++) {
    // Insert unknown attributes just before Labels
    if (i === labelsIdx) {
      result.push(...unknown);
    }
    if (known[i] != null) {
      result.push(known[i]!);
    }
  }

  // If Labels was not present, unknown attrs go at the end
  if (!known[labelsIdx]) {
    result.push(...unknown);
  }

  return result;
}

/**
 * Render attributes as indented `Key: Value\` lines.
 * Trailing backslash on all lines except the last.
 */
export function renderAttributeBlock(
  attributes: Attribute[],
  indent: number,
): string {
  const prefix = " ".repeat(indent);
  return attributes
    .map((attr, i) => {
      const sep = i < attributes.length - 1 ? "\\" : "";
      return `${prefix}${attr.key}: ${attr.value}${sep}`;
    })
    .join("\n");
}

/**
 * Find the 0-based line range [start, end) of the attribute block
 * for an entry starting at the given line.
 *
 * Scans forward from the entry start to find the list item boundary,
 * then walks backwards to find the contiguous trailing attribute block.
 */
export function findAttributeBlockRange(
  lines: readonly string[],
  entryStartLine: number,
  indent: number,
): { start: number; end: number } | undefined {
  const startIdx = entryStartLine - 1; // Convert 1-based to 0-based
  const indentStr = " ".repeat(indent);

  // Find the end of this list item's content.
  // The list item ends when we hit: a line at the entry's indent level starting
  // with `- `, or a non-blank line with less indent, or end of file.
  let itemEnd = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    // Blank lines within the list item are OK
    if (line.trim() === "") continue;
    // If the line doesn't start with the continuation indent, the item is over
    if (!line.startsWith(indentStr)) {
      itemEnd = i;
      break;
    }
  }

  // Walk backwards from itemEnd to find the contiguous attribute block.
  // Skip trailing blank lines first.
  let scanEnd = itemEnd;
  while (scanEnd > startIdx && lines[scanEnd - 1].trim() === "") {
    scanEnd--;
  }

  if (scanEnd <= startIdx) return undefined;

  // Now walk backwards collecting attribute lines
  let attrStart = scanEnd;
  for (let i = scanEnd - 1; i > startIdx; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "") break; // blank line = boundary
    if (ATTR_LINE_RE.test(trimmed)) {
      attrStart = i;
    } else {
      break;
    }
  }

  if (attrStart >= scanEnd) return undefined;

  return { start: attrStart, end: scanEnd };
}
