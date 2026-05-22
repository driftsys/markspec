/**
 * @module core/validator/pattern
 *
 * Display-ID pattern template → anchored RegExp.
 *
 * Grammar (per ADR-009 §5):
 *   pattern     := segment+ (exactly one counter)
 *   segment     := literal | counter | named
 *   counter     := "{n}" | "{n:" PADDING "d}"
 *   named       := "{" identifier "}"   (e.g. {scope}, {feature})
 *   PADDING     := "0" digits
 *
 * The counter `{n}` is the numeric running index (exactly one required). A
 * named placeholder such as `{scope}` matches a free alphanumeric segment —
 * it validates the *shape* `PREFIX_<scope>_<NNNN>` without pinning the scope
 * to a fixed value, so one profile pattern serves every feature scope.
 *
 * Examples:
 *   REQ-{n}              → ^REQ-(\d+)$
 *   REQ-{n:04d}          → ^REQ-(\d{4})$
 *   XREQ_{scope}_{n:04d} → ^XREQ_(?<scope>[A-Za-z0-9]+)_(\d{4})$
 */

// One token: the {n} counter (optionally padded) OR a {named} segment.
const TOKEN_RE = /\{n(?::(0\d+)d)?\}|\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/**
 * Compile a display-ID pattern template into an anchored RegExp.
 *
 * Throws if the template is missing the `{n}` counter, has more than one, or
 * has an invalid padding specifier.
 */
export function compileDisplayIdPattern(template: string): RegExp {
  let regexSource = "^";
  let lastIndex = 0;
  let counters = 0;
  const re = new RegExp(TOKEN_RE);
  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    regexSource += escapeRegex(template.slice(lastIndex, match.index));
    const named = match[2];
    if (named === undefined) {
      // {n} / {n:0Nd} counter
      const padding = match[1];
      regexSource += "(" + (padding ? `\\d{${Number(padding)}}` : `\\d+`) + ")";
      counters++;
    } else {
      // {scope}-style named segment → free alphanumeric capture
      regexSource += `(?<${named}>[A-Za-z0-9]+)`;
    }
    lastIndex = match.index + match[0].length;
  }
  regexSource += escapeRegex(template.slice(lastIndex)) + "$";

  if (counters === 0) {
    if (/\{n:[^}]*\}/.test(template)) {
      throw new Error(
        `display-id-pattern '${template}': invalid padding specifier ` +
          `(expected {n} or {n:NNd})`,
      );
    }
    throw new Error(
      `display-id-pattern '${template}': missing {n} placeholder`,
    );
  }
  if (counters > 1) {
    throw new Error(
      `display-id-pattern '${template}': multiple {n} counters (expected one)`,
    );
  }
  return new RegExp(regexSource);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
