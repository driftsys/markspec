/**
 * @module parser/attributes
 *
 * Parses `Key: Value` attribute blocks from entry bodies.
 * Handles trailing backslash separators and distinguishes
 * trailing attribute blocks from body prose.
 */

import type { Attribute, TypedAttributes } from "../model/mod.ts";
import { attributeSpec, CSV_SPLITTABLE_TYPES } from "../model/attributes.ts";

/**
 * Pattern matching a `Key: Value` attribute line.
 * Key must start with an uppercase letter, may contain lowercase letters and hyphens.
 * Value is everything after `:` (with optional space), with optional trailing
 * backslash stripped. The value group is optional so that `Key:` and `Key: \`
 * are recognized (and subsequently skipped as empty-value lines) rather than
 * silently ignored.
 */
const ATTRIBUTE_RE = /^([A-Z][A-Za-z-]*):\s*(.*?)\\?$/;

/**
 * Parse an array of attribute lines into Attribute objects.
 *
 * Each line is expected to be in `Key: Value` format, with optional
 * trailing backslash (`\`) as a continuation marker. Lines that do
 * not match the pattern are silently skipped.
 *
 * @param lines - Raw attribute lines (already separated from body)
 * @returns Parsed attributes
 */
export function parseAttributes(lines: readonly string[]): Attribute[] {
  const attributes: Attribute[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = ATTRIBUTE_RE.exec(trimmed);
    if (match) {
      const value = (match[2] ?? "").trim();
      if (!value) continue; // skip empty-value lines — `Key:` or `Key: \`
      attributes.push({ key: match[1], value });
    }
  }

  return attributes;
}

/**
 * Pattern matching a `Key: Value` line (with or without trailing backslash).
 * Used to detect attribute blocks at the end of entry bodies.
 */
export const ATTR_LINE_RE = /^[A-Z][A-Za-z-]*: .+\\?$/;

/**
 * Collate a flat list of parsed attributes into a typed, keyed map per
 * ADR-002 §2.6.
 *
 * - Repeatable types (`id-list` / `tag-list` / `external-id`): multi-line
 *   entries merge; CSV values on a single line split on `,`.
 * - `citation`: multi-line only (locators may contain commas).
 * - Single-valued types: all occurrences are preserved in-order; the
 *   validator decides what to do about duplicates.
 * - Unknown keys: preserved as-is, one entry per occurrence.
 */
export function collateAttributes(
  attributes: readonly Attribute[],
): TypedAttributes {
  const map = new Map<string, string[]>();

  for (const attr of attributes) {
    const spec = attributeSpec(attr.key);
    const type = spec?.type;

    let values: string[];
    if (type && CSV_SPLITTABLE_TYPES.has(type) && attr.value.includes(",")) {
      values = attr.value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else {
      values = [attr.value];
    }

    const existing = map.get(attr.key);
    if (existing) {
      existing.push(...values);
    } else {
      map.set(attr.key, values);
    }
  }

  // Freeze value arrays to match the readonly contract.
  return new Map(
    Array.from(map, ([key, values]) => [key, Object.freeze([...values])]),
  );
}

/**
 * Split raw entry content into body text and attribute lines.
 *
 * Attributes are `Key: Value` lines at the **end** of the entry content,
 * forming a contiguous block. A `Key: Value` line in the middle of body
 * prose is NOT treated as an attribute — only the trailing block counts.
 *
 * @param content - Raw text content of an entry (after title line, indentation stripped)
 * @returns Tuple of [body, attributeLines]
 */
export function splitBodyAndAttributes(
  content: string,
): [string, string[]] {
  const lines = content.split("\n");

  // Walk backwards to find the contiguous trailing attribute block
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
      // Non-attribute, non-empty line — stop scanning
      break;
    }
  }

  const bodyLines = lines.slice(0, attrStart);
  const attrLines = lines.slice(attrStart);

  // Trim trailing empty lines from body
  const body = bodyLines.join("\n").replace(/\n+$/, "");
  const filteredAttrLines = attrLines
    .map((l) => l.trim())
    .filter((l) => l !== "");

  return [body, filteredAttrLines];
}
