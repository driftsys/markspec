/**
 * @module formatter/title_wrap
 *
 * Wraps entry titles at the line width (#984), as `prim fmt` does. The
 * line-based passes of the formatter need a title on one physical line, so
 * `format` joins a wrapped title first (#686) and this module wraps it again
 * as the last step. The line breaks come from the same dprint prose formatter
 * that prim uses, so both tools break a title at the same places.
 */

import { isIdLikeLine } from "../parser/attributes.ts";
import type { ProseFormatter } from "./dprint.ts";
import { markdownSemanticallyEquivalent } from "./md_equiv.ts";

/** One entry title line: 0-based line index and list-marker column. */
export interface TitleLine {
  readonly line: number;
  readonly column: number;
}

/** Result of {@linkcode wrapEntryTitles}. */
export interface TitleWrapResult {
  readonly lines: string[];
  readonly changed: boolean;
  /** 0-based line indexes of titles whose dprint wrap was rejected. */
  readonly rejected: number[];
}

const IGNORE_START = /^\s*<!--\s*dprint-ignore-start\s*-->\s*$/;
const IGNORE_END = /^\s*<!--\s*dprint-ignore-end\s*-->\s*$/;
const IGNORE_NEXT = /^\s*<!--\s*dprint-ignore\s*-->\s*$/;

/** `true` when `text` is wider than `width` columns. Counts code points,
 * the same unit as the cheap pre-check in `format`. */
export function exceedsWidth(text: string, width: number): boolean {
  return [...text].length > width;
}

/**
 * Wrap every entry title of `lines` that is wider than `lineWidth`.
 *
 * Each title is passed to `proseFormat` as a one-item list at the width left
 * after the marker column. The wrapped form is kept only when it is the same
 * CommonMark content as the title (the ADR-029 comparator), and every
 * continuation line is indented exactly at the content column (the column of
 * the `[`), so it can never be read as a trailer line. Otherwise the title
 * stays on one line and its line is listed in `rejected`. A title inside a
 * `dprint-ignore` region is left alone, as prim leaves it.
 */
export function wrapEntryTitles(
  lines: readonly string[],
  titleLines: readonly TitleLine[],
  proseFormat: ProseFormatter,
  lineWidth: number,
): TitleWrapResult {
  const out = [...lines];
  const ignored = dprintIgnoredLines(lines);
  const rejected: number[] = [];
  let changed = false;
  // Bottom up, so a splice never moves a title line not yet handled.
  const sorted = [...titleLines].sort((a, b) => b.line - a.line);
  for (const { line, column } of sorted) {
    const title = out[line];
    if (title === undefined || ignored.has(line)) continue;
    if (!exceedsWidth(title, lineWidth)) continue;
    const indent = title.slice(0, column);
    if (indent.trim() !== "") continue;
    const item = title.slice(column);
    const contentColumn = item.indexOf("[");
    if (contentColumn < 2) continue;
    const wrapped = wrapTitle(
      item,
      contentColumn,
      proseFormat,
      lineWidth - column,
    );
    if (wrapped === undefined) {
      rejected.push(line);
      continue;
    }
    if (wrapped.length < 2) continue;
    out.splice(line, 1, ...wrapped.map((l) => indent + l));
    changed = true;
  }
  return { lines: out, changed, rejected: rejected.reverse() };
}

/** The lines of one title after dprint, or `undefined` when the wrap is
 * rejected. A single line means dprint kept it on one line. */
function wrapTitle(
  item: string,
  contentColumn: number,
  proseFormat: ProseFormatter,
  width: number,
): string[] | undefined {
  let formatted: string;
  try {
    formatted = proseFormat(item + "\n", { lineWidth: Math.max(20, width) });
  } catch {
    return undefined;
  }
  const wrapped = formatted.replace(/\n+$/, "").split("\n");
  if (wrapped[0].indexOf("[") !== contentColumn) return undefined;
  const continuation = new RegExp(`^ {${contentColumn}}\\S`);
  if (
    !wrapped.slice(1).every((l) => continuation.test(l) && !isIdLikeLine(l))
  ) return undefined;
  if (!markdownSemanticallyEquivalent(item, wrapped.join("\n"))) {
    return undefined;
  }
  return wrapped;
}

/** 0-based indexes of lines that dprint leaves alone: inside a
 * `dprint-ignore-start` / `-end` region, or right after `dprint-ignore`. */
function dprintIgnoredLines(lines: readonly string[]): Set<number> {
  const ignored = new Set<number>();
  let inRegion = false;
  lines.forEach((line, i) => {
    if (IGNORE_START.test(line)) inRegion = true;
    else if (IGNORE_END.test(line)) inRegion = false;
    else if (inRegion) ignored.add(i);
    else if (i > 0 && IGNORE_NEXT.test(lines[i - 1])) ignored.add(i);
  });
  return ignored;
}
