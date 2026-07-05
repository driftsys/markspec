/**
 * @module lsp/code_lens
 *
 * Pure helper for the LSP `textDocument/codeLens` handler. Emits two
 * kinds of lenses per entry, positioned on the entry's title line:
 *
 *   - "↑ N dependents" (when N > 0) — clicks dispatch
 *     `markspec.openReferences` with `[uri, position, locations]`
 *     arguments, where `locations` is the resolved list of referencing
 *     entries' `{uri, line, character}` positions (from
 *     `findReferencingEntries`) for the client to hand straight to
 *     `editor.action.showReferences` — no client-side position lookup
 *     needed.
 *   - "↓ Satisfies: ID — Title" per `Satisfies:` value — clicks
 *     dispatch `markspec.openDefinition` with `[targetUri, targetPosition]`
 *     when the target resolves, or `[]` when it doesn't (lens still
 *     displays the source ID so the author can see the unresolved
 *     reference).
 *
 * Dependent counts come from an O(n) incoming-edge index built once
 * per call. Spec §5.4 budget: < 20ms per document.
 *
 * Spec: `docs/spec/internal/markspec-lsp-feature-additions.md` §5.1.
 */

import type { DisplayId, Entry } from "../core/mod.ts";
import { isUpstreamEntry } from "../core/mod.ts";
import { buildIncomingCount } from "./incoming_index.ts";
import { findReferencingEntries } from "./references.ts";

/** A subset of the LSP `Command` interface. */
export interface Command {
  readonly title: string;
  readonly command: string;
  readonly arguments?: readonly unknown[];
}

/** A subset of the LSP `CodeLens` interface. */
export interface CodeLens {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  readonly command?: Command;
}

/** Whitespace + comma splitter for `Satisfies:` value lists. Matches the
 * pattern used in `lsp/references.ts:findReferencingEntries`. */
const TOKEN_SEPARATORS_RE = /[\s,]+/;

/**
 * Build the `CodeLens[]` for a document's entries.
 *
 * @param entries — entries declared in the document the client requested
 *   lenses for. One lens range per entry, positioned on its title line.
 * @param allEntries — every entry in the workspace, used to compute
 *   dependent counts and resolve `Satisfies:` target titles.
 * @param pathToUri — convert a filesystem path to a `file://` URI.
 *   Passed in so the helper stays free of `@std/path` and platform-
 *   specific code (testable with an identity stub).
 */
export function buildCodeLenses(
  entries: readonly Entry[],
  allEntries: readonly Entry[],
  pathToUri: (path: string) => string,
): CodeLens[] {
  if (entries.length === 0) return [];

  const incomingCount = buildIncomingCount(allEntries);

  // Index targets by displayId so `Satisfies:` titles resolve in O(1).
  const byDisplayId = new Map<DisplayId, Entry>();
  for (const e of allEntries) {
    if (!byDisplayId.has(e.displayId)) byDisplayId.set(e.displayId, e);
  }

  const out: CodeLens[] = [];
  for (const entry of entries) {
    const line = Math.max(0, entry.location.line - 1);
    const position = { line, character: 0 };
    const range = { start: position, end: position };
    const uri = pathToUri(entry.location.file);

    // ↑ N dependents
    const depCount = incomingCount.get(entry.displayId) ?? 0;
    if (depCount > 0) {
      const referencing = findReferencingEntries(allEntries, entry.displayId);
      // Upstream entries (federated corpus, #783) carry a tree-relative
      // location.file that pathToUri cannot convert — filter them out
      // before conversion rather than throwing. depCount above still
      // counts them; the rare count/location mismatch is acceptable, the
      // invariant that matters is "no throw".
      const referenceLocations = referencing
        .filter((ref) => !isUpstreamEntry(ref))
        .map((ref) => ({
          uri: pathToUri(ref.location.file),
          line: Math.max(0, ref.location.line - 1),
          character: 0,
        }));
      out.push({
        range,
        command: {
          title: depCount === 1 ? "↑ 1 dependent" : `↑ ${depCount} dependents`,
          command: "markspec.openReferences",
          arguments: [uri, position, referenceLocations],
        },
      });
    }

    // ↓ Satisfies: ID — Title (one lens per value)
    for (const attr of entry.rawAttributes) {
      if (attr.key !== "Satisfies") continue;
      const tokens = attr.value.split(TOKEN_SEPARATORS_RE).filter(
        (t) => t.length > 0,
      );
      for (const tok of tokens) {
        const target = byDisplayId.get(tok as DisplayId);
        if (target) {
          const targetLine = Math.max(0, target.location.line - 1);
          const targetPos = { line: targetLine, character: 0 };
          // A resolved-but-upstream target keeps its informative title but
          // becomes non-clickable — its location.file is a tree-relative
          // path pathToUri cannot convert (#783).
          const navigable = !isUpstreamEntry(target);
          out.push({
            range,
            command: {
              title: `↓ Satisfies: ${tok} — ${target.title}`,
              command: "markspec.openDefinition",
              arguments: navigable
                ? [pathToUri(target.location.file), targetPos]
                : [],
            },
          });
        } else {
          out.push({
            range,
            command: {
              title: `↓ Satisfies: ${tok}`,
              command: "markspec.openDefinition",
              arguments: [],
            },
          });
        }
      }
    }
  }
  return out;
}
