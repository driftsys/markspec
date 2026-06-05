/**
 * @module core/validator/pattern
 *
 * Display-ID pattern template → anchored RegExp.
 *
 * A pattern is one of two kinds, selected by whether it contains the `{n}`
 * counter:
 *
 *   numbered := segment+ (exactly one counter)   — mintable + classifying
 *   named    := segment+ (literal anchor, ≥1 named, no counter) — classifying
 *
 *   segment  := literal | counter | named
 *   counter  := "{n}" | "{n:" PADDING "d}"
 *   named    := "{" identifier "}"   (e.g. {scope}, {name})
 *   PADDING  := "0" digits
 *
 * **Numbered patterns** carry exactly one `{n}` counter — the numeric running
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
 *   XREQ_{scope}_{n:04d} → ^XREQ_(?<scope>[A-Za-z0-9]+)_(\d{4})$
 *   SWC_{name}           → ^SWC_(?<name>[A-Za-z0-9._/-]+)$
 */

// One token: the {n} counter (optionally padded) OR a {named} segment.
const TOKEN_RE = /\{n(?::(0\d+)d)?\}|\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/**
 * Character class for the trailing named placeholder of a *named* pattern —
 * the established display-ID token set (letters, digits, underscore, dot,
 * slash, hyphen). Wider than the medial-segment class so `SWC_{name}` matches
 * underscore-bearing IDs like `SWC_LIGHT_CTRL`.
 */
const REST_OF_ID_CLASS = "[A-Za-z0-9._/-]+";

/**
 * Character class for a medial named placeholder (e.g. `{scope}` between two
 * literal segments). A single free alphanumeric run that stops at the next
 * literal — never swallows an adjacent counter or separator.
 */
const SEGMENT_CLASS = "[A-Za-z0-9]+";

type PatternToken =
  | { readonly kind: "literal"; readonly text: string }
  | { readonly kind: "counter"; readonly padding?: string }
  | { readonly kind: "named"; readonly name: string };

/** Split a template into its literal / counter / named tokens. */
function tokenizePattern(template: string): PatternToken[] {
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

/**
 * Compile a display-ID pattern template into an anchored RegExp.
 *
 * Throws if the template:
 *   - has more than one `{n}` counter,
 *   - has an invalid padding specifier (`{n:...}` not of the `{n:NNd}` form),
 *   - has zero counters and no named placeholder (no variable part), or
 *   - has zero counters and no literal anchor (a bare `{name}` would match
 *     every display ID).
 */
export function compileDisplayIdPattern(template: string): RegExp {
  const tokens = tokenizePattern(template);
  const counters = tokens.filter((t) => t.kind === "counter").length;
  const namedCount = tokens.filter((t) => t.kind === "named").length;
  const hasLiteralAnchor = tokens.some(
    (t) => t.kind === "literal" && t.text.length > 0,
  );

  if (counters > 1) {
    throw new Error(
      `display-id-pattern '${template}': multiple {n} counters (expected one)`,
    );
  }

  if (counters === 0) {
    // A malformed counter (`{n:abc}`, `{n:4d}`) is not tokenized as a counter
    // — it lands in literal text. Surface it as an invalid padding error
    // before the missing-counter / named-pattern checks, preserving the
    // historical message for `{n:...}` typos.
    if (/\{n:[^}]*\}/.test(template)) {
      throw new Error(
        `display-id-pattern '${template}': invalid padding specifier ` +
          `(expected {n} or {n:NNd})`,
      );
    }
    if (namedCount === 0) {
      throw new Error(
        `display-id-pattern '${template}': missing {n} placeholder`,
      );
    }
    if (!hasLiteralAnchor) {
      throw new Error(
        `display-id-pattern '${template}': named pattern needs a literal ` +
          `prefix (a bare {name} would match every display ID)`,
      );
    }
  }

  // In a named (counter-less) pattern the trailing named placeholder matches
  // the rest of the display ID; every other named placeholder — and every
  // named placeholder in a numbered pattern — stays a single segment.
  const restOfIdNamedIndex = counters === 0
    ? tokens.reduce((acc, t, i) => (t.kind === "named" ? i : acc), -1)
    : -1;

  let regexSource = "^";
  tokens.forEach((t, i) => {
    if (t.kind === "literal") {
      regexSource += escapeRegex(t.text);
    } else if (t.kind === "counter") {
      regexSource += "(" +
        (t.padding ? `\\d{${Number(t.padding)}}` : `\\d+`) + ")";
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
