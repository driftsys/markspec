/**
 * @module parser/entity_refs
 *
 * Inline `$Identifier` entity-reference extraction (spec §2.5.2).
 * Scans entry body prose for `$Identifier` tokens and classifies each by
 * its case convention (type / instance / constant).
 */

import type {
  EntityRef,
  EntityRefConvention,
  SourceLocation,
} from "../model/mod.ts";

/**
 * Lexical pattern for an inline entity reference. The leading `$` is the
 * sigil; identifier characters follow. The pattern intentionally rejects
 * the math-fence `$$…$$` form: a `$$` is consumed as two starts but the
 * caller (see {@linkcode extractEntityRefs}) discards any match preceded
 * by another `$`.
 */
const ENTITY_REF_RE = /\$([A-Za-z][A-Za-z0-9_]*)/g;

/**
 * Decide the case convention of an entity-reference identifier per spec
 * §2.5.2:
 *
 *   - `constant` — all-uppercase letters/digits/underscores, contains at
 *     least one underscore or digit, ends with `[A-Z0-9]`. Distinguishes
 *     `$DEBOUNCE_WINDOW` from a single-segment PascalCase like `$ASIL`.
 *   - `type` — starts with an uppercase letter (PascalCase / single
 *     uppercase segment).
 *   - `instance` — starts with a lowercase letter (camelCase).
 */
export function classifyConvention(ident: string): EntityRefConvention {
  if (/^[A-Z][A-Z0-9_]*[A-Z0-9]$/.test(ident) && /[_0-9]/.test(ident)) {
    return "constant";
  }
  if (/^[A-Z]/.test(ident)) return "type";
  return "instance";
}

/**
 * Extract `$Identifier` entity references from a body string.
 *
 * Skips fenced code blocks (between paired ` ``` ` or `~~~` markers) per
 * spec §2.5.2 (markers are recognised in prose only, not in verbatim
 * content). Skips math-fence `$$…$$` sequences by discarding any `$ident`
 * match preceded by another `$`.
 *
 * The reported {@linkcode SourceLocation} uses 1-based line numbers
 * relative to the body string; callers add the entry's body offset to
 * obtain file-relative positions.
 *
 * @param body Entry body prose (post-`splitBodyAndAttributes`).
 * @param baseLocation Source location of the body's first line, used as
 *   the `file` field on every emitted {@linkcode EntityRef} and as the
 *   starting line.
 */
export function extractEntityRefs(
  body: string,
  baseLocation: SourceLocation,
): EntityRef[] {
  const refs: EntityRef[] = [];
  const lines = body.split("\n");
  let inFence = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    ENTITY_REF_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ENTITY_REF_RE.exec(line)) !== null) {
      // Discard the second half of a `$$…$$` math fence.
      if (match.index > 0 && line[match.index - 1] === "$") continue;
      // Discard if the `$` is itself preceded by `\` (escaped).
      if (match.index > 0 && line[match.index - 1] === "\\") continue;
      refs.push({
        ident: match[0],
        convention: classifyConvention(match[1]),
        location: {
          file: baseLocation.file,
          line: baseLocation.line + lineIdx,
          column: match.index + 1,
        },
      });
    }
  }

  return refs;
}
