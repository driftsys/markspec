/**
 * @module parser/attributes
 *
 * Parses `Key: Value` attribute blocks from entry bodies.
 * Handles trailing backslash separators and distinguishes
 * trailing attribute blocks from body prose.
 */

import type { Attribute, TypedAttributes } from "../model/mod.ts";
import { attributeSpec, CSV_SPLITTABLE_TYPES } from "../model/attributes.ts";
import { UNIVERSAL_ATTRIBUTE_KEYS } from "../model/attributes.ts";
import { CORE_RELATIONS, LOCK_EXTRA_INVERSE_KEYS } from "../model/relations.ts";

/**
 * Canonical set of trailer attribute keys the core recognizes: the union of
 * every authored universal attribute, every core trace relation, and the
 * extra inverse lock key (`Verified-by`). Universal keys with
 * `origin: "generated"` (`Contains`, `Caused`, ...) are left out: the compiler
 * computes them and authors never write them (#706). MSL-P020 (misplaced
 * trailer) fires only when a body line's key is in this set; any other
 * capitalized `Word:` lead-in (`Note:`, `Example:`, `Assumption:`) is prose,
 * not a misplaced trailer (#654).
 */
export const RECOGNIZED_TRAILER_KEYS: ReadonlySet<string> = new Set([
  ...UNIVERSAL_ATTRIBUTE_KEYS.filter((key) =>
    attributeSpec(key)?.origin !== "generated"
  ),
  ...CORE_RELATIONS.map((r) => r.attr),
  ...LOCK_EXTRA_INVERSE_KEYS,
]);

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

/** A line indented by at least four spaces or a tab (code-block indent). */
const INDENTED_RE = /^(?: {4}|\t)/;

/**
 * Find the index of the first line of the trailer block in `lines`, or
 * `lines.length` when there is none. `lines` holds entry content with the
 * list-item indent already removed.
 *
 * Two shapes are trailers:
 *
 * - The indented block (canonical): the trailing run of `Key: Value` lines
 *   that are all indented by 4 or more columns.
 * - The unindented block: the final paragraph, when it starts the content or
 *   follows an empty line, every line is `Key: Value` or starts with
 *   whitespace (a continuation), and it holds an `Id:` line or uses only
 *   recognized core trailer keys (#916, rule of #914).
 *
 * Any other trailing `Key: value` line is body prose.
 */
export function findTrailerStart(lines: readonly string[]): number {
  // Walk backwards over the trailing contiguous `Key: Value` run.
  let runStart = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      if (runStart < lines.length) break;
      continue;
    }
    if (ATTR_LINE_RE.test(trimmed)) runStart = i;
    else break;
  }

  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end--;
  if (end === 0) return lines.length;

  // Indented block: accepted as before.
  if (
    runStart < end &&
    lines.slice(runStart, end).every((l) => INDENTED_RE.test(l))
  ) {
    return runStart;
  }

  // Unindented block: apply the final-paragraph rule.
  let paraStart = end - 1;
  while (paraStart > 0 && lines[paraStart - 1].trim() !== "") paraStart--;
  const paragraph = lines.slice(paraStart, end);
  const keys: string[] = [];
  for (const line of paragraph) {
    if (/^\s/.test(line)) {
      if (keys.length === 0) return lines.length;
      continue; // continuation line
    }
    const key = /^([A-Z][A-Za-z-]*): .+\\?$/.exec(line)?.[1];
    if (key === undefined) return lines.length;
    keys.push(key);
  }
  const accepted = keys.includes("Id") ||
    keys.every((k) => RECOGNIZED_TRAILER_KEYS.has(k));
  return accepted ? paraStart : lines.length;
}

/**
 * Split raw entry content into body text and attribute lines.
 *
 * The trailer block is located by {@linkcode findTrailerStart}. A
 * `Key: Value` line anywhere else, including a trailing one that does not
 * meet that rule, stays body text.
 *
 * @param content - Raw text content of an entry (after title line, indentation stripped)
 * @returns Tuple of [body, attributeLines]
 */
export function splitBodyAndAttributes(
  content: string,
): [string, string[]] {
  const lines = content.split("\n");
  const attrStart = findTrailerStart(lines);

  const bodyLines = lines.slice(0, attrStart);
  const attrLines = lines.slice(attrStart);

  // Trim trailing empty lines from body
  const body = bodyLines.join("\n").replace(/\n+$/, "");
  const filteredAttrLines = attrLines
    .map((l) => l.trim())
    .filter((l) => l !== "");

  return [body, filteredAttrLines];
}
