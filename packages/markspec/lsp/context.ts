/**
 * @module lsp/context
 *
 * MarkSpec context guard. Determines whether a file or cursor position is
 * relevant to MarkSpec (entry blocks, trace attributes, doc comments).
 * Prevents the LSP from interfering with non-MarkSpec content.
 */

import { extname } from "@std/path";

/** Supported source file extensions (tree-sitter grammars available). */
const SOURCE_EXTENSIONS = new Set([
  ".rs",
  ".kt",
  ".kts",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".cc",
  ".cxx",
  ".hpp",
  ".hxx",
  ".ts",
  ".tsx",
  ".jsx",
  ".js",
  ".mjs",
  ".cjs",
]);

/** Entry marker pattern: `[TYPE_XXX_NNNN]` in any context. */
const ENTRY_MARKER_RE = /\[[A-Z]{2,}_[A-Z0-9_]+\]/;

/** Trace attribute keywords that indicate a MarkSpec context. */
const TRACE_KEYWORDS_RE =
  /\b(Id|Satisfies|Derived-from|Verified-by|References|Tests|Depends-on|Part-of|Allocated-to|Realizes|Generated-from|Supersedes|Labels)\s*:/;

/**
 * Check whether a file path has a MarkSpec-relevant extension.
 * Markdown files and supported source files qualify.
 */
export function isMarkspecFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === ".md" || SOURCE_EXTENSIONS.has(ext);
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
