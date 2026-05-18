/**
 * @module core/ast/equivalence
 *
 * The formal §5 AST-equivalence relation (ADR-015). Two `BodyBlock[]` are
 * equivalent iff structurally deep-equal after eliding every `range`
 * (`SourceRange`) key at any depth. Adopted UNCHANGED from SP1's
 * provisional relation — SP3 ratifies, it does not redefine. All §5.2
 * normalization is explicit in `normalizeBodyAst`, never in this
 * comparator (Formalization A).
 *
 * Load-bearing: consumed by the formatter guard (`emitBodyViaAst`) and
 * the SP1 fidelity harness. Pure library code: no `Deno.*`.
 */

import type { BodyBlock } from "./nodes.ts";

/** Formal §5 AST-equivalence: strict structural deep-equality of
 * `BodyBlock[]` ignoring every `range`. */
export function astEquivalent(
  a: readonly BodyBlock[],
  b: readonly BodyBlock[],
): boolean {
  return deepEqualIgnoringRanges(a, b);
}

/** Deep structural equality with every `range` key elided at any depth. */
function deepEqualIgnoringRanges(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualIgnoringRanges(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).filter((k) => k !== "range").sort();
    const bk = Object.keys(bo).filter((k) => k !== "range").sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i++) {
      if (ak[i] !== bk[i]) return false;
    }
    for (const k of ak) {
      if (!deepEqualIgnoringRanges(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}
