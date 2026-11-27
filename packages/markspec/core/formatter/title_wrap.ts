/**
 * @module formatter/title_wrap
 *
 * Wraps entry titles at the line width (#984), as `prim fmt` does. The
 * line-based passes of the formatter need a title on one physical line, so
 * `format` joins a wrapped title first (#686) and this module wraps it again
 * as the last step. The line breaks come from the same dprint prose formatter
 * that prim uses, so both tools break a title at the same places.
 */

import type { ProseFormatter } from "./dprint.ts";

/**
 * Wrap every entry title line of `lines` that is longer than `lineWidth`.
 *
 * `titleLines` holds the 0-based line index and the 0-based column of the
 * list marker of each entry title. Each title is passed to `proseFormat` as a
 * one-item list at the width left after the marker column. The wrapped form
 * is kept only when it holds the same words as the title, and every
 * continuation line is indented exactly 2 columns past the marker, so it can
 * never be read as a trailer line (4 or more columns). Otherwise the title
 * stays on one line.
 *
 * @returns The new lines, and `true` when a title was wrapped.
 */
export function wrapEntryTitles(
  lines: readonly string[],
  titleLines: readonly { readonly line: number; readonly column: number }[],
  proseFormat: ProseFormatter,
  lineWidth: number,
): { lines: string[]; changed: boolean } {
  const out = [...lines];
  let changed = false;
  // Bottom up, so a splice never moves a title line not yet handled.
  const sorted = [...titleLines].sort((a, b) => b.line - a.line);
  for (const { line, column } of sorted) {
    const title = out[line];
    if (title === undefined || title.length <= lineWidth) continue;
    const indent = title.slice(0, column);
    if (indent.trim() !== "" || !title.startsWith("- [", column)) continue;
    const wrapped = wrapTitle(
      title.slice(column),
      proseFormat,
      lineWidth - column,
    );
    if (wrapped === undefined) continue;
    out.splice(line, 1, ...wrapped.map((l) => indent + l));
    changed = true;
  }
  return { lines: out, changed };
}

/** The wrapped lines of one title that starts with `- [`, or `undefined`
 * when the title stays on one line. */
function wrapTitle(
  title: string,
  proseFormat: ProseFormatter,
  width: number,
): string[] | undefined {
  let formatted: string;
  try {
    formatted = proseFormat(title + "\n", { lineWidth: Math.max(20, width) });
  } catch {
    return undefined;
  }
  const wrapped = formatted.replace(/\n+$/, "").split("\n");
  if (wrapped.length < 2 || !wrapped[0].startsWith("- [")) return undefined;
  for (const continuation of wrapped.slice(1)) {
    if (!/^ {2}\S/.test(continuation)) return undefined;
  }
  const words = (text: string) => text.trim().split(/\s+/).join(" ");
  if (words(wrapped.join(" ")) !== words(title)) return undefined;
  return wrapped;
}
