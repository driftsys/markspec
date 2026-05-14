/**
 * @module formatter
 *
 * Markdown formatter and ULID assigner. Handles write-back operations:
 * ULID stamping, indentation normalization, trailing backslash enforcement,
 * and requirement block insertion.
 */

import { ulid as defaultUlid } from "@std/ulid";
import { stringify as stringifyYaml } from "@std/yaml";
import type {
  Attribute,
  Diagnostic,
  DocumentAttributes,
  Entry,
} from "../model/mod.ts";
import { attributeSpec, IDENTITY_KEY } from "../model/mod.ts";
import { ATTR_LINE_RE } from "../parser/attributes.ts";
import { extractFrontMatter } from "../parser/frontmatter.ts";
import { parseMarkdown } from "../parser/markdown.ts";
import { walkProseLines } from "../util/fence.ts";

/**
 * Value types that accept CSV on input but must be emitted as multi-line
 * per ADR-002 §2.6. `citation` is deliberately excluded because locators
 * may contain commas.
 */
const CSV_SPLITTABLE_TYPES: ReadonlySet<string> = new Set([
  "id-list",
  "tag-list",
  "external-id",
]);

/**
 * RFC 2119 modal keywords in uppercase form, with optional ` NOT` suffix.
 * Captured for canonical-form normalisation per spec §3.4.1: uppercase
 * input is accepted but emitted lowercase, unconditionally.
 */
const RFC2119_MODAL_RE = /\b(SHALL|SHOULD|MAY|MUST)(\s+NOT)?\b/g;

/**
 * EARS keywords subject to the sentence-initial rule of spec §3.4.1:
 * lowercased when mid-sentence, preserved when starting a sentence.
 * `If…then` is deferred to a later slice because its multi-token form
 * needs separate handling.
 */
const EARS_KEYWORD_RE = /\b(When|While|Where|Unless)\b/g;

/**
 * Decide whether the EARS keyword at `offset` in `line` is at sentence
 * start (return value true). Walks left over whitespace and reports true
 * when it hits the beginning of the line or a sentence-terminating
 * punctuation character (`.`, `!`, `?`).
 */
function isSentenceInitial(line: string, offset: number): boolean {
  if (offset === 0) return true;
  let i = offset - 1;
  while (i >= 0 && (line[i] === " " || line[i] === "\t")) i--;
  if (i < 0) return true;
  const prev = line[i];
  return prev === "." || prev === "!" || prev === "?";
}

/**
 * Normalise modal keywords to canonical case in body prose (§3.4.1):
 *
 *   - RFC 2119 (`SHALL`, `SHOULD`, `MAY`, `MUST`, optionally `… NOT`) —
 *     always lowercased.
 *   - EARS (`When`, `While`, `Where`, `Unless`) — lowercased mid-sentence,
 *     preserved sentence-initial.
 *
 * The pass skips:
 *
 *   - Fenced code blocks (between paired ``` or ~~~ markers) — code is
 *     verbatim per round-trip invariants (spec §5.1).
 *   - Lines indented by four or more spaces (or a tab) — conservatively
 *     captures indented code blocks and attribute trailers, both of which
 *     are not prose.
 */
export function normalizeModalKeywords(markdown: string): string {
  const lines = markdown.split("\n");
  walkProseLines(markdown, (line, i) => {
    // Indented-code / attribute-trailer lines aren't prose either.
    if (/^( {4}|\t)/.test(line)) return;
    let normalized = line.replace(RFC2119_MODAL_RE, (m) => m.toLowerCase());
    normalized = normalized.replace(
      EARS_KEYWORD_RE,
      (m, _g1: string, offset: number) =>
        isSentenceInitial(normalized, offset) ? m : m.toLowerCase(),
    );
    lines[i] = normalized;
  });
  return lines.join("\n");
}

/**
 * Canonical front-matter key order per ADR-007. Core keys first, then
 * `metadata` (reserved free-form map), then `extra` (allowlisted ecosystem
 * keys / profile keys) are emitted verbatim at the end.
 */
const FRONT_MATTER_CORE_ORDER: readonly string[] = [
  "document-id",
  "document-type",
  "labels",
  "deprecated",
  "external-id",
  "supersedes",
  "references",
];

/**
 * Canonical trailer ordering per spec §3.3.2 (six-group rule).
 *
 * Groups, top → bottom:
 *   1. Identity & classification — `Id`, `Type`, `Source`, `Origin`.
 *   2. Reference-shape navigation — `Reference-document`, `Reference-url`.
 *   3. Trace upstream relations — authored trace edges (`Part-of`,
 *      `Derived-from`, `Satisfies`, …).
 *   4. Type-specific data — payload attributes per concrete type
 *      (`Schema-language`, `License`, `Manufacturer`, …).
 *   5. Universal trailing — `References`, `External-id`, `Labels`,
 *      `Supersedes`, `Deprecated`.
 *   6. Profile-declared / unknown attributes — preserved in source order
 *      at the bottom (§3.3.6: fmt never deletes a key it doesn't own).
 *
 * Generated-origin attributes (`Superseded-by`, every inverse from ADR-003
 * §Part 3) are stripped from this list; the formatter rejects them with
 * MSL-A030 when found in source (current code keeps `Superseded-by:` to
 * round-trip historical fixtures — that hardening lands in a later slice).
 */
const CANONICAL_ORDER: readonly string[] = [
  // Group 1 — identity & classification
  "Id",
  "Type",
  "Source",
  "Origin",
  // Group 2 — reference-shape navigation
  "Reference-document",
  "Reference-url",
  // Group 3 — trace upstream (authored relations)
  "Part-of",
  "Derived-from",
  "Satisfies",
  "Verifies",
  "Tests",
  "Realizes",
  "Provides",
  "Requires",
  "Depends-on",
  "Caused-by",
  "Mitigated-by",
  "Allocated-to",
  "Affects",
  // Group 4 — type-specific data
  "Schema-language",
  "License",
  "Build-manifest",
  "Package-manager",
  "Manufacturer",
  "Part-number",
  "Datasheet",
  "Bus-protocol",
  "Connector-type",
  "Voltage-level",
  "Signal-direction",
  "Symbol",
  "Language",
  "Footprint",
  "Value",
  "Aliases",
  "See-also",
  // Group 5 — universal trailing
  "References",
  "External-id",
  "Labels",
  "Supersedes",
  "Superseded-by",
  "Deprecated",
  // Group 6 — profile-declared / unknown keys are appended in source order
  // after this list by sortAttributes().
];

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

  // Extract any YAML front matter first so entries are parsed against the
  // body only (front-matter `---` could be confused with horizontal rules).
  const fm = extractFrontMatter(markdown, { file });
  const rawBody = fm.hadFrontMatter ? fm.markdown : markdown;
  // Body-level canonical-form pass (§3.4.1 modal-keyword normalisation).
  // Skips fenced code and indented code / trailers; case-only rewrite, so
  // line/column positions are preserved for the entry-block pass below.
  const body = normalizeModalKeywords(rawBody);
  const { entries } = parseMarkdown(body, { file });
  const diagnostics: Diagnostic[] = [...fm.diagnostics];

  if (entries.length === 0 && !fm.hadFrontMatter) {
    return { output: markdown, diagnostics, changed: body !== rawBody };
  }

  const lines = body.split("\n");
  let changed = body !== rawBody;

  // Process bottom-to-top so line splicing doesn't shift earlier entries.
  const sorted = [...entries].sort((a, b) => b.location.line - a.location.line);

  const genUlid = options?.generateUlid ?? defaultUlid;

  for (const entry of sorted) {
    const indent = (entry.location.column - 1) + 2;
    let attrs = [...entry.rawAttributes];

    // Title-line bullet canonicalisation per spec §3.2: rewrite `*`
    // or `+` to `-`. The list-item position from the parser is the
    // line carrying the bullet marker; we only touch the marker
    // character itself, leaving the rest of the title alone.
    const titleLineIdx = entry.location.line - 1;
    if (titleLineIdx >= 0 && titleLineIdx < lines.length) {
      const titleLine = lines[titleLineIdx];
      const markerCol = entry.location.column - 1;
      const markerChar = titleLine.charAt(markerCol);
      if (markerChar === "*" || markerChar === "+") {
        lines[titleLineIdx] = titleLine.slice(0, markerCol) +
          "-" + titleLine.slice(markerCol + 1);
        changed = true;
      }
    }

    // Assign a bare ULID `Id:` to identified entries that carry no
    // identity yet. Referenced entries are left alone — their `Id:` is a
    // URI that must be author-provided.
    const hasIdentity = attrs.some((a) => a.key === IDENTITY_KEY);
    if (!hasIdentity && entry.shape === "identified") {
      const newId = genUlid();
      attrs = [{ key: IDENTITY_KEY, value: newId }, ...attrs];
      diagnostics.push({
        code: "MSL-F001",
        severity: "info",
        message: `assigned Id: ${newId} to ${entry.displayId}`,
        location: entry.location,
      });
    }

    if (attrs.length === 0) continue;

    const normalized = sortAttributes(expandCsvValues(attrs));
    const range = findAttributeBlockRange(lines, entry.location.line, indent);

    if (range) {
      // Replace existing attribute block.
      const newBlock = renderAttributeBlock(normalized, indent);
      const oldBlock = lines.slice(range.start, range.end).join("\n");

      if (newBlock !== oldBlock) {
        lines.splice(
          range.start,
          range.end - range.start,
          ...newBlock.split("\n"),
        );
        changed = true;
      }
    } else {
      // No attribute block — insert one after the entry body.
      const insertLine = findEntryBodyEnd(lines, entry, indent);
      const newBlock = renderAttributeBlock(normalized, indent);
      lines.splice(insertLine, 0, "", ...newBlock.split("\n"));
      changed = true;
    }
  }

  // Spec §3.4.3 / §5.2 — collapse consecutive blank lines to one.
  // Runs after entry-block splicing so the in-progress line indices
  // stay aligned with parser-reported positions. Operates inside
  // fenced code regions only outside-code; verbatim regions keep
  // their blank-line counts.
  const collapsedLines = collapseBlankLines(lines);
  if (collapsedLines.length !== lines.length) changed = true;
  const formattedBody = collapsedLines.join("\n");

  if (fm.hadFrontMatter) {
    const canonicalFm = renderFrontMatter(fm.attributes);
    const output = canonicalFm + formattedBody;
    if (output !== markdown) changed = true;
    return { output, diagnostics, changed };
  }

  return { output: formattedBody, diagnostics, changed };
}

/**
 * Render {@linkcode DocumentAttributes} as a canonical YAML front matter
 * block. Keys are emitted in canonical order (core → metadata → extra);
 * an `extra` subtree is flattened to top-level keys per ADR-007
 * allowlist conventions.
 */
function renderFrontMatter(attrs: DocumentAttributes): string {
  const ordered: Record<string, unknown> = {};
  const a = attrs as Record<string, unknown>;

  for (const key of FRONT_MATTER_CORE_ORDER) {
    if (a[key] !== undefined) ordered[key] = a[key];
  }
  if (a.metadata !== undefined) ordered.metadata = a.metadata;
  if (a.extra && typeof a.extra === "object") {
    for (const [key, value] of Object.entries(a.extra)) {
      ordered[key] = value;
    }
  }

  if (Object.keys(ordered).length === 0) {
    return "---\n---\n\n";
  }

  const yaml = stringifyYaml(ordered).trimEnd();
  return `---\n${yaml}\n---\n\n`;
}

/**
 * Collapse consecutive blank lines to a single blank line per spec
 * §3.4.3 (caption boundary) / §5.2 (general body rule). Fenced code
 * regions are preserved verbatim — blank-line counts inside fenced
 * blocks are author intent, not noise.
 */
function collapseBlankLines(lines: readonly string[]): string[] {
  const out: string[] = [];
  let inFence = false;
  let prevBlank = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      out.push(line);
      inFence = !inFence;
      prevBlank = false;
      continue;
    }
    if (inFence) {
      out.push(line);
      prevBlank = false;
      continue;
    }
    const isBlank = line.trim() === "";
    if (isBlank && prevBlank) continue;
    out.push(line);
    prevBlank = isBlank;
  }
  return out;
}

/**
 * Expand CSV values on repeatable-type attributes into one entry per value
 * per ADR-002 §2.6. `id-list` / `tag-list` / `external-id` accept CSV input
 * but must round-trip as multi-line output; `citation` is left alone
 * because locators may contain commas.
 */
export function expandCsvValues(attrs: Attribute[]): Attribute[] {
  const result: Attribute[] = [];
  for (const attr of attrs) {
    const spec = attributeSpec(attr.key);
    if (
      spec && CSV_SPLITTABLE_TYPES.has(spec.type) && attr.value.includes(",")
    ) {
      const values = attr.value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const value of values) {
        result.push({ key: attr.key, value });
      }
    } else {
      result.push(attr);
    }
  }
  return result;
}

/**
 * Canonicalise a trailer key to TitleCase-Hyphenated per spec §3.3.4.
 * First character of the key uppercase, every other character
 * lowercase; hyphens preserved. Examples (from the spec):
 *
 *   `Id`, `Derived-from`, `Reference-url`, `Bus-protocol`.
 *
 * Inputs like `ID`, `BUS-PROTOCOL`, `reference-URL`, `Derived-From`
 * all canonicalise to the spec form regardless of casing in source.
 */
export function canonicalizeKey(key: string): string {
  if (key.length === 0) return key;
  return key[0].toUpperCase() + key.slice(1).toLowerCase();
}

/**
 * Sort attributes to canonical trailer order per spec §3.3.2 and
 * re-case each key per spec §3.3.4.
 *
 * Known core keys appear in their {@linkcode CANONICAL_ORDER} slot
 * (lookup is case-insensitive via {@linkcode canonicalizeKey}).
 * Unknown / profile-declared keys (group 6) are appended at the end
 * in source order — `fmt` never deletes a key it doesn't own
 * (§3.3.6). Every emitted attribute carries the canonical key form.
 */
export function sortAttributes(
  attributes: Attribute[],
): Attribute[] {
  const known: (Attribute[] | undefined)[] = new Array(CANONICAL_ORDER.length);
  const unknown: Attribute[] = [];

  for (const attr of attributes) {
    const canonical = canonicalizeKey(attr.key);
    const recased: Attribute = canonical === attr.key
      ? attr
      : { ...attr, key: canonical };
    const idx = CANONICAL_ORDER.indexOf(canonical);
    if (idx >= 0) {
      // Preserve duplicates — keep all occurrences of the same key.
      if (!known[idx]) known[idx] = [];
      known[idx]!.push(recased);
    } else {
      unknown.push(recased);
    }
  }

  const result: Attribute[] = [];
  for (let i = 0; i < known.length; i++) {
    if (known[i] != null) {
      result.push(...known[i]!);
    }
  }
  result.push(...unknown);
  return result;
}

/**
 * Render attributes as an indented code block.
 * Each line is `Key: Value` at (indent + 4) absolute columns;
 * no trailing line-continuation characters.
 *
 * @param attributes - The attributes to render, in canonical order.
 * @param indent - Body indent for the entry (2 for list-wrapped entries,
 *   0 for entries inside source-file doc comments).
 */
export function renderAttributeBlock(
  attributes: Attribute[],
  indent: number,
): string {
  const prefix = " ".repeat(indent + 4);
  return attributes
    .map((attr) => `${prefix}${attr.key}: ${attr.value}`)
    .join("\n");
}

/**
 * Find the 0-based line index where a list item's content ends.
 * Scans forward from the entry start, stopping at: a sibling list item
 * (`- ` at the entry's marker column), a line with less indent, or EOF.
 */
function findItemEnd(
  lines: readonly string[],
  startIdx: number,
  indent: number,
): number {
  const indentStr = " ".repeat(indent);
  // The marker column is indent - 2 (e.g., indent 2 → marker at column 0).
  const markerPrefix = " ".repeat(Math.max(0, indent - 2)) + "- ";

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    // Sibling list item at same level
    if (line.startsWith(markerPrefix)) return i;
    // Line with less indent than continuation
    if (!line.startsWith(indentStr)) return i;
  }
  return lines.length;
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
  const startIdx = entryStartLine - 1;
  const itemEnd = findItemEnd(lines, startIdx, indent);

  // Walk backwards from itemEnd, skip trailing blank lines.
  let scanEnd = itemEnd;
  while (scanEnd > startIdx && lines[scanEnd - 1].trim() === "") {
    scanEnd--;
  }

  if (scanEnd <= startIdx) return undefined;

  // Walk backwards collecting attribute lines.
  let attrStart = scanEnd;
  for (let i = scanEnd - 1; i > startIdx; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "") break;
    if (ATTR_LINE_RE.test(trimmed)) {
      attrStart = i;
    } else {
      break;
    }
  }

  if (attrStart >= scanEnd) return undefined;

  return { start: attrStart, end: scanEnd };
}

/**
 * Find the 0-based line index where a new attribute block should be inserted
 * (after the last non-blank body line of the entry).
 */
function findEntryBodyEnd(
  lines: readonly string[],
  entry: Entry,
  indent: number,
): number {
  const startIdx = entry.location.line - 1;
  const itemEnd = findItemEnd(lines, startIdx, indent);

  let insertAt = itemEnd;
  while (insertAt > startIdx && lines[insertAt - 1].trim() === "") {
    insertAt--;
  }

  return insertAt;
}
