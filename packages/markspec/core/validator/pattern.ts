/**
 * @module core/validator/pattern
 *
 * Display-ID pattern template → anchored RegExp.
 *
 * Grammar (per ADR-009 §5):
 *   pattern   := literal-prefix placeholder (literal-suffix)?
 *   placeholder := "{n}" | "{n:" PADDING "d}"
 *   PADDING   := "0" digits
 *
 * Examples:
 *   REQ-{n}           → ^REQ-(\d+)$
 *   REQ-{n:04d}       → ^REQ-(\d{4})$
 *   STAKE-REQ-{n:06d} → ^STAKE-REQ-(\d{6})$
 */

const PLACEHOLDER_RE = /\{n(?::(0\d+)d)?\}/;

/**
 * Compile a display-ID pattern template into an anchored RegExp.
 *
 * Throws if the template is missing the `{n}` placeholder or has an invalid
 * padding specifier.
 */
export function compileDisplayIdPattern(template: string): RegExp {
  const match = PLACEHOLDER_RE.exec(template);
  if (!match) {
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

  const padding = match[1];
  const placeholderStart = match.index;
  const placeholderEnd = match.index + match[0].length;

  const prefix = template.slice(0, placeholderStart);
  const suffix = template.slice(placeholderEnd);

  const digitGroup = padding ? `\\d{${Number(padding)}}` : `\\d+`;

  const regexSource = "^" + escapeRegex(prefix) + "(" + digitGroup + ")" +
    escapeRegex(suffix) + "$";
  return new RegExp(regexSource);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
