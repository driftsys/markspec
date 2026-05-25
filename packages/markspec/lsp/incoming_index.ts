/**
 * @module lsp/incoming_index
 *
 * Shared incoming-edge index for LSP helpers (codeLens, inlayHint).
 *
 * Builds a per-target `Map<DisplayId, number>` in one O(N × A × T) pass
 * over all entries, where N is entry count, A is average attributes per
 * entry, and T is average tokens per attribute value. The walk skips the
 * `Id` attribute (which carries the entry's own identifier, not an
 * incoming reference) and skips self-references (`STK_001` in
 * `STK_001`'s own `Satisfies:`).
 *
 * Same splitter (`[\s,]+`) and skip rules as `lsp/references.ts:findReferencingEntries`
 * so the count matches the references list shown when the corresponding
 * codeLens / hint is clicked.
 */

import type { DisplayId, Entry } from "../core/mod.ts";

/** Whitespace + comma splitter for attribute value lists. */
const TOKEN_SEPARATORS_RE = /[\s,]+/;

/**
 * Build `Map<DisplayId, number>` of incoming attribute references over
 * the entire workspace.
 *
 * Tokens come from splitting each `rawAttributes[].value` on `[\s,]+`.
 * The `Id` attribute is skipped (it declares the entry, not a reference).
 * Self-references (`e.displayId` appearing in `e`'s own attributes) are
 * skipped to match `findReferencingEntries`' semantics.
 */
export function buildIncomingCount(
  allEntries: readonly Entry[],
): Map<DisplayId, number> {
  const count = new Map<DisplayId, number>();
  for (const e of allEntries) {
    for (const attr of e.rawAttributes) {
      if (attr.key === "Id") continue;
      const tokens = attr.value.split(TOKEN_SEPARATORS_RE);
      for (const tok of tokens) {
        if (tok.length === 0) continue;
        if (tok === e.displayId) continue;
        count.set(
          tok as DisplayId,
          (count.get(tok as DisplayId) ?? 0) + 1,
        );
      }
    }
  }
  return count;
}
