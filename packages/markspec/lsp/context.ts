/**
 * @module lsp/context
 *
 * MarkSpec context guard. Determines whether a file or cursor position is
 * relevant to MarkSpec (entry blocks, trace attributes, doc comments).
 * Prevents the LSP from interfering with non-MarkSpec content.
 */

import { extname } from "@std/path";
import {
  FEATURE_EXTENSIONS,
  FENCE_RE,
  fencedCodeLines,
  SOURCE_EXTENSIONS,
} from "../core/mod.ts";

/** Gherkin doc-string delimiters. */
const DOC_STRING_DELIMITERS = ['"""', "```"] as const;

/** Entry marker pattern: `[TYPE_XXX_NNNN]` in any context. */
const ENTRY_MARKER_RE = /\[[A-Z]{2,}_[A-Z0-9_]+\]/;

/** Trace attribute keywords that indicate a MarkSpec context. */
const TRACE_KEYWORDS_RE =
  /\b(Id|Satisfies|Derived-from|Verified-by|References|Tests|Depends-on|Part-of|Allocated-to|Realizes|Provides|Requires|Generated-from|Supersedes|Labels|Discipline-frozen|Discipline)\s*:/;

/**
 * Check whether a file path has a MarkSpec-relevant extension.
 * Markdown files, supported source files and Gherkin `.feature` files
 * qualify.
 */
export function isMarkspecFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === ".md" || SOURCE_EXTENSIONS.has(ext) ||
    FEATURE_EXTENSIONS.has(ext);
}

/**
 * Check whether a file path is a Gherkin `.feature` file (ADR-038 Case B).
 * It is not a source file: it has no doc comments, and its MarkSpec headers
 * are `#` comment lines with an exact grammar.
 */
export function isFeatureFile(filePath: string): boolean {
  return FEATURE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

/**
 * Check whether a file path is a source file (not Markdown).
 * Used to determine if position-level context guard is needed.
 */
export function isSourceFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return SOURCE_EXTENSIONS.has(ext);
}

/**
 * Return fenced lines for LSP guards and occurrence scans. Markdown uses the
 * cached CommonMark boundaries. Source files retain the original line scanner:
 * raw source is not Markdown, and comment indentation changes its AST shape.
 * Every fence-prefix line toggles the scanner, including mismatched markers.
 * A `.feature` file returns every line that is not a `#` comment line, plus
 * every line of a `"""` or ```` ``` ```` doc string, including `#` lines
 * inside it: only header comments hold MarkSpec text there (ADR-038 D5).
 */
export function fencedLinesForFile(
  text: string,
  filePath: string,
): ReadonlySet<number> {
  // Only `#` comment lines are MarkSpec in a .feature file (D5): every other
  // line (steps, doc strings, tables) is excluded from ID scans.
  if (isFeatureFile(filePath)) {
    const excluded = new Set<number>();
    // The delimiter of the open doc string, or undefined outside one. A doc
    // string closes only on its own delimiter.
    let docString: string | undefined;
    text.split("\n").forEach((line, index) => {
      const trimmed = line.trimStart();
      if (docString !== undefined) {
        excluded.add(index);
        if (trimmed.startsWith(docString)) docString = undefined;
        return;
      }
      const opening = DOC_STRING_DELIMITERS.find((d) => trimmed.startsWith(d));
      if (opening !== undefined) docString = opening;
      if (!trimmed.startsWith("#")) excluded.add(index);
    });
    return excluded;
  }
  if (!isSourceFile(filePath)) return fencedCodeLines(text);
  const fencedLines = new Set<number>();
  let inFence = false;
  text.split("\n").forEach((line, index) => {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      fencedLines.add(index);
    } else if (inFence) {
      fencedLines.add(index);
    }
  });
  return fencedLines;
}

/**
 * Position-level context guard for source files.
 *
 * Scans lines within a radius of the given line index for entry markers
 * (`[TYPE_XXX_NNNN]`) or trace attribute keywords (`Satisfies:`, `Id:`,
 * etc.). If found, the position is considered MarkSpec-relevant.
 *
 * @param lines All lines of the document as an array
 * @param lineIndex 0-based line index of the cursor position
 * @param radius Number of lines to scan in each direction (default: 20)
 */
export function isDocCommentContext(
  lines: readonly string[],
  lineIndex: number,
  radius = 20,
): boolean {
  const start = Math.max(0, lineIndex - radius);
  const end = Math.min(lines.length, lineIndex + radius + 1);
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (ENTRY_MARKER_RE.test(line) || TRACE_KEYWORDS_RE.test(line)) {
      return true;
    }
  }
  return false;
}
