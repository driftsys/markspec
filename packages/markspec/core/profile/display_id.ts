/**
 * @module core/profile/display_id
 *
 * Single source of truth for the `display-id-pattern` template grammar.
 *
 * One tokenizer ({@linkcode tokenizePattern}) and one well-formedness
 * oracle ({@linkcode validateDisplayIdPattern}) back both consumers of the
 * grammar: classification (`compileDisplayIdPattern` in `core/validator`,
 * which builds the recognizer regex) and minting/scaffolding
 * ({@linkcode parseDisplayIdPattern}, which decomposes the numeric slot).
 * Keeping a single grammar here prevents the two from drifting — see #596.
 *
 * A pattern is one of two kinds, selected by whether it contains a counter:
 *
 *   numbered := segment+ (exactly one `{n}` counter)  — mintable + classifying
 *   named    := segment+ (literal anchor, ≥1 named, no counter) — classifying
 *
 *   counter  := "{n}" | "{n:" digits "d}"   (e.g. {n}, {n:4d}, {n:04d})
 *   named    := "{" identifier "}"          (e.g. {scope}, {name})
 *
 * The padding digit count is a minimum width; `{n:4d}` and `{n:04d}` are
 * equivalent. A bare `{n}` mints with no zero-padding (width 1).
 *
 * Patterns:
 *
 *   STK_{n:4d}            → numbered, width 4
 *   STK_AEB_{n:04d}       → numbered, width 4
 *   REQ-{n:03d}-draft     → numbered, width 3, suffix "-draft"
 *   REQ-{n}               → numbered, width 1
 *   SWC_{name}            → named (classifying only — not mintable)
 *
 * Note: the `{scope}` placeholder documented in the profile schema is NOT
 * substituted here. For a numbered pattern like `XREQ_{scope}_{n:04d}`,
 * the literal `{scope}` text ends up in `prefix` and must be replaced
 * upstream before the pattern is fed to scaffolding.
 */

/** Width-and-position decomposition of a *numbered* display-id-pattern. */
export interface DisplayIdPatternShape {
  /** Literal text before the counter placeholder. */
  readonly prefix: string;
  /** Minimum width of the numeric segment (1 for a bare `{n}`). */
  readonly width: number;
  /** Literal text after the counter placeholder (often empty). */
  readonly suffix: string;
}

/**
 * One template token: the `{n}` counter (optionally padded) OR a `{named}`
 * segment. The padding capture accepts any positive digit count — `{n:4d}`
 * and `{n:04d}` both tokenize to a counter (`Number()` collapses the
 * leading zero downstream).
 */
const TOKEN_RE = /\{n(?::(\d+)d)?\}|\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/** A tokenized fragment of a display-id-pattern template. */
export type PatternToken =
  | { readonly kind: "literal"; readonly text: string }
  | { readonly kind: "counter"; readonly padding?: string }
  | { readonly kind: "named"; readonly name: string };

/** Split a template into its literal / counter / named tokens. */
export function tokenizePattern(template: string): PatternToken[] {
  const tokens: PatternToken[] = [];
  let lastIndex = 0;
  const re = new RegExp(TOKEN_RE);
  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        kind: "literal",
        text: template.slice(lastIndex, match.index),
      });
    }
    const named = match[2];
    if (named === undefined) {
      tokens.push({ kind: "counter", padding: match[1] });
    } else {
      tokens.push({ kind: "named", name: named });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < template.length) {
    tokens.push({ kind: "literal", text: template.slice(lastIndex) });
  }
  return tokens;
}

/** Re-emit the literal source a non-counter token contributes to a
 * numbered pattern's prefix/suffix. A named placeholder is rendered in
 * its `{name}` form (callers substitute it upstream). */
function reconstructLiteral(token: PatternToken): string {
  switch (token.kind) {
    case "literal":
      return token.text;
    case "named":
      return `{${token.name}}`;
    case "counter":
      return token.padding ? `{n:${token.padding}d}` : "{n}";
  }
}

/** Outcome of {@linkcode validateDisplayIdPattern}. */
export type DisplayIdPatternValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * Decide whether a `display-id-pattern` template is well-formed, returning
 * a MarkSpec-authored reason when it is not. This is the single oracle
 * shared by classification (which throws this message) and profile-load
 * validation (which emits it as a diagnostic), so a malformed pattern is
 * reported identically everywhere and never reaches `new RegExp`.
 *
 * Rejects: more than one counter; a malformed/zero-width padding
 * specifier; an all-literal template (no variable part); a counter-less
 * pattern with no literal anchor (a bare `{name}` matches every ID); and
 * a duplicate named placeholder (which would build an invalid RegExp).
 */
export function validateDisplayIdPattern(
  template: string,
): DisplayIdPatternValidation {
  const tokens = tokenizePattern(template);
  const counters = tokens.filter((t) => t.kind === "counter");
  const named = tokens.filter((t) => t.kind === "named");
  const hasLiteralAnchor = tokens.some(
    (t) => t.kind === "literal" && t.text.length > 0,
  );

  if (counters.length > 1) {
    return {
      ok: false,
      message:
        `display-id-pattern '${template}': multiple {n} counters (expected one)`,
    };
  }

  if (counters.length === 1) {
    const padding = (counters[0] as { padding?: string }).padding;
    if (padding !== undefined && parseInt(padding, 10) < 1) {
      return {
        ok: false,
        message:
          `display-id-pattern '${template}': invalid padding specifier ` +
          `(expected {n} or {n:NNd})`,
      };
    }
  }

  if (counters.length === 0) {
    // A malformed counter (`{n:abc}`, `{n:4}`) is not tokenized as a
    // counter — it lands in literal text. Surface it as an invalid padding
    // error before the missing-counter / named-pattern checks.
    if (/\{n:[^}]*\}/.test(template)) {
      return {
        ok: false,
        message:
          `display-id-pattern '${template}': invalid padding specifier ` +
          `(expected {n} or {n:NNd})`,
      };
    }
    if (named.length === 0) {
      return {
        ok: false,
        message: `display-id-pattern '${template}': missing {n} placeholder`,
      };
    }
    if (!hasLiteralAnchor) {
      return {
        ok: false,
        message:
          `display-id-pattern '${template}': named pattern needs a literal ` +
          `prefix (a bare {name} would match every display ID)`,
      };
    }
  }

  const seen = new Set<string>();
  for (const t of named) {
    const name = (t as { name: string }).name;
    if (seen.has(name)) {
      return {
        ok: false,
        message:
          `display-id-pattern '${template}': duplicate named placeholder '{${name}}'`,
      };
    }
    seen.add(name);
  }

  return { ok: true };
}

/**
 * Decompose a *numbered* `display-id-pattern` into its mint shape.
 *
 * Returns `undefined` for any template that is not mintable — a named
 * (counter-less) pattern, an all-literal template, or a malformed one —
 * so callers can decide how to surface it (the CLI distinguishes a valid
 * named type from a malformed pattern via {@linkcode validateDisplayIdPattern};
 * the LSP skips non-mintable types). Shares the {@linkcode tokenizePattern}
 * grammar with `compileDisplayIdPattern`, so the two never disagree about
 * which counter forms are valid (#596).
 */
export function parseDisplayIdPattern(
  pattern: string,
): DisplayIdPatternShape | undefined {
  const tokens = tokenizePattern(pattern);
  const counters = tokens.filter(
    (t): t is { kind: "counter"; padding?: string } => t.kind === "counter",
  );
  if (counters.length !== 1) return undefined; // named/none, or multi-counter
  const counterIndex = tokens.indexOf(counters[0]);
  const width = counters[0].padding ? parseInt(counters[0].padding, 10) : 1;
  if (!Number.isFinite(width) || width < 1) return undefined;
  return {
    prefix: tokens.slice(0, counterIndex).map(reconstructLiteral).join(""),
    width,
    suffix: tokens.slice(counterIndex + 1).map(reconstructLiteral).join(""),
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
