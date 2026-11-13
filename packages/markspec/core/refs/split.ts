/**
 * @module refs/split
 *
 * Bracket-aware splitting of trace attribute values. A value is
 * `target [ 1*WSP "[" locator "]" ]`. A locator can contain commas, so a
 * plain split on commas is wrong for it. The escapes `\]` and `\\` are
 * valid inside a locator only; any other backslash sequence (such as `\x`)
 * is kept as written. A locator must follow whitespace after the target,
 * so `A[x]` has no locator. A value without a closed locator is read
 * exactly as before scenario locators existed.
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
 * Split a trace attribute value into its parts. When at least one part has
 * a closed bracket locator after whitespace, commas inside a locator do not
 * split. Otherwise the value is split on every comma, exactly as before
 * scenario locators existed, so an unterminated `[` does not change how a
 * value is read. Parts are trimmed and empty parts are dropped.
 */
export function splitTraceValues(value: string): string[] {
  const bracketParts = splitOutsideLocators(value);
  if (bracketParts.some((p) => LOCATOR_VALUE_RE.test(p))) return bracketParts;
  return value.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Split on commas outside a locator. A `[` opens a locator only after
 * whitespace; an unterminated locator keeps the rest of the value. */
function splitOutsideLocators(value: string): string[] {
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
    } else if (ch === "[" && i > 0 && /\s/.test(value[i - 1])) {
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

/** `target 1*WSP "[" locator "]"` with escapes inside the locator. The
 * locator may be empty (`A []`); an empty locator names no scenario. */
const LOCATOR_VALUE_RE = /^(\S+)\s+\[((?:\\[\s\S]|[^\]\\])*)\]$/;

/**
 * Parse one value from {@linkcode splitTraceValues} into target and
 * optional locator. A value without a closed locator after whitespace is
 * kept whole as the target, as before scenario locators existed.
 */
export function parseTraceValue(raw: string): ParsedTraceValue {
  const value = raw.trim();
  const match = LOCATOR_VALUE_RE.exec(value);
  if (!match) return { target: value };
  const locatorRaw = match[2];
  return {
    target: match[1],
    locator: normalizeLocator(locatorRaw.replace(/\\([\]\\])/g, "$1")),
    locatorRaw,
  };
}

/**
 * `true` when a trace value has a `[` after whitespace that no unescaped
 * `]` closes. Such a value has no locator.
 */
export function isUnterminatedLocator(raw: string): boolean {
  const value = raw.trim();
  let inLocator = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (inLocator) {
      if (ch === "\\") i++;
      else if (ch === "]") inLocator = false;
    } else if (ch === "[" && i > 0 && /\s/.test(value[i - 1])) {
      inLocator = true;
    }
  }
  return inLocator;
}

/**
 * The target of a trace value for existence and value-type checks: the
 * target before a closed bracket locator, else the trimmed value as
 * written.
 */
export function traceTarget(raw: string): string {
  return parseTraceValue(raw).target;
}

/**
 * The tokens of a trace value that can name another entry, for reference
 * scans (find references, dependent counts). A closed locator is dropped,
 * so an ID written inside a locator is not a reference. Any other part is
 * split on whitespace and commas, as before scenario locators existed.
 */
export function referenceTokens(value: string): string[] {
  const out: string[] = [];
  for (const part of splitTraceValues(value)) {
    const parsed = parseTraceValue(part);
    if (parsed.locator !== undefined) {
      out.push(parsed.target);
      continue;
    }
    for (const t of part.split(/[\s,]+/)) if (t.length > 0) out.push(t);
  }
  return out;
}
