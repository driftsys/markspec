/**
 * @module codeLensCommands
 *
 * Pure helpers for the two CodeLens commands the MarkSpec LSP emits
 * in `packages/markspec/lsp/code_lens.ts`:
 *
 *   - `markspec.openDefinition` — clicking the "↓ Satisfies: ID — Title"
 *     lens. Arguments are `[uri, { line, character }]` when the target
 *     resolves, or `[]` when it doesn't (the LSP still emits the lens so
 *     the author can see the unresolved reference).
 *   - `markspec.openReferences` — clicking the "↑ N dependents" lens.
 *     Arguments are `[uri, { line, character }, locations]`, where
 *     `locations` is the server-resolved list of referencing entries
 *     (each `{uri, line, character}`) — the LSP already computed this
 *     via `findReferencingEntries` when it built the lens, so the
 *     client hands it straight to `editor.action.showReferences`
 *     rather than re-deriving it from a cursor position (the lens's
 *     position sits on the entry's `- [ID]` line start, which is not
 *     itself a display-ID token `vscode.executeReferenceProvider`
 *     could resolve).
 *
 * The parsers below validate the rehydrated payload (VS Code reconstitutes
 * `arguments` as plain objects across the LSP boundary, not as `Position`
 * instances) and return a discriminated union / filtered list the extension
 * dispatches on. Defended against malformed payloads from a buggy / hostile
 * LSP build — the handler should degrade gracefully rather than throw.
 */

/** Discriminated result of {@linkcode parseCodeLensTarget}. */
export type CodeLensTarget =
  | {
    readonly kind: "open";
    readonly uri: string;
    readonly line: number;
    readonly character: number;
  }
  | { readonly kind: "missing" };

/**
 * Parse a CodeLens command's `arguments` payload.
 *
 * Returns `{ kind: "missing" }` for the unresolved-Satisfies case
 * (empty argument list) and for any malformed shape (wrong arity,
 * non-string URI, non-numeric position fields, NaN, …). Returns
 * `{ kind: "open", … }` only when both the URI and the position
 * pass shape validation.
 */
export function parseCodeLensTarget(args: readonly unknown[]): CodeLensTarget {
  if (args.length === 0) return { kind: "missing" };
  if (args.length < 2) return { kind: "missing" };
  const uri = args[0];
  const pos = args[1];
  if (typeof uri !== "string" || uri.length === 0) return { kind: "missing" };
  if (pos === null || typeof pos !== "object") return { kind: "missing" };
  const line = (pos as { line?: unknown }).line;
  const character = (pos as { character?: unknown }).character;
  if (
    typeof line !== "number" || !Number.isFinite(line) || line < 0 ||
    typeof character !== "number" || !Number.isFinite(character) ||
    character < 0
  ) {
    return { kind: "missing" };
  }
  return { kind: "open", uri, line, character };
}

/** One resolved reference location — a subset of the LSP `Location` shape. */
export interface ReferenceLocation {
  readonly uri: string;
  readonly line: number;
  readonly character: number;
}

/**
 * Parse the third `markspec.openReferences` argument: the server-resolved
 * list of referencing entries' locations. Filters out malformed entries
 * (wrong shape, non-string uri, non-finite/negative position) individually
 * rather than rejecting the whole list, and tolerates a missing/non-array
 * third argument by returning an empty list.
 */
export function parseReferenceLocations(
  args: readonly unknown[],
): ReferenceLocation[] {
  const raw = args[2];
  if (!Array.isArray(raw)) return [];
  const out: ReferenceLocation[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const uri = (item as { uri?: unknown }).uri;
    const line = (item as { line?: unknown }).line;
    const character = (item as { character?: unknown }).character;
    if (
      typeof uri !== "string" || uri.length === 0 ||
      typeof line !== "number" || !Number.isFinite(line) || line < 0 ||
      typeof character !== "number" || !Number.isFinite(character) ||
      character < 0
    ) {
      continue;
    }
    out.push({ uri, line, character });
  }
  return out;
}
