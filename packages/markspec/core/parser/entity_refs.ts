/**
 * @module parser/entity_refs
 *
 * Inline `$Identifier` entity-reference extraction (spec §2.5.2).
 * Scans entry body prose for `$Identifier` tokens and classifies each by
 * its case convention (type / instance / constant). Code and feature fence
 * boundaries are derived from the body AST to exclude verbatim content
 * without re-implementing fence detection on the raw string. Math-fence
 * handling retains the `$$`-toggle approach on the raw body string for
 * inline math contexts the AST cannot distinguish.
 */

import type {
  EntityRef,
  EntityRefConvention,
  SourceLocation,
} from "../model/mod.ts";
import { buildBodyAst } from "../ast/build.ts";
import type { BodyBlock } from "../ast/nodes.ts";

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

// ---------------------------------------------------------------------------
// Code/feature-block line-range collection from bodyAst
// ---------------------------------------------------------------------------

/**
 * Collect the set of 1-based body-relative line numbers that belong to
 * code or feature fenced blocks. These lines are unconditionally excluded
 * from entity-reference scanning.
 *
 * Math blocks (`MathNode`) are NOT included here — their interior lines
 * are excluded via the `$$`-toggle logic in {@linkcode extractEntityRefs}
 * (which handles both block-level and the inline `$$…$$` known-limitation
 * case that the AST cannot distinguish).
 *
 * Recurses into list items via the list branch to find nested verbatim blocks.
 */
function collectCodeFeatureLines(blocks: readonly BodyBlock[]): Set<number> {
  const excluded = new Set<number>();
  for (const block of blocks) {
    if (block.kind === "code" || block.kind === "feature") {
      for (let ln = block.range.start.line; ln <= block.range.end.line; ln++) {
        excluded.add(ln);
      }
    } else if (block.kind === "list") {
      for (const item of block.items) {
        for (const sub of item.blocks) {
          for (const ln of collectCodeFeatureLines([sub])) {
            excluded.add(ln);
          }
        }
      }
    }
  }
  return excluded;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract `$Identifier` entity references from a body string.
 *
 * Skips fenced code blocks (between paired ` ``` ` or `~~~` markers) per
 * spec §2.5.2 (markers are recognised in prose only, not in verbatim
 * content). Code and Feature fence boundaries are derived from the body AST
 * rather than regex-scanning the raw body string. Math content is skipped
 * two ways: an inline `$$…$$` fence by discarding any `$ident` match
 * preceded by another `$`; a multi-line display-math block (a line that is
 * exactly `$$`, its interior lines, and the closing `$$`) by tracking the
 * delimiter across lines — this retains the original `$$`-toggle approach
 * because the markdown AST does not distinguish inline `$$` fences from
 * plain text when no surrounding blank lines are present.
 *
 * The reported {@linkcode SourceLocation} uses 1-based line numbers
 * relative to the body string; callers add the entry's body offset to
 * obtain file-relative positions.
 *
 * @param body Entry body prose (post-`splitBodyAndAttributes`).
 * @param baseLocation Source location of the body's first line, used as
 *   the `file` field on every emitted {@linkcode EntityRef} and as the
 *   starting line.
 * @param blocks Optional pre-built body AST. When provided, the AST is used
 *   directly to identify code/feature block line ranges, avoiding a redundant
 *   `buildBodyAst` call. When omitted, the AST is built internally.
 */
export function extractEntityRefs(
  body: string,
  baseLocation: SourceLocation,
  blocks?: readonly BodyBlock[],
): EntityRef[] {
  if (!body.trim()) return [];

  // Use the caller-supplied body AST when available; otherwise build it
  // internally to identify code/feature block line ranges.
  const resolvedBlocks = blocks ?? buildBodyAst(body);
  const codeFeatureLines = collectCodeFeatureLines(resolvedBlocks);

  const refs: EntityRef[] = [];

  // A line whose only content is `$$` opens (or closes) a display-math
  // block; its interior lines are verbatim math, not prose. Inline
  // `$$…$$` on a single line is *not* a fence (trimmed ≠ `$$`) and is
  // still handled by the per-match "preceded by another $" guard below.
  let inMathFence = false;

  const lines = body.split("\n");
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    // Body lines are 1-based; codeFeatureLines stores 1-based line numbers.
    const bodyLine = lineIdx + 1;
    if (codeFeatureLines.has(bodyLine)) continue;

    if (line.trim() === "$$") {
      inMathFence = !inMathFence;
      continue;
    }
    if (inMathFence) continue;

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
