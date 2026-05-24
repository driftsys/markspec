/**
 * @module parser/line_map
 *
 * Coordinate translation from a `wrapAsListItem`-wrapped buffer back to
 * the source file the buffer was extracted from. The {@linkcode LineMap}
 * interface is the abstract surface; {@linkcode buildBlockLineMap} is the
 * concrete factory used by {@linkcode parser/source} for tree-sitter
 * doc-comment blocks.
 *
 * The interface is deliberately small so future source formats (Python
 * docstrings, AsciiDoc) can produce their own LineMaps without touching
 * the consumers.
 *
 * Coordinate math reference: spec at
 * `docs/superpowers/specs/2026-05-24-body-tokens-parser-source-409-design.md`.
 */

/** Translates wrapped-buffer (line, column) to source-file (line, column). */
export interface LineMap {
  /**
   * Translate a 1-based `(bufferLine, bufferColumn)` to its source file
   * coordinates. Returns `undefined` when the buffer position is outside
   * any known cleaned line (over-run past the block's last line, or
   * `bufferLine === 0`).
   *
   * For columns inside the synthetic `- ` / `  ` prepended by
   * `wrapAsListItem` (cols 1–2 on every line), the translation falls
   * back to the block's `startColumn` (line 1) or column 1 (line ≥ 2) —
   * a safe under-painting rather than `undefined`, because real entity
   * references never live in that prefix region but a defensive caller
   * might still translate column 1 on a blank line.
   */
  translate(
    bufferLine: number,
    bufferColumn: number,
  ): { line: number; column: number } | undefined;
}

/** Per-line metadata captured during doc-comment prefix stripping. */
export interface DocCommentBlockMeta {
  /** 1-based file line of the first *cleaned* line in source. */
  readonly startLine: number;
  /** 1-based file column of the first prefix marker. */
  readonly startColumn: number;
  /**
   * One entry per cleaned line. Each value is the number of source
   * characters stripped to produce that cleaned line — comment marker
   * (`///`, `* `, `/**`) plus any leading space. Length must equal the
   * cleaned-line count.
   */
  readonly prefixWidths: readonly number[];
}

/**
 * Build a `LineMap` for a doc-comment block wrapped via `wrapAsListItem`.
 *
 * The math is documented in the spec; in short: buffer column `c >= 3`
 * maps to source column `(c - 2) + prefixWidths[bufferLine - 1]`; columns
 * 1–2 (the synthetic `- ` or `  ` continuation marker) safe-fall to the
 * block's `startColumn` on line 1 and column 1 on subsequent lines.
 */
export function buildBlockLineMap(meta: DocCommentBlockMeta): LineMap {
  return {
    translate(bufferLine, bufferColumn) {
      if (bufferLine < 1) return undefined;
      const idx = bufferLine - 1;
      if (idx >= meta.prefixWidths.length) return undefined;
      const line = meta.startLine + idx;
      if (bufferColumn < 3) {
        return { line, column: idx === 0 ? meta.startColumn : 1 };
      }
      const column = (bufferColumn - 2) + meta.prefixWidths[idx];
      return { line, column };
    },
  };
}
