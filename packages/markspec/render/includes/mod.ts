/**
 * @module render/includes
 *
 * Preprocesses `<!-- include: ref -->` directives in Markdown.
 * Resolves display ID references against the compiled model and
 * file path references against the filesystem. Supports optional
 * `| filter` syntax for title-only and body-only variants.
 */

import type { CompileResult, Diagnostic, Entry } from "../../core/mod.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Options for {@linkcode processIncludes}. */
export interface IncludeOptions {
  /** Function to read files. Required — no Deno.* in library code. */
  readonly readFile: (path: string) => Promise<string>;
  /** Base directory for resolving relative paths. */
  readonly basePath: string;
  /** Compiled model for entry lookups. */
  readonly compiled: CompileResult;
}

/** Result of processing include directives. */
export interface IncludeResult {
  readonly output: string;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Process all `<!-- include: ref -->` directives in a Markdown document.
 *
 * Replaces each directive with the resolved content based on the
 * reference type and optional filter. Directives inside fenced code
 * blocks are left untouched.
 *
 * @param markdown - Input Markdown content
 * @param options - Include processing options
 * @returns Processed Markdown and any diagnostics
 */
export async function processIncludes(
  markdown: string,
  options: IncludeOptions,
): Promise<IncludeResult> {
  const codeBlockRanges = findCodeBlockRanges(markdown);
  const matches = findIncludeDirectives(markdown);
  const diagnostics: Diagnostic[] = [];

  // Process matches in reverse order to preserve string offsets.
  const replacements: Array<{
    start: number;
    end: number;
    replacement: string;
  }> = [];

  for (const match of matches) {
    // Skip directives inside fenced code blocks.
    if (isInsideCodeBlock(match.start, codeBlockRanges)) {
      continue;
    }

    const resolved = await resolveRef(match.ref, match.filter, options);

    if (resolved.diagnostic) {
      diagnostics.push(resolved.diagnostic);
    }

    if (resolved.replacement !== undefined) {
      replacements.push({
        start: match.start,
        end: match.end,
        replacement: resolved.replacement,
      });
    }
  }

  // Apply replacements in reverse order to preserve offsets.
  let output = markdown;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { start, end, replacement } = replacements[i];
    output = output.slice(0, start) + replacement + output.slice(end);
  }

  return { output, diagnostics };
}

// ---------------------------------------------------------------------------
// Directive parsing
// ---------------------------------------------------------------------------

/** A parsed include directive with its position in the source. */
interface IncludeMatch {
  readonly start: number;
  readonly end: number;
  readonly ref: string;
  readonly filter: string | undefined;
}

/** Regex matching `<!-- include: ref -->` or `<!-- include: ref | filter -->`. */
const INCLUDE_RE = /<!--\s*include:\s*(.+?)\s*-->/g;

/** Find all include directives in the markdown string. */
function findIncludeDirectives(markdown: string): IncludeMatch[] {
  const matches: IncludeMatch[] = [];
  let m: RegExpExecArray | null;

  while ((m = INCLUDE_RE.exec(markdown)) !== null) {
    const payload = m[1];
    const pipeIndex = payload.indexOf("|");

    let ref: string;
    let filter: string | undefined;

    if (pipeIndex >= 0) {
      ref = payload.slice(0, pipeIndex).trim();
      filter = payload.slice(pipeIndex + 1).trim();
    } else {
      ref = payload.trim();
      filter = undefined;
    }

    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      ref,
      filter,
    });
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Code block detection
// ---------------------------------------------------------------------------

/** A range [start, end) of character offsets for a fenced code block. */
interface CodeBlockRange {
  readonly start: number;
  readonly end: number;
}

/** Find all fenced code block ranges in the markdown. */
function findCodeBlockRanges(markdown: string): CodeBlockRange[] {
  const ranges: CodeBlockRange[] = [];
  const fenceRe = /^(`{3,}|~{3,})/gm;
  let openFence: { start: number; marker: string } | undefined;
  let m: RegExpExecArray | null;

  while ((m = fenceRe.exec(markdown)) !== null) {
    const marker = m[1];

    if (openFence === undefined) {
      // Opening fence.
      openFence = { start: m.index, marker: marker[0] };
    } else if (
      marker[0] === openFence.marker &&
      marker.length >= openFence.marker.length
    ) {
      // Closing fence — same character type, at least as long.
      ranges.push({ start: openFence.start, end: m.index + m[0].length });
      openFence = undefined;
    }
    // Otherwise, a fence of a different type inside — ignore it.
  }

  // If a fence was opened but never closed, treat rest of document as code.
  if (openFence !== undefined) {
    ranges.push({ start: openFence.start, end: markdown.length });
  }

  return ranges;
}

/** Check whether a character offset falls inside any code block range. */
function isInsideCodeBlock(
  offset: number,
  ranges: readonly CodeBlockRange[],
): boolean {
  return ranges.some((r) => offset >= r.start && offset < r.end);
}

// ---------------------------------------------------------------------------
// Reference resolution
// ---------------------------------------------------------------------------

/** Result of resolving a single include reference. */
interface ResolveResult {
  readonly replacement: string | undefined;
  readonly diagnostic: Diagnostic | undefined;
}

/** Resolve a reference and apply the optional filter. */
function resolveRef(
  ref: string,
  filter: string | undefined,
  options: IncludeOptions,
): Promise<ResolveResult> {
  // Check if it looks like a file path (contains / or .md or #).
  if (ref.includes("/") || ref.includes(".md")) {
    return resolveFileRef(ref, filter, options);
  }

  // Display ID lookup — synchronous, wrapped in a resolved promise.
  return Promise.resolve(resolveEntryRef(ref, filter, options));
}

/** Resolve a display ID reference from the compiled model. */
function resolveEntryRef(
  ref: string,
  filter: string | undefined,
  options: IncludeOptions,
): ResolveResult {
  const entry = options.compiled.entries.get(ref);

  if (!entry) {
    return {
      replacement: undefined,
      diagnostic: {
        code: "INC-E001",
        severity: "error",
        message: `unresolved include reference: ${ref}`,
        location: undefined,
      },
    };
  }

  return {
    replacement: renderEntry(entry, filter),
    diagnostic: undefined,
  };
}

/** Resolve a file path reference, optionally with a #heading anchor. */
async function resolveFileRef(
  ref: string,
  filter: string | undefined,
  options: IncludeOptions,
): Promise<ResolveResult> {
  const hashIndex = ref.indexOf("#");
  const filePath = hashIndex >= 0 ? ref.slice(0, hashIndex) : ref;
  const anchor = hashIndex >= 0 ? ref.slice(hashIndex + 1) : undefined;

  const resolvedPath = filePath.startsWith("/")
    ? filePath
    : `${options.basePath}/${filePath}`;

  let content: string;
  try {
    content = await options.readFile(resolvedPath);
  } catch {
    return {
      replacement: undefined,
      diagnostic: {
        code: "INC-E002",
        severity: "error",
        message: `failed to read include file: ${resolvedPath}`,
        location: undefined,
      },
    };
  }

  if (anchor) {
    const section = extractSection(content, anchor);
    if (section === undefined) {
      return {
        replacement: undefined,
        diagnostic: {
          code: "INC-E003",
          severity: "error",
          message: `heading anchor not found: #${anchor} in ${resolvedPath}`,
          location: undefined,
        },
      };
    }
    return {
      replacement: applyTextFilter(section, filter),
      diagnostic: undefined,
    };
  }

  return {
    replacement: applyTextFilter(content, filter),
    diagnostic: undefined,
  };
}

// ---------------------------------------------------------------------------
// Section extraction
// ---------------------------------------------------------------------------

/**
 * Extract a section from markdown content by heading slug.
 *
 * Finds the first heading whose slugified text matches the anchor,
 * then returns all content from that heading up to the next heading
 * of equal or higher level (or end of file).
 */
function extractSection(
  content: string,
  anchor: string,
): string | undefined {
  const lines = content.split("\n");
  const headingRe = /^(#{1,6})\s+(.+)$/;
  let startLine: number | undefined;
  let startLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const m = headingRe.exec(lines[i]);
    if (!m) continue;

    const level = m[1].length;
    const slug = slugify(m[2]);

    if (startLine === undefined) {
      if (slug === anchor) {
        startLine = i;
        startLevel = level;
      }
    } else {
      // Found a subsequent heading at same or higher level — stop.
      if (level <= startLevel) {
        return lines.slice(startLine, i).join("\n").trimEnd();
      }
    }
  }

  if (startLine !== undefined) {
    return lines.slice(startLine).join("\n").trimEnd();
  }

  return undefined;
}

/** Slugify a heading into a URL-compatible anchor. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

// ---------------------------------------------------------------------------
// Entry rendering
// ---------------------------------------------------------------------------

/** Render an entry to Markdown based on the filter. */
function renderEntry(entry: Entry, filter: string | undefined): string {
  if (filter === "title-only") {
    return `**[${entry.displayId}] ${entry.title}**`;
  }

  if (filter === "body-only") {
    return entry.body;
  }

  // Full entry — list item with body and attributes.
  const parts: string[] = [];
  parts.push(`- [${entry.displayId}] ${entry.title}`);

  if (entry.body) {
    parts.push("");
    // Indent body lines under the list item.
    const bodyLines = entry.body.split("\n");
    for (const line of bodyLines) {
      parts.push(line ? `  ${line}` : "");
    }
  }

  const attrLines = renderAttributes(entry);
  if (attrLines.length > 0) {
    parts.push("");
    for (let i = 0; i < attrLines.length; i++) {
      const suffix = i < attrLines.length - 1 ? " \\" : "";
      parts.push(`  ${attrLines[i]}${suffix}`);
    }
  }

  return parts.join("\n");
}

/** Render entry attributes as `Key: Value` lines. */
function renderAttributes(entry: Entry): string[] {
  const lines: string[] = [];

  if (entry.id) {
    lines.push(`Id: ${entry.id}`);
  }

  for (const attr of entry.attributes) {
    // Skip Id — already handled above.
    if (attr.key === "Id") continue;
    lines.push(`${attr.key}: ${attr.value}`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Text filter for file includes
// ---------------------------------------------------------------------------

/** Apply a text-level filter (for file-based includes). */
function applyTextFilter(
  text: string,
  filter: string | undefined,
): string {
  if (!filter) return text;

  if (filter === "title-only") {
    // Extract the first heading or first line.
    const lines = text.split("\n");
    for (const line of lines) {
      const m = /^#{1,6}\s+(.+)$/.exec(line);
      if (m) return `**${m[1]}**`;
    }
    // Fallback: first non-empty line.
    const first = lines.find((l) => l.trim().length > 0);
    return first ? `**${first.trim()}**` : "";
  }

  if (filter === "body-only") {
    // Skip the first heading and return the rest.
    const lines = text.split("\n");
    let pastHeading = false;
    const bodyLines: string[] = [];
    for (const line of lines) {
      if (!pastHeading && /^#{1,6}\s+/.test(line)) {
        pastHeading = true;
        continue;
      }
      if (pastHeading || !/^#{1,6}\s+/.test(line)) {
        bodyLines.push(line);
      }
    }
    return bodyLines.join("\n").trim();
  }

  return text;
}
