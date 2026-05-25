/**
 * @module lsp/inlay_hint
 *
 * Pure helper for the LSP `textDocument/inlayHint` handler. Emits two
 * kinds of hints per entry, positioned at the end of the title line:
 *
 *   - `: <type>` (`InlayHintKind.Type` = 1) — when the entry has no
 *     explicit `Type:` attribute and the parser resolved one from the
 *     display-ID prefix. Suppressing this when an explicit `Type:` is
 *     present avoids duplicating visible information.
 *
 *   - `(N dependents)` (`InlayHintKind.Parameter` = 2) — when N > 0.
 *     Per spec §5.2, the server emits this unconditionally; the client
 *     decides whether to render it (suppress when the dependents-codeLens
 *     is on, per `markspec.lsp.codeLens.dependents` setting in VS Code).
 *
 * Both hints render at end-of-title-line. The caller supplies a
 * `lineLength(line: number) => number` callback (1-based input) so the
 * helper stays decoupled from `@std/path` and the document text.
 *
 * Uses the shared {@linkcode buildIncomingCount} index — same source of
 * truth as `code_lens.ts`'s dependent count.
 *
 * Spec: `docs/spec/internal/markspec-lsp-feature-additions.md` §5.2.
 */

import type { Entry } from "../core/mod.ts";
import { buildIncomingCount } from "./incoming_index.ts";

/** LSP `InlayHintKind` numeric constants per spec 3.17. */
export const InlayHintKindType = 1;
export const InlayHintKindParameter = 2;

/** A subset of the LSP `InlayHint` interface. */
export interface InlayHint {
  readonly position: {
    readonly line: number;
    readonly character: number;
  };
  readonly label: string;
  readonly kind?: number;
  readonly paddingLeft?: boolean;
  readonly paddingRight?: boolean;
}

/**
 * Build the `InlayHint[]` for a document's entries.
 *
 * @param entries — entries declared in the document the client requested
 *   hints for.
 * @param allEntries — every entry in the workspace, used to compute
 *   dependent counts.
 * @param lineLength — `(line: number) => number` callback returning the
 *   character length of the given **1-based** line. Used to position the
 *   hint at the end of the entry's title line. Returns 0 if the line is
 *   out of range; the helper handles that by emitting at column 0.
 */
export function buildInlayHints(
  entries: readonly Entry[],
  allEntries: readonly Entry[],
  lineLength: (line: number) => number,
): InlayHint[] {
  if (entries.length === 0) return [];

  const incomingCount = buildIncomingCount(allEntries);

  const out: InlayHint[] = [];
  for (const entry of entries) {
    const lspLine = Math.max(0, entry.location.line - 1);
    const character = Math.max(0, lineLength(entry.location.line));
    const position = { line: lspLine, character };

    // Type hint: only when parser inferred a type AND no explicit
    // `Type:` raw attribute is present (would duplicate visible info).
    if (entry.type !== undefined) {
      const hasExplicitType = entry.rawAttributes.some((a) => a.key === "Type");
      if (!hasExplicitType) {
        out.push({
          position,
          label: `: ${entry.type}`,
          kind: InlayHintKindType,
          paddingLeft: true,
        });
      }
    }

    // Dependents hint: server emits unconditionally; client decides
    // whether to render (suppress when codeLens shows the same info).
    const depCount = incomingCount.get(entry.displayId) ?? 0;
    if (depCount > 0) {
      out.push({
        position,
        label: depCount === 1 ? "(1 dependent)" : `(${depCount} dependents)`,
        kind: InlayHintKindParameter,
        paddingLeft: true,
      });
    }
  }
  return out;
}
