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
 * Canonical attribute ordering per the language spec.
 *
 * Identity (`Id:`) comes first, then profile-declared attributes appear in
 * the order the author wrote them (or in the order a profile-aware pass
 * may rewrite them), then the universal set
 * (References / Labels / External-id / Supersedes / Deprecated). Unknown
 * keys are placed just before `Labels:`, preserving their relative order.
 *
 * A profile-aware formatter may extend this with profile-declared canonical
 * positions; the core formatter only knows about `Id:` and the universal
 * set.
 */
const CANONICAL_ORDER: readonly string[] = [
  "Id",
  // Profile-declared attributes land here in whatever order the source has
  // them; the filler slot keeps them between Id and the universal set.
  "References",
  "Labels",
  "External-id",
  "Supersedes",
  "Superseded-by",
  "Deprecated",
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
  const body = fm.hadFrontMatter ? fm.markdown : markdown;
  const entries = parseMarkdown(body, { file });
  const diagnostics: Diagnostic[] = [...fm.diagnostics];

  if (entries.length === 0 && !fm.hadFrontMatter) {
    return { output: markdown, diagnostics, changed: false };
  }

  const lines = body.split("\n");
  let changed = false;

  // Process bottom-to-top so line splicing doesn't shift earlier entries.
  const sorted = [...entries].sort((a, b) => b.location.line - a.location.line);

  const genUlid = options?.generateUlid ?? defaultUlid;

  for (const entry of sorted) {
    const indent = (entry.location.column - 1) + 2;
    let attrs = [...entry.rawAttributes];

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

  const formattedBody = lines.join("\n");

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
 * Sort attributes to canonical order per the language spec.
 *
 * `Id:` first, then profile-declared/unknown keys in source order, then
 * universal attributes (References / Labels / External-id / Supersedes /
 * Superseded-by / Deprecated).
 */
export function sortAttributes(
  attributes: Attribute[],
): Attribute[] {
  const known: (Attribute[] | undefined)[] = new Array(CANONICAL_ORDER.length);
  const unknown: Attribute[] = [];

  for (const attr of attributes) {
    const idx = CANONICAL_ORDER.indexOf(attr.key);
    if (idx >= 0) {
      // Preserve duplicates — keep all occurrences of the same key.
      if (!known[idx]) known[idx] = [];
      known[idx]!.push(attr);
    } else {
      unknown.push(attr);
    }
  }

  const result: Attribute[] = [];
  const labelsIdx = CANONICAL_ORDER.indexOf("Labels");
  const hasLabels = known[labelsIdx] != null;

  for (let i = 0; i < known.length; i++) {
    // Insert unknown attributes just before Labels (or at end if no Labels).
    if (i === labelsIdx && hasLabels) {
      result.push(...unknown);
    }
    if (known[i] != null) {
      result.push(...known[i]!);
    }
  }

  // If Labels was not present, unknown attrs go at the end.
  if (!hasLabels) {
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
