/**
 * @module lsp/references
 *
 * Find-references helper. Given a target display ID and the set of
 * entries indexed by the workspace, returns the subset of entries
 * whose attribute values reference the target.
 *
 * Walks `rawAttributes` rather than `typedAttributes` because the
 * core typed map is keyed by canonical attribute name and value-type
 * categories; for the LSP we just need any attribute whose value
 * lists the target ID, regardless of whether the key is core- or
 * profile-declared.
 *
 * The identity slot (`Id`) is skipped — that's the *declaration* of
 * the entry, not a reference to another one. The entry whose
 * `displayId` matches the target (the definition site) is also
 * skipped; the LSP server adds it back when the request's
 * `includeDeclaration` is true.
 *
 * Unlike `rename.ts` / `highlights.ts`, this module needs no fence
 * awareness (#680): it walks parsed `Entry.rawAttributes`, never raw
 * file text, and the AST-based parser never turns a fenced code
 * example into a real `Entry` in the first place — so illustrative
 * trailers inside a fence can never surface here.
 */

import type { Entry } from "../core/model/mod.ts";

/**
 * Word-boundary splitter for values that may carry multiple ID
 * references separated by commas or whitespace (id-list attributes,
 * citation locators preceded by whitespace, etc.).
 */
const TOKEN_SEPARATORS_RE = /[\s,]+/;

/**
 * Return entries whose attribute values reference `targetDisplayId`.
 * Performs whole-token matches after splitting each value on
 * `[\s,]+`, so `REQ-001` does not match `REQ-0010` or partial
 * substrings.
 */
export function findReferencingEntries(
  entries: readonly Entry[],
  targetDisplayId: string,
): Entry[] {
  const out: Entry[] = [];
  for (const entry of entries) {
    if (entry.displayId === targetDisplayId) continue;
    let matched = false;
    for (const attr of entry.rawAttributes) {
      if (attr.key === "Id") continue;
      const tokens = attr.value.split(TOKEN_SEPARATORS_RE);
      if (tokens.includes(targetDisplayId)) {
        matched = true;
        break;
      }
    }
    if (matched) out.push(entry);
  }
  return out;
}
