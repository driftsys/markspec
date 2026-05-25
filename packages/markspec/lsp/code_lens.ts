/**
 * @module lsp/code_lens
 *
 * Pure helper for the LSP `textDocument/codeLens` handler. Emits two
 * kinds of lenses per entry, positioned on the entry's title line:
 *
 *   - "↑ N dependents" (when N > 0) — clicks dispatch
 *     `markspec.openReferences` with `[uri, position]` arguments.
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

  // Build per-target incoming-edge counts in one O(n) pass.
  const incomingCount = new Map<DisplayId, number>();
  for (const e of allEntries) {
    for (const attr of e.rawAttributes) {
      if (attr.key === "Id") continue;
      const tokens = attr.value.split(TOKEN_SEPARATORS_RE);
      for (const tok of tokens) {
        if (tok.length === 0) continue;
        if (tok === e.displayId) continue;
        incomingCount.set(
          tok as DisplayId,
          (incomingCount.get(tok as DisplayId) ?? 0) + 1,
        );
      }
    }
  }

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
      out.push({
        range,
        command: {
          title: depCount === 1 ? "↑ 1 dependent" : `↑ ${depCount} dependents`,
          command: "markspec.openReferences",
          arguments: [uri, position],
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
          out.push({
            range,
            command: {
              title: `↓ Satisfies: ${tok} — ${target.title}`,
              command: "markspec.openDefinition",
              arguments: [pathToUri(target.location.file), targetPos],
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
