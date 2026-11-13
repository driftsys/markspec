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
 * computes them and authors never write them (#706).
 *
 * Two uses:
 *
 * - Trailer detection: an unindented final paragraph without an `Id:` line
 *   is a trailer only when every key is in this set
 *   ({@linkcode findTrailerStart}, #916).
 * - The MSL-P022 typo check: a malformed key that is a typo of a key in
 *   this set still raises MSL-P022 (#697).
 *
 * MSL-P020 on body prose uses only `Id` and the trace-relation keys of this
 * set; any other `Word:` lead-in (`Rationale:`, `Note:`) is prose (#654,
 * #916).
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

/**
 * Width of the leading whitespace of `line` in columns, with a tab moving
 * to the next multiple of 4. CommonMark uses the same tab stop, so a line
 * that mixes spaces and tabs is measured as the code-block rule sees it.
 */
function leadingColumns(line: string): number {
  let column = 0;
  for (const ch of line) {
    if (ch === " ") column++;
    else if (ch === "\t") column += 4 - (column % 4);
    else break;
  }
  return column;
}

/** `true` when `line` is indented by 4 or more columns (code-block indent). */
function isIndented(line: string): boolean {
  return leadingColumns(line) >= 4;
}

/** The key of a `Key: Value` line, or `undefined` for any other line. */
function trailerKey(line: string): string | undefined {
  const trimmed = line.trim();
  return ATTR_LINE_RE.test(trimmed)
    ? /^([A-Z][A-Za-z-]*):/.exec(trimmed)?.[1]
    : undefined;
}

/**
 * Find the index of the first line of the trailer block in `lines`, or
 * `lines.length` when there is none. `lines` holds entry content with the
 * list-item indent removed. The parser and `markspec fmt` both call this
 * function, so they always agree on which lines are attributes.
 *
 * Every trailer line is a `Key: Value` line or a continuation line: a
 * whitespace-led line below a line that ends with `\` or `,`. The attribute
 * parser reads one attribute per line and cannot read a continuation line,
 * so the parser reports it as MSL-P021 and `markspec fmt` leaves such a
 * trailer unchanged. Keeping it in the trailer means no layout makes the
 * entry lose its `Id:` or an attribute. A line of any other shape ends the
 * trailer.
 *
 * Three shapes are trailers:
 *
 * - The indented run (canonical): the trailing `Key: Value` lines that are
 *   each indented by 4 or more columns. This is accepted with or without a
 *   blank line above it, as before #916.
 * - The trailer paragraph: the trailing `Key: Value` lines, indented or not,
 *   that start the content or follow an empty line, when they hold an `Id:`
 *   line or use only keys in {@linkcode RECOGNIZED_TRAILER_KEYS} (#916, rule
 *   of #914).
 * - The Id run under prose: trailing `Key: Value` lines directly under a
 *   prose line, with no blank line between, that hold an `Id:` line on any
 *   of their lines, indented or not.
 *   The `Id:` line shows that the author meant a trailer; reading it as
 *   prose would make `markspec fmt` stamp a new Id.
 *   {@linkcode isTrailerUnderProse} reports this shape.
 *
 * Any other trailing `Key: value` line is body prose.
 */
export function findTrailerStart(lines: readonly string[]): number {
  return locateTrailer(lines).start;
}

/**
 * `true` when the trailer of `lines` is an Id run directly under prose
 * (no blank line before it, no indentation). The parser reports it as
 * MSL-P020 (warning); `markspec fmt` moves it to the canonical layout.
 */
export function isTrailerUnderProse(lines: readonly string[]): boolean {
  return locateTrailer(lines).underProse;
}

function locateTrailer(
  lines: readonly string[],
): { start: number; underProse: boolean } {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end--;

  // The trailing run of `Key: Value` lines and continuation lines.
  const continuation: boolean[] = [];
  let blockStart = end;
  while (blockStart > 0) {
    const i = blockStart - 1;
    if (trailerKey(lines[i]) !== undefined) {
      continuation[i] = false;
    } else if (isContinuation(lines, i)) {
      continuation[i] = true;
    } else break;
    blockStart--;
  }

  // The indented run: indented `Key: Value` lines and their continuations.
  let indentedStart = end;
  while (
    indentedStart > blockStart &&
    (continuation[indentedStart - 1] || isIndented(lines[indentedStart - 1]))
  ) indentedStart--;
  while (indentedStart < end && continuation[indentedStart]) indentedStart++;

  // Unindented `Key: Value` lines (and continuations) directly above it.
  let runStart = indentedStart;
  while (
    runStart > blockStart &&
    (continuation[runStart - 1] || !isIndented(lines[runStart - 1]))
  ) runStart--;
  while (runStart < indentedStart && continuation[runStart]) runStart++;

  const keysOf = (from: number, to: number): string[] =>
    lines.slice(from, to).map((l) => trailerKey(l)).filter(
      (k): k is string => k !== undefined,
    );
  if (runStart < indentedStart) {
    const ownParagraph = runStart === 0 || lines[runStart - 1].trim() === "";
    const keys = keysOf(runStart, end);
    if (
      ownParagraph &&
      (keys.includes("Id") ||
        keys.every((k) => RECOGNIZED_TRAILER_KEYS.has(k)))
    ) {
      return { start: runStart, underProse: false };
    }
    if (!ownParagraph && keysOf(runStart, indentedStart).includes("Id")) {
      return { start: runStart, underProse: true };
    }
  }
  // Any other trailing run that holds an `Id:` line is the trailer too,
  // whatever its indentation: reading it as body would make `markspec fmt`
  // stamp a replacement Id.
  let idRunStart = blockStart;
  while (idRunStart < end && continuation[idRunStart]) idRunStart++;
  if (
    idRunStart < (indentedStart < end ? indentedStart : end) &&
    keysOf(idRunStart, end).includes("Id")
  ) {
    const ownParagraph = idRunStart === 0 ||
      lines[idRunStart - 1].trim() === "";
    return { start: idRunStart, underProse: !ownParagraph };
  }
  return {
    start: indentedStart < end ? indentedStart : lines.length,
    underProse: false,
  };
}

/**
 * `true` when `lines[i]` continues the value of the line above it: it
 * starts with whitespace, and the line above ends with `\` or `,`. The
 * attribute parser cannot read such a line, so the parser reports it as
 * MSL-P021 and `markspec fmt` leaves the trailer as it is. Keeping it in
 * the trailer keeps the trailer's `Id:` and attributes.
 */
function isContinuation(lines: readonly string[], i: number): boolean {
  if (i === 0 || !/^\s/.test(lines[i]) || lines[i].trim() === "") {
    return false;
  }
  return /[\\,]$/.test(lines[i - 1].trimEnd());
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
