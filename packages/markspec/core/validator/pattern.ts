/**
 * @module core/validator/pattern
 *
 * Display-ID pattern template → anchored RegExp (the classification half of
 * the grammar). The tokenizer and well-formedness oracle live in
 * `core/profile/display_id.ts` — {@linkcode tokenizePattern} and
 * {@linkcode validateDisplayIdPattern} — and are shared with the
 * minting/scaffold parser so the two never disagree about which forms are
 * valid (#596). This module only builds the recognizer regex.
 *
 * A pattern is one of two kinds, selected by whether it contains a counter:
 *
 *   numbered := segment+ (exactly one counter)   — mintable + classifying
 *   named    := segment+ (literal anchor, ≥1 named, no counter) — classifying
 *
 *   segment  := literal | counter | named
 *   counter  := "{n}" | "{n:" digits "d}"   (e.g. {n}, {n:4d}, {n:04d})
 *   named    := "{" identifier "}"           (e.g. {scope}, {name})
 *
 * **Numbered patterns** carry exactly one counter — the numeric running
 * index used both for classification (a recognizer regex) and for minting the
 * next ID. A medial named placeholder such as `{scope}` matches a single free
 * alphanumeric segment, so one pattern serves every feature scope.
 *
 * **Named patterns** (ADR-025, issue #594) carry no counter — they classify
 * types whose IDs are *named, not numbered* (e.g. components `SWC_LIGHT_CTRL`,
 * `HWC_PIU`). They require a non-empty literal anchor plus at least one named
 * placeholder; the trailing named placeholder captures the rest of the
 * display ID (underscores, dots, slashes, hyphens included). A bare `{name}`
 * with no literal anchor is rejected — it would match every ID and collide
 * with every type. Named patterns are not mintable (no counter to increment);
 * `parseDisplayIdPattern` skips them so the scaffold/next-id paths fall back
 * to author-typed IDs.
 *
 * Examples:
 *   REQ-{n}              → ^REQ-(\d+)$
 *   REQ-{n:04d}          → ^REQ-(\d{4})$
 *   STK_{n:4d}           → ^STK_(\d{4})$
 *   XREQ_{scope}_{n:04d} → ^XREQ_(?<scope>[A-Za-z0-9]+)_(\d{4})$
 *   SWC_{name}           → ^SWC_(?<name>[A-Za-z0-9._/-]+)$
 */

import {
  escapeRegex,
  hasScopePlaceholder,
  type PatternToken,
  SEGMENT_CLASS,
  tokenizePattern,
  validateDisplayIdPattern,
} from "../profile/display_id.ts";

/**
 * Character class for the trailing named placeholder of a *named* pattern —
 * the established display-ID token set (letters, digits, underscore, dot,
 * slash, hyphen). Wider than the medial-segment class so `SWC_{name}` matches
 * underscore-bearing IDs like `SWC_LIGHT_CTRL`.
 */
const REST_OF_ID_CLASS = "[A-Za-z0-9._/-]+";

/**
 * Compile a display-ID pattern template into an anchored RegExp.
 *
 * Throws the {@linkcode validateDisplayIdPattern} reason when the template is
 * malformed (more than one counter, a malformed/zero-width padding specifier,
 * no variable part, a counter-less pattern without a literal anchor, or a
 * duplicate named placeholder). Validating first guarantees `new RegExp`
 * below never sees a duplicate capture name.
 */
export function compileDisplayIdPattern(template: string): RegExp {
  return buildPatternRegex(template, false);
}

/**
 * Build the anchored RegExp of a display-ID pattern. With `widerCounter`
 * `false` (classification), a padded counter matches exactly its width.
 * With `widerCounter` `true` (scope reading for minting), it matches at
 * least its width, because the next number after `9999` for `{n:04d}` is
 * `10000`. Throws the {@linkcode validateDisplayIdPattern} reason for a
 * malformed template.
 */
function buildPatternRegex(template: string, widerCounter: boolean): RegExp {
  const validation = validateDisplayIdPattern(template);
  if (!validation.ok) throw new Error(validation.message);

  const tokens = tokenizePattern(template);
  const counters = tokens.filter((t) => t.kind === "counter").length;

  // In a named (counter-less) pattern the trailing named placeholder matches
  // the rest of the display ID; every other named placeholder — and every
  // named placeholder in a numbered pattern — stays a single segment.
  const restOfIdNamedIndex = counters === 0
    ? tokens.reduce((acc, t, i) => (t.kind === "named" ? i : acc), -1)
    : -1;

  let regexSource = "^";
  tokens.forEach((t: PatternToken, i) => {
    if (t.kind === "literal") {
      regexSource += escapeRegex(t.text);
    } else if (t.kind === "counter") {
      const width = t.padding ? Number(t.padding) : undefined;
      regexSource += "(" +
        (width === undefined
          ? `\\d+`
          : widerCounter
          ? `\\d{${width},}`
          : `\\d{${width}}`) +
        ")";
    } else {
      const charClass = i === restOfIdNamedIndex
        ? REST_OF_ID_CLASS
        : SEGMENT_CLASS;
      regexSource += `(?<${t.name}>${charClass})`;
    }
  });
  regexSource += "$";

  return new RegExp(regexSource);
}

/**
 * Compile a display-ID pattern, returning `undefined` instead of throwing when
 * the template is malformed.
 *
 * Defensive guard for the classification stage: the canonical fix rejects a
 * malformed `display-id-pattern` at profile-load (`PROFILE-TYPE-008`, #597),
 * but until that fix is on the same branch a bad pattern reaching
 * classification must not crash `markspec check` with an uncaught throw
 * (clig.dev: never surface a raw stack trace). A skipped type simply does not
 * classify — the entry surfaces as `MSL-T003` rather than a crash.
 */
export function tryCompileDisplayIdPattern(
  template: string,
): RegExp | undefined {
  try {
    return compileDisplayIdPattern(template);
  } catch {
    return undefined;
  }
}

/**
 * The scope value of `displayId` for a numbered `pattern` with a `{scope}`
 * placeholder: the text the pattern regex captures in its `scope` group.
 * A padded counter may be wider than its padding here (`SRS_BRK_10000` for
 * `SRS_{scope}_{n:04d}` gives `BRK`), unlike in classification. Returns
 * `undefined` when the pattern has no `{scope}`, is malformed, or does not
 * match `displayId`.
 */
export function displayIdScope(
  pattern: string,
  displayId: string,
): string | undefined {
  return compileScopeReader(pattern)?.exec(displayId)?.groups?.scope;
}

/**
 * The regex that reads the `scope` group of a display ID for minting: the
 * pattern's regex with each padded counter matching at least its width, so
 * a scope whose IDs have passed `9999` for `{n:04d}` is still found. The
 * classifier ({@linkcode compileDisplayIdPattern}) keeps the exact width.
 * `undefined` when the pattern has no `{scope}` or is malformed.
 */
function compileScopeReader(pattern: string): RegExp | undefined {
  if (!hasScopePlaceholder(pattern)) return undefined;
  try {
    return buildPatternRegex(pattern, true);
  } catch {
    return undefined;
  }
}

/**
 * A test for the display IDs that count toward the next number of `scope`
 * under a numbered `pattern` with a `{scope}` placeholder: `false` for an ID
 * that {@linkcode displayIdScope} reads under another scope, `true`
 * otherwise. With nothing between `{scope}` and the counter
 * (`G_{scope}{n:04d}`), `G_BR10001` starts with the prefix `G_BR` but reads
 * as scope `BR1`, so it must not raise the next number of `BR`. An ID the
 * pattern does not match passes, and the caller's prefix test decides. Every
 * ID passes when the pattern has no `{scope}` or is malformed.
 */
export function displayIdScopeFilter(
  pattern: string,
  scope: string,
): (displayId: string) => boolean {
  const re = compileScopeReader(pattern);
  if (!re) return () => true;
  return (displayId) => {
    const found = re.exec(displayId)?.groups?.scope;
    return found === undefined || found === scope;
  };
}

/**
 * The scope values that {@linkcode displayIdScope} reads from the entries'
 * display IDs, sorted and deduplicated, including a scope whose IDs are wider
 * than the padding (`SRS_BRK_10000`). Empty when
 * the pattern has no `{scope}` placeholder or is malformed. The CLI lists
 * them when `--scope` is missing; the LSP offers one scaffold per scope.
 */
export function displayIdScopesInUse(
  pattern: string,
  entries: Iterable<{ readonly displayId: string }>,
): string[] {
  const re = compileScopeReader(pattern);
  if (!re) return [];
  const scopes = new Set<string>();
  for (const entry of entries) {
    const scope = re.exec(entry.displayId)?.groups?.scope;
    if (scope !== undefined) scopes.add(scope);
  }
  return [...scopes].sort();
}
