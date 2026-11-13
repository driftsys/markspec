/**
 * @module refs/split
 *
 * Bracket-aware splitting of trace attribute values. A value is
 * `target [ 1*WSP "[" locator "]" ]`. A locator can contain commas, so a
 * plain split on commas is wrong for it. The escapes `\]` and `\\` are
 * valid inside a locator only.
 */

/** A parsed trace value. */
export interface ParsedTraceValue {
  /** The referenced entry or reference identifier. */
  readonly target: string;
  /** The locator after {@linkcode normalizeLocator} and unescaping. */
  readonly locator?: string;
  /** The locator text exactly as authored between the brackets. */
  readonly locatorRaw?: string;
}

/**
 * Normalize locator text for comparison: Unicode NFC, trim, and collapse
 * each whitespace run to one space.
 */
export function normalizeLocator(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * Split a trace attribute value on commas that are outside a locator.
 * Parts are trimmed and empty parts are dropped. An unterminated locator
 * keeps the rest of the value in the same part.
 */
export function splitTraceValues(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inLocator = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (inLocator) {
      if (ch === "\\" && i + 1 < value.length) {
        current += ch + value[++i];
        continue;
      }
      if (ch === "]") inLocator = false;
      current += ch;
    } else if (ch === "[") {
      inLocator = true;
      current += ch;
    } else if (ch === ",") {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** `target 1*WSP "[" locator "]"` with escapes inside the locator. */
const LOCATOR_VALUE_RE = /^(\S+)\s+\[((?:\\[\s\S]|[^\]\\])+)\]$/;

/**
 * Parse one value from {@linkcode splitTraceValues} into target and
 * optional locator. Without a bracket locator, the target is the first
 * whitespace-separated token (legacy free-text suffix), except that a
 * value with an unterminated `[` is kept whole as the target.
 */
export function parseTraceValue(raw: string): ParsedTraceValue {
  const value = raw.trim();
  const match = LOCATOR_VALUE_RE.exec(value);
  if (match) {
    const locatorRaw = match[2];
    return {
      target: match[1],
      locator: normalizeLocator(locatorRaw.replace(/\\([\]\\])/g, "$1")),
      locatorRaw,
    };
  }
  if (/\s\[/.test(value)) return { target: value };
  return { target: value.split(/\s+/)[0] };
}
