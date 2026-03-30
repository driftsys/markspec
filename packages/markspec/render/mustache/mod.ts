/**
 * @module render/mustache
 *
 * Mustache variable substitution. Preprocesses `{{namespace.id}}` placeholders
 * against the compiled model and `project.yaml` configuration, replacing them
 * with rendered output (hyperlinks, formatted IDs, project values).
 */

import type {
  CompileResult,
  Diagnostic,
  ProjectConfig,
} from "../../core/mod.ts";
import type { CaptionRegistry } from "../captions/mod.ts";

/** Context required to resolve mustache references. */
export interface MustacheContext {
  /** Compiled project model with all entries. */
  readonly compiled: CompileResult;
  /** Project configuration from `project.yaml`. */
  readonly config: ProjectConfig;
  /** Optional caption registry for figure/table references. */
  readonly captions?: CaptionRegistry;
}

/** Result of mustache preprocessing. */
export interface MustacheResult {
  /** Processed markdown with resolved references. */
  readonly output: string;
  /** Diagnostics for unresolved or invalid references. */
  readonly diagnostics: readonly Diagnostic[];
}

/** Matches `{{namespace.id}}` patterns. */
const MUSTACHE_RE = /\{\{(\w+)\.([^}]+)\}\}/g;

/** Matches a fenced code block opening or closing fence. */
const FENCE_RE = /^(`{3,}|~{3,})/;

/**
 * Resolve `{{namespace.id}}` references in a Markdown string.
 *
 * Scans the input for mustache patterns and replaces each with the
 * resolved value based on its namespace:
 *
 * - `project` — looks up a field in {@linkcode ProjectConfig}
 * - `req` — looks up a display ID in compiled entries, renders as markdown link
 * - `fig` — looks up a figure slug in the caption registry
 * - `tbl` — looks up a table slug in the caption registry
 *
 * References inside fenced code blocks or inline code spans are skipped.
 * Unresolved references produce a diagnostic and are left unchanged.
 *
 * @param markdown - Markdown source text
 * @param context - Resolution context (compiled model, config, captions)
 * @returns Processed markdown and diagnostics
 */
export function resolveMustache(
  markdown: string,
  context: MustacheContext,
): MustacheResult {
  const diagnostics: Diagnostic[] = [];

  // Build a set of character ranges that are inside code (fenced or inline).
  const codeRanges = buildCodeRanges(markdown);

  // Collect all matches with their positions.
  interface Match {
    readonly start: number;
    readonly end: number;
    readonly full: string;
    readonly namespace: string;
    readonly id: string;
    readonly line: number;
  }

  const matches: Match[] = [];
  MUSTACHE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MUSTACHE_RE.exec(markdown)) !== null) {
    const start = m.index;
    const end = start + m[0].length;

    // Skip if inside a code range.
    if (isInsideCode(start, end, codeRanges)) continue;

    // Compute line number (1-based).
    const line = lineNumberAt(markdown, start);

    matches.push({
      start,
      end,
      full: m[0],
      namespace: m[1],
      id: m[2],
      line,
    });
  }

  // Replace in reverse order to preserve offsets.
  let output = markdown;
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const resolved = resolve(match.namespace, match.id, context);

    if (resolved === undefined) {
      diagnostics.push({
        code: "MSR-E001",
        severity: "error",
        message:
          `unresolved mustache reference: {{${match.namespace}.${match.id}}}`,
        location: { file: "<mustache>", line: match.line, column: 1 },
      });
      continue;
    }

    output = output.slice(0, match.start) + resolved + output.slice(match.end);
  }

  return { output, diagnostics };
}

/**
 * Resolve a single namespace.id reference.
 * Returns the replacement string, or `undefined` if unresolved.
 */
function resolve(
  namespace: string,
  id: string,
  context: MustacheContext,
): string | undefined {
  switch (namespace) {
    case "project":
      return resolveProject(id, context.config);
    case "req":
      return resolveReq(id, context.compiled);
    case "fig":
      return resolveCaption("figure", id, context.captions);
    case "tbl":
      return resolveCaption("table", id, context.captions);
    default:
      return undefined;
  }
}

/** Resolve a `project.*` reference against ProjectConfig fields. */
function resolveProject(
  key: string,
  config: ProjectConfig,
): string | undefined {
  // Only expose simple string fields.
  switch (key) {
    case "name":
      return config.name;
    case "version":
      return config.version;
    default:
      return undefined;
  }
}

/**
 * Resolve a `req.*` reference against compiled entries.
 * Case-insensitive display ID lookup. Returns a markdown link.
 */
function resolveReq(
  id: string,
  compiled: CompileResult,
): string | undefined {
  // Try exact match first, then case-insensitive.
  const normalizedId = id.toUpperCase();
  for (const [displayId, _entry] of compiled.entries) {
    if (displayId.toUpperCase() === normalizedId) {
      const anchor = displayId.toLowerCase();
      return `[${displayId}](#${anchor})`;
    }
  }
  return undefined;
}

/** Resolve a `fig.*` or `tbl.*` reference against the caption registry. */
function resolveCaption(
  expectedKind: "figure" | "table",
  slug: string,
  captions: CaptionRegistry | undefined,
): string | undefined {
  if (!captions) return undefined;
  const numbered = captions.captions.get(slug);
  if (!numbered || numbered.caption.kind !== expectedKind) return undefined;
  return numbered.label;
}

// ---------------------------------------------------------------------------
// Code range detection
// ---------------------------------------------------------------------------

/** A half-open character range [start, end). */
interface Range {
  readonly start: number;
  readonly end: number;
}

/**
 * Build an array of character ranges that are inside fenced code blocks
 * or inline code spans. These ranges should be excluded from mustache
 * resolution.
 */
function buildCodeRanges(markdown: string): Range[] {
  const ranges: Range[] = [];

  // Fenced code blocks.
  const lines = markdown.split("\n");
  let offset = 0;
  let fenceStart = -1;
  let fenceMarker = "";

  for (const line of lines) {
    const lineEnd = offset + line.length;

    if (fenceStart === -1) {
      // Not inside a fence — check for opening.
      const fenceMatch = FENCE_RE.exec(line.trimStart());
      if (fenceMatch) {
        fenceStart = offset;
        fenceMarker = fenceMatch[1][0]; // ` or ~
      }
    } else {
      // Inside a fence — check for closing.
      const trimmed = line.trimStart();
      if (
        trimmed.length >= 3 &&
        trimmed[0] === fenceMarker &&
        /^(`{3,}|~{3,})\s*$/.test(trimmed) &&
        trimmed[0] === fenceMarker
      ) {
        ranges.push({ start: fenceStart, end: lineEnd });
        fenceStart = -1;
        fenceMarker = "";
      }
    }

    // +1 for the newline character.
    offset = lineEnd + 1;
  }

  // Unclosed fence extends to end of document.
  if (fenceStart !== -1) {
    ranges.push({ start: fenceStart, end: markdown.length });
  }

  // Inline code spans: match backtick sequences not inside fenced blocks.
  const inlineCodeRe = /(`+)([^`]|[^`][\s\S]*?[^`])\1/g;
  let ic: RegExpExecArray | null;
  inlineCodeRe.lastIndex = 0;
  while ((ic = inlineCodeRe.exec(markdown)) !== null) {
    const start = ic.index;
    const end = start + ic[0].length;
    // Only add if not already inside a fenced block range.
    if (!isInsideCode(start, end, ranges)) {
      ranges.push({ start, end });
    }
  }

  return ranges;
}

/** Check if a span [start, end) overlaps any code range. */
function isInsideCode(start: number, end: number, ranges: Range[]): boolean {
  for (const range of ranges) {
    if (start >= range.start && end <= range.end) return true;
  }
  return false;
}

/** Compute 1-based line number for a character offset. */
function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}
