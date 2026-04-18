/**
 * @module formatter
 *
 * Markdown formatter and ULID assigner. Handles write-back operations:
 * ULID stamping, indentation normalization, trailing backslash enforcement,
 * and requirement block insertion.
 */

import { ulid as defaultUlid } from "@std/ulid";
import type {
  Attribute,
  Diagnostic,
  Entry,
  EntryFamily,
} from "../model/mod.ts";
import { attributeSpec, IDENTITY_KEY_BY_FAMILY } from "../model/mod.ts";
import { ATTR_LINE_RE } from "../parser/attributes.ts";
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
 * Canonical attribute ordering for spec entries per ADR-002 Annex C.
 *
 * Identity comes first; family-specific relations next; universal attributes
 * last (Labels/Status/External-id/Supersedes). Unknown keys go just before
 * Labels, preserving their relative order.
 *
 * Legacy `Id:` appears right after `Spec-id:` so pre-v2 fixtures keep the
 * same relative ordering they used to produce.
 */
const SPEC_CANONICAL_ORDER: readonly string[] = [
  "Spec-id",
  "Id",
  "Satisfies",
  "Derived-from",
  "Allocated-to",
  "References",
  "Labels",
  "Status",
  "External-id",
  "Supersedes",
];

/** Canonical attribute ordering for test entries per ADR-002 Annex C. */
const TEST_CANONICAL_ORDER: readonly string[] = [
  "Test-id",
  "Test-level",
  "Verifies",
  "Tests",
  "References",
  "Labels",
  "Status",
  "External-id",
  "Supersedes",
];

/** Canonical attribute ordering for element entries per ADR-002 Annex C. */
const ELEMENT_CANONICAL_ORDER: readonly string[] = [
  "Element-id",
  "Element-kind",
  "Part-of",
  "Realizes",
  "Depends-on",
  "Generated-from",
  "References",
  "Labels",
  "Status",
  "External-id",
  "Supersedes",
];

/**
 * Canonical attribute ordering for reference entries per ADR-002 Annex C.
 *
 * Legacy `URI` / `URL` / `Document` appear after their v2 equivalents to
 * keep old fixtures producing the same relative order.
 */
const REF_CANONICAL_ORDER: readonly string[] = [
  "Reference-id",
  "URI",
  "Reference-url",
  "URL",
  "Reference-document",
  "Document",
  "Labels",
  "Status",
  "External-id",
  "Supersedes",
  "Superseded-by",
];

/** Identity attribute keys (new + legacy) that count as "entry identity". */
const IDENTITY_KEYS: readonly string[] = [
  "Spec-id",
  "Test-id",
  "Element-id",
  "Reference-id",
  "Id",
];

function canonicalOrderFor(family: EntryFamily): readonly string[] {
  switch (family) {
    case "spec":
      return SPEC_CANONICAL_ORDER;
    case "test":
      return TEST_CANONICAL_ORDER;
    case "element":
      return ELEMENT_CANONICAL_ORDER;
    case "reference":
      return REF_CANONICAL_ORDER;
  }
}

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

  const genUlid = options?.generateUlid ?? defaultUlid;

  for (const entry of sorted) {
    const indent = (entry.location.column - 1) + 2;
    let attrs = [...entry.attributes];

    // Assign a bare ULID identity attribute to Spec/Test/Element entries
    // that carry no identity yet. Reference entries are left alone —
    // `Reference-id` is authored (a URI), not generated.
    const hasIdentity = attrs.some((a) => IDENTITY_KEYS.includes(a.key));
    if (!hasIdentity && entry.family !== "reference") {
      const key = IDENTITY_KEY_BY_FAMILY[entry.family];
      const newId = genUlid();
      attrs = [{ key, value: newId }, ...attrs];
      diagnostics.push({
        code: "MSL-F001",
        severity: "info",
        message: `assigned ${key}: ${newId} to ${entry.displayId}`,
        location: entry.location,
      });
    }

    if (attrs.length === 0) continue;

    const normalized = sortAttributes(expandCsvValues(attrs), entry.family);
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

  return { output: lines.join("\n"), diagnostics, changed };
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
 * Sort attributes to canonical order based on entry family.
 * Unknown keys are placed before Labels, preserving their relative order.
 */
export function sortAttributes(
  attributes: Attribute[],
  family: EntryFamily,
): Attribute[] {
  const CANONICAL_ORDER = canonicalOrderFor(family);

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
