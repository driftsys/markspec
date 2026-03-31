/**
 * @module render/styles
 *
 * Transforms requirement entry blocks in Markdown source into a
 * styled format for PDF/HTML rendering. Entry list items matching
 * `- [DISPLAY_ID] Title` are replaced with structured Markdown that
 * renders with clear visual hierarchy through cmarker: ID in
 * monospace, title bold, body preserved, attributes in a compact
 * table, separated from prose by horizontal rules.
 */

import type { CompileResult, Diagnostic } from "../../core/mod.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result of styling requirement blocks. */
export interface StyleResult {
  /** The transformed Markdown output. */
  readonly output: string;
  /** Diagnostics produced during transformation. */
  readonly diagnostics: readonly Diagnostic[];
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * Typed entry display ID: `TYPE_XYZ_NNN[N]`.
 * TYPE = 2+ uppercase letters, XYZ = 2-12 uppercase letters,
 * NNN[N] = 3 or 4 zero-padded digits.
 */
const TYPED_ID_RE = /^[A-Z]{2,}_[A-Z]{2,12}_\d{3,4}$/;

/**
 * Reference entry display ID: letters, digits, hyphens.
 */
const REF_ID_RE = /^[A-Za-z0-9-]{2,}$/;

/**
 * Matches a list item start: `- [DISPLAY_ID] Title`.
 * Group 1 = display ID, group 2 = title text.
 */
const ENTRY_START_RE = /^- \[([^\]]+)\]\s*(.*)$/;

/**
 * Attribute line: `Key: Value` with optional trailing backslash.
 */
const ATTR_LINE_RE = /^[A-Z][A-Za-z-]*: .+\\?$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transform requirement entry blocks for styled rendering.
 *
 * Uses entries from the compiled model to identify which list items
 * in the Markdown are requirement entries. Replaces each entry list
 * item with a styled version: ID in monospace, title bold, body
 * preserved, attributes in a compact table, with horizontal rules
 * for visual separation.
 *
 * Non-entry content is preserved unchanged.
 *
 * @param markdown - Input Markdown content
 * @param compiled - Compiled project model with known entries
 * @returns Styled Markdown and diagnostics
 */
export function styleRequirementBlocks(
  markdown: string,
  compiled: CompileResult,
): StyleResult {
  if (compiled.entries.size === 0) {
    return { output: markdown, diagnostics: [] };
  }

  // Build a set of known display IDs for fast lookup.
  const knownIds = new Set(compiled.entries.keys());

  const lines = markdown.split("\n");
  const outputLines: string[] = [];
  const diagnostics: Diagnostic[] = [];

  let i = 0;
  while (i < lines.length) {
    const match = ENTRY_START_RE.exec(lines[i]);

    if (!match) {
      outputLines.push(lines[i]);
      i++;
      continue;
    }

    const displayId = match[1];
    const title = match[2].trim();

    // Only transform if the ID is a known entry and matches valid format.
    if (
      !knownIds.has(displayId) ||
      (!TYPED_ID_RE.test(displayId) && !REF_ID_RE.test(displayId))
    ) {
      outputLines.push(lines[i]);
      i++;
      continue;
    }

    // Found an entry start. Consume the entire entry block.
    i++; // Move past the `- [ID] Title` line.

    // Determine indentation level (entry body is indented under list item).
    const indent = "  ";

    // Collect body and attribute lines.
    const bodyLines: string[] = [];
    const attrLines: { key: string; value: string }[] = [];

    // First, collect all indented continuation lines.
    const rawBodyLines: string[] = [];
    while (i < lines.length) {
      const line = lines[i];

      // An empty line within the entry body is preserved.
      if (line.trim() === "") {
        // Check if the next non-empty line is still part of this entry.
        // Peek ahead to see if there's more indented content.
        const nextNonEmpty = findNextNonEmptyLine(lines, i + 1);
        if (
          nextNonEmpty !== undefined &&
          lines[nextNonEmpty].startsWith(indent)
        ) {
          rawBodyLines.push("");
          i++;
          continue;
        }
        // Empty line with no more indented content — end of entry.
        break;
      }

      // Line must be indented to be part of entry body.
      if (!line.startsWith(indent)) {
        break;
      }

      rawBodyLines.push(line.slice(indent.length));
      i++;
    }

    // Split raw body lines into body text and trailing attributes.
    const { body, attributes } = splitBodyAttributes(rawBodyLines);
    bodyLines.push(...body);
    attrLines.push(...attributes);

    // Build styled output.
    outputLines.push("---");
    outputLines.push("");
    outputLines.push(`\`${displayId}\` **${title}**`);

    if (bodyLines.length > 0) {
      outputLines.push("");
      outputLines.push(...bodyLines);
    }

    if (attrLines.length > 0) {
      outputLines.push("");
      outputLines.push("| | |");
      outputLines.push("|---|---|");
      for (const attr of attrLines) {
        const valueFormatted = formatAttrValue(attr.key, attr.value);
        outputLines.push(`| **${attr.key}** | ${valueFormatted} |`);
      }
    }

    outputLines.push("");
    outputLines.push("---");
  }

  return { output: outputLines.join("\n"), diagnostics };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Find the index of the next non-empty line, or undefined. */
function findNextNonEmptyLine(
  lines: readonly string[],
  start: number,
): number | undefined {
  for (let i = start; i < lines.length; i++) {
    if (lines[i].trim() !== "") return i;
  }
  return undefined;
}

/**
 * Split raw body lines into body text and trailing attribute block.
 *
 * Attributes are `Key: Value` lines at the end of the content,
 * forming a contiguous block. Blank lines between body and
 * attributes are consumed as separators.
 */
function splitBodyAttributes(
  lines: readonly string[],
): { body: string[]; attributes: { key: string; value: string }[] } {
  // Walk backwards to find the contiguous trailing attribute block.
  let attrStart = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      // Empty line: if we haven't started collecting attributes, skip.
      // If we have attributes below, this blank line is the boundary.
      if (attrStart < lines.length) break;
      continue;
    }
    if (ATTR_LINE_RE.test(trimmed)) {
      attrStart = i;
    } else {
      break;
    }
  }

  const bodyPart = lines.slice(0, attrStart);
  const attrPart = lines.slice(attrStart);

  // Trim trailing empty lines from body.
  const trimmedBody = [...bodyPart];
  while (
    trimmedBody.length > 0 && trimmedBody[trimmedBody.length - 1].trim() === ""
  ) {
    trimmedBody.pop();
  }

  // Parse attribute lines.
  const attributes: { key: string; value: string }[] = [];
  for (const line of attrPart) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = /^([A-Z][A-Za-z-]*): (.+?)\\?$/.exec(trimmed);
    if (m) {
      attributes.push({ key: m[1], value: m[2].trim() });
    }
  }

  return { body: trimmedBody, attributes };
}

/**
 * Format an attribute value for display in a table.
 *
 * IDs and link references are rendered in monospace code.
 * Labels and plain text are rendered as-is.
 */
function formatAttrValue(key: string, value: string): string {
  // Id values are always monospace.
  if (key === "Id") {
    return `\`${value}\``;
  }

  // Link attributes (Satisfies, Derived-from, Allocates, Verifies, Implements)
  // contain display IDs — render each in monospace.
  if (
    key === "Satisfies" || key === "Derived-from" ||
    key === "Allocates" || key === "Verifies" || key === "Implements"
  ) {
    return value.split(",").map((v) => `\`${v.trim()}\``).join(", ");
  }

  return value;
}
