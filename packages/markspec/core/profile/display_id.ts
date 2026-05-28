/**
 * @module core/profile/display_id
 *
 * Shared parser for the `display-id-pattern` template used by profile
 * type declarations. Patterns look like:
 *
 *   STK_{n:4d}
 *   STK_AEB_{n:04d}
 *   REQ-{n:03d}-draft
 *
 * The `{n:Nd}` placeholder (with optional leading zero in the Nd
 * form) names the sequential number slot. The text before the
 * placeholder becomes the literal prefix; the text after becomes the
 * literal suffix.
 *
 * Note: the `{scope}` placeholder documented in the profile schema
 * is NOT substituted here — callers handle that separately. For
 * patterns containing `{scope}`, the literal text `{scope}` ends up
 * in `prefix` (or `suffix`) and must be replaced upstream before the
 * pattern is fed to scaffolding.
 */

/** Width-and-position decomposition of a display-id-pattern. */
export interface DisplayIdPatternShape {
  /** Literal text before the `{n:Nd}` placeholder. */
  readonly prefix: string;
  /** Width of the zero-padded numeric segment. */
  readonly width: number;
  /** Literal text after the `{n:Nd}` placeholder (often empty). */
  readonly suffix: string;
}

/** Regex capturing the `{n:Nd}` placeholder; `0` and the digit count are both captured. */
const PLACEHOLDER_RE = /\{n:(\d+)d\}/;

/**
 * Parse a `display-id-pattern` template. Returns `undefined` when
 * the pattern does not contain a recognised `{n:Nd}` placeholder so
 * callers can decide how to surface the error (CLI exits, LSP
 * silently skips the type).
 */
export function parseDisplayIdPattern(
  pattern: string,
): DisplayIdPatternShape | undefined {
  const match = PLACEHOLDER_RE.exec(pattern);
  if (!match) return undefined;
  const width = parseInt(match[1], 10);
  if (!Number.isFinite(width) || width < 1) return undefined;
  return {
    prefix: pattern.slice(0, match.index),
    width,
    suffix: pattern.slice(match.index + match[0].length),
  };
}

/**
 * Pad a positive integer with leading zeros to at least `width`
 * characters. Numbers longer than `width` are left unchanged — the
 * pattern's width is a minimum, not a maximum, mirroring printf
 * `%0Nd` semantics.
 */
export function padDisplayIdNumber(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}

/**
 * Format a display ID from a parsed pattern and a numeric value.
 * Inverse of the per-entry scan that {@linkcode highestDisplayIdNumber}
 * performs.
 */
export function formatDisplayId(
  shape: DisplayIdPatternShape,
  n: number,
): string {
  return `${shape.prefix}${padDisplayIdNumber(n, shape.width)}${shape.suffix}`;
}

/**
 * Scan `entries` for the highest numeric value used by any display
 * ID that matches the given shape (same prefix AND same suffix; the
 * numeric segment is parsed as a base-10 integer). Returns 0 when no
 * matching ID exists, so `+ 1` yields the next sequential number.
 */
export function highestDisplayIdNumber(
  shape: DisplayIdPatternShape,
  entries: Iterable<{ displayId: string }>,
): number {
  let max = 0;
  for (const entry of entries) {
    const id = entry.displayId;
    if (!id.startsWith(shape.prefix)) continue;
    if (shape.suffix && !id.endsWith(shape.suffix)) continue;
    const numberPart = id.slice(
      shape.prefix.length,
      id.length - shape.suffix.length,
    );
    const n = parseInt(numberPart, 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max;
}
