/**
 * @module lsp/document_links
 *
 * Pure helper for the LSP `textDocument/documentLink` handler. Walks
 * each entry's source lines, finds `Verified-by:` trailer lines, and
 * emits one `DocumentLink` per value whose path portion ends in a
 * recognized source-file extension.
 *
 * The link **range** covers only the path substring (not the optional
 * `:test_name` or `:line[:col]` suffix); the link **target** is the
 * file URI returned by `resolveTarget`, plus the `#L<line>` fragment
 * applied by the caller when a numeric suffix is present.
 *
 * Spec: `docs/spec/internal/markspec-lsp-feature-additions.md` §5.3.
 */

import type { Entry } from "../core/mod.ts";

/** Source-file extensions recognized as document-link candidates.
 * Superset of `lsp/context.ts`'s `SOURCE_EXTENSIONS` — spec §5.3 also
 * calls out `.py` and `.go` even though MarkSpec's tree-sitter parser
 * doesn't yet load grammars for them. */
export const DOCUMENT_LINK_EXTENSIONS: ReadonlySet<string> = new Set([
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
  ".cs",
  ".py",
  ".go",
]);

/** A subset of the LSP `DocumentLink` interface. */
export interface DocumentLink {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  readonly target: string;
}

/**
 * Matches a trailer-indented `Verified-by:` line, capturing the
 * leading indent + key + ": " prefix in group 1 so callers can
 * compute the value's starting column.
 *
 * Trailer indent is ≥4 spaces per the parser; the formatter
 * canonicalises to 6.
 */
const VERIFIED_BY_LINE_RE = /^(\s{4,}Verified-by\s*:\s*)(.*)$/;

/**
 * Match a single value token: `<path>` with an optional
 * `:line[:col]` or `:identifier` suffix. Group 1 captures the path
 * portion (which the link range covers); group 2 captures the
 * numeric line suffix when present (which the resolver consumes).
 *
 * Path characters: anything except whitespace, comma, and colon —
 * keeps the boundary between path and `:suffix` unambiguous.
 */
const VALUE_TOKEN_RE =
  /^([^\s,:]+)(?::(\d+)(?::\d+)?|:[A-Za-z_][A-Za-z0-9_]*)?$/;

/** Return the extension (including the dot) for a path, lowercased. */
function extOf(p: string): string {
  const i = p.lastIndexOf(".");
  if (i < 0) return "";
  // Reject if the dot is in a directory segment (no slash after the dot).
  if (p.indexOf("/", i) >= 0) return "";
  if (p.indexOf("\\", i) >= 0) return "";
  return p.slice(i).toLowerCase();
}

/** Top-level comma split — Verified-by paths never contain `[...]`
 * citation locators, so simple comma split is sufficient. */
function splitCsv(value: string): string[] {
  return value.split(",");
}

/**
 * Build the `DocumentLink[]` for a document.
 *
 * @param entries — entries declared in the document the client requested
 *   links for. Each entry's `location.line` (1-based) anchors the search;
 *   the helper scans lines from that entry's start up to either the next
 *   entry's start − 1 or the end of `text`.
 * @param text — the full text of the document. Used to locate the path
 *   substring's column within each `Verified-by:` line.
 * @param resolveTarget — `(relPath, lineSuffix?) => uri | undefined`.
 *   Resolves a value's path portion to a `file://` URI. Returns
 *   `undefined` to suppress emission (e.g., when the caller cannot
 *   determine a project root). When `lineSuffix` is a number, the
 *   caller-side implementation appends `#L<lineSuffix>` to the URI;
 *   when it is `undefined`, no fragment is appended. Keeping the
 *   resolver injected makes the helper platform-neutral and
 *   unit-testable without `@std/path` or filesystem access.
 */
export function buildDocumentLinks(
  entries: readonly Entry[],
  text: string,
  resolveTarget: (
    relPath: string,
    lineSuffix: number | undefined,
  ) => string | undefined,
): DocumentLink[] {
  if (entries.length === 0) return [];

  const lines = text.split("\n");
  const sorted = [...entries].sort(
    (a, b) => a.location.line - b.location.line,
  );

  const out: DocumentLink[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    // 1-based inclusive start; 1-based inclusive end.
    const startLine = entry.location.line;
    const endLine = i + 1 < sorted.length
      ? sorted[i + 1].location.line - 1
      : lines.length;

    for (let lineNo = startLine; lineNo <= endLine; lineNo++) {
      const line = lines[lineNo - 1];
      if (line === undefined) continue;
      const m = VERIFIED_BY_LINE_RE.exec(line);
      if (!m) continue;

      const prefixLen = m[1].length;
      const value = m[2];

      // Walk comma-separated tokens, tracking the column of each
      // token's start within the source line so we can emit an
      // accurate range. `cursor` is the column of the next character
      // to examine; `csvParts` are the raw split chunks (each
      // potentially leading/trailing whitespace).
      let cursor = prefixLen;
      const csvParts = splitCsv(value);
      for (let p = 0; p < csvParts.length; p++) {
        const part = csvParts[p];
        // Skip leading whitespace inside the part to find token start.
        let tokenStart = 0;
        while (tokenStart < part.length && /\s/.test(part[tokenStart])) {
          tokenStart++;
        }
        // Find token end (until trailing whitespace).
        let tokenEnd = part.length;
        while (tokenEnd > tokenStart && /\s/.test(part[tokenEnd - 1])) {
          tokenEnd--;
        }
        const token = part.slice(tokenStart, tokenEnd);

        // Absolute column where the token begins.
        const tokenColumn = cursor + tokenStart;

        // Advance `cursor` past this part and the comma separator
        // (except for the last part).
        cursor += part.length;
        if (p < csvParts.length - 1) cursor += 1; // the comma

        if (token.length === 0) continue;

        const vm = VALUE_TOKEN_RE.exec(token);
        if (!vm) continue;
        const pathPart = vm[1];
        const numericLine = vm[2] !== undefined ? Number(vm[2]) : undefined;

        if (!DOCUMENT_LINK_EXTENSIONS.has(extOf(pathPart))) continue;

        const target = resolveTarget(pathPart, numericLine);
        if (target === undefined) continue;

        const lspLine = lineNo - 1;
        out.push({
          range: {
            start: { line: lspLine, character: tokenColumn },
            end: { line: lspLine, character: tokenColumn + pathPart.length },
          },
          target,
        });
      }
    }
  }
  return out;
}
