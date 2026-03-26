/**
 * @module parser/attributes
 *
 * Parses `Key: Value` attribute blocks from entry bodies.
 * Handles trailing backslash separators and distinguishes
 * trailing attribute blocks from body prose.
 */

import type { Attribute } from "../model/mod.ts";

/**
 * Pattern matching a `Key: Value` attribute line.
 * Key must start with an uppercase letter, may contain lowercase letters and hyphens.
 * Value is everything after `: `, with optional trailing backslash stripped.
 */
const ATTRIBUTE_RE = /^([A-Z][A-Za-z-]*): (.+?)\\?$/;

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
      attributes.push({
        key: match[1],
        value: match[2].trim(),
      });
    }
  }

  return attributes;
}

/**
 * Pattern matching a `Key: Value` line (with or without trailing backslash).
 * Used to detect attribute blocks at the end of entry bodies.
 */
const ATTR_LINE_RE = /^[A-Z][A-Za-z-]*: .+\\?$/;

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
