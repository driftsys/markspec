/**
 * @module core/util/line_endings
 *
 * Cross-platform line-ending helpers. MarkSpec normalises every input to
 * `\n` at the parse and format boundaries so the rest of the toolchain
 * never sees stray `\r` characters. The formatter detects the original
 * file's convention and restores it on write-back, so a CRLF file stays
 * CRLF after `markspec format` round-trips through the AST.
 */

/** Line-ending convention. `cr` covers legacy Mac files. */
export type LineEnding = "crlf" | "lf" | "cr";

/**
 * Detect the dominant line-ending convention of a text. Inspects the
 * first newline-bearing region and falls back to `"lf"` for inputs with
 * no line breaks at all.
 *
 * Returns `"crlf"` if a `\r\n` pair is found before any lone `\n` or
 * `\r`; `"cr"` for legacy Mac files using bare `\r`; `"lf"` otherwise.
 */
export function detectLineEnding(text: string): LineEnding {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0a) return "lf"; // \n without preceding \r
    if (c === 0x0d) {
      return text.charCodeAt(i + 1) === 0x0a ? "crlf" : "cr";
    }
  }
  return "lf";
}

/**
 * Normalise every line ending in `text` to a single `\n`. Accepts CRLF,
 * lone CR, and lone LF inputs and returns a string with only `\n`
 * separators — safe to pass into parsers and formatters that assume LF.
 */
export function normalizeLineEndings(text: string): string {
  if (text.indexOf("\r") < 0) return text;
  return text.replace(/\r\n?/g, "\n");
}

/**
 * Convert every `\n` in `text` to the requested line ending. Used by the
 * formatter to restore the source file's convention on write-back so
 * round-trips are byte-stable.
 */
export function applyLineEnding(text: string, ending: LineEnding): string {
  switch (ending) {
    case "lf":
      return text;
    case "crlf":
      return text.replace(/\n/g, "\r\n");
    case "cr":
      return text.replace(/\n/g, "\r");
  }
}
