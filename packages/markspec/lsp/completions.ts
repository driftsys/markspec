/**
 * @module lsp/completions
 *
 * Completion providers for MarkSpec entry blocks and ID references.
 *
 * Four triggers:
 * 1. Block scaffold — `- [` at line start → full entry block snippet
 * 2. Trailer attribute key — indented blank or partial capitalized key → key list
 * 3. ID reference — trace attribute keyword (e.g., `Satisfies:`) → display ID list
 * 4. Type: attribute value — `Type:` keyword → core and profile type list
 *
 * Block-scaffold items receive a fresh ULID from a `ulidProvider` callback so
 * insertions don't need a follow-up `markspec format` pass.
 *
 * All functions in this module are pure and testable without LSP connection.
 * The server module calls these and wraps results in LSP CompletionItem.
 */

import { CORE_ABSTRACT_TYPES, CORE_CONCRETE_TYPES } from "../core/model/mod.ts";
import type { DisplayIdEntry } from "./workspace.ts";

/** Block scaffold trigger pattern: `- [` at the start of a list item. */
const BLOCK_SCAFFOLD_RE = /^\s*-\s*\[$/;

/** Pattern matching a trace attribute keyword at line start. */
const TRACE_ATTR_RE =
  /^\s*(Satisfies|Derived-from|Verified-by|References|Tests|Depends-on|Part-of|Allocated-to|Realizes|Generated-from|Supersedes)\s*:/;

/** Pattern matching the `Type:` attribute keyword at line start. */
const TYPE_ATTR_RE = /^\s*Type\s*:/;

/**
 * Trailer attribute keys offered as completions inside an entry's
 * trailer region. Includes the eleven trace-link keys (whose pattern
 * also appears in `TRACE_ATTR_RE` and in `TRACE_KEYWORDS_RE` in
 * `context.ts`), plus the cardinal `Labels:` and `Type:` keys. When
 * the trace-keyword set changes here, also update those two regexes.
 *
 * `Id:` is intentionally excluded — the formatter stamps it
 * automatically, and hand-written ULIDs fail validation.
 */
export const TRAILER_KEYS: readonly string[] = [
  "Satisfies",
  "Derived-from",
  "Verified-by",
  "References",
  "Tests",
  "Depends-on",
  "Part-of",
  "Allocated-to",
  "Realizes",
  "Generated-from",
  "Supersedes",
  "Labels",
  "Type",
] as const;

/**
 * Trailer-region context: indent ≥4 whitespace chars (matches the
 * parser's lenient leading-whitespace acceptance; the formatter
 * canonicalises to 6 spaces), optional partial capitalized key.
 */
const TRAILER_KEY_CONTEXT_RE = /^\s{4,}([A-Z][A-Za-z-]*)?$/;

/**
 * Check whether the text before the cursor is in an entry's trailer
 * region and ready to receive an attribute key. Matches a line that
 * starts with at least 4 spaces of indent and contains nothing or a
 * partial capitalized key.
 */
export function isTrailerKeyContext(textBefore: string): boolean {
  return TRAILER_KEY_CONTEXT_RE.test(textBefore);
}

/**
 * Check if the text before cursor triggers a block scaffold completion.
 * Matches `- [` (with optional leading whitespace) at line start.
 */
export function isBlockScaffoldTrigger(textBefore: string): boolean {
  return BLOCK_SCAFFOLD_RE.test(textBefore);
}

/**
 * Check if the text before cursor triggers an ID reference completion.
 * Matches a trace attribute keyword followed by `:` at line start.
 */
export function isTraceAttributeTrigger(textBefore: string): boolean {
  return TRACE_ATTR_RE.test(textBefore);
}

/**
 * Check if the text before cursor triggers a `Type:` completion.
 * Matches the `Type:` attribute keyword at line start, optionally
 * followed by partial value text.
 */
export function isTypeAttributeTrigger(textBefore: string): boolean {
  return TYPE_ATTR_RE.test(textBefore);
}

/**
 * Extract the relation name from a line containing a trace attribute trigger.
 * Returns the attribute name (e.g., "Satisfies", "Derived-from").
 */
export function extractRelationName(textBefore: string): string | undefined {
  const match = TRACE_ATTR_RE.exec(textBefore);
  return match?.[1];
}

/** A completion item — protocol-independent for testability. */
export interface CompletionItemData {
  readonly label: string;
  readonly detail?: string;
  /** Snippet insert text (LSP snippet syntax with `${}` placeholders). */
  readonly insertText?: string;
  /** Whether insertText is a snippet. */
  readonly isSnippet: boolean;
  /** LSP CompletionItemKind numeric value. */
  readonly kind: number;
}

/** CompletionItemKind.Snippet = 15, CompletionItemKind.Reference = 18 */
const KIND_SNIPPET = 15;
const KIND_REFERENCE = 18;
/** LSP `CompletionItemKind.Property` numeric value (10). */
const KIND_PROPERTY = 10;

/** Entry type info for block scaffold completion. */
export interface EntryTypeInfo {
  readonly name: string;
  readonly prefix: string;
  readonly nextNumber: number;
  /**
   * `true` when this type is the recommended scaffold for the active
   * profile's discipline mode (ADR-017 Slice 5). `buildBlockScaffoldItems`
   * sorts recommended items first and appends ' (recommended)' to their
   * `detail` field. `undefined` or `false` → no special treatment.
   */
  readonly modeRecommended?: boolean;
}

/** Pad a number with leading zeros to at least 4 digits. */
function padNumber(n: number): string {
  return n.toString().padStart(4, "0");
}

/**
 * Build completion items for the ID reference trigger.
 * Returns one item per display ID in the workspace.
 */
export function buildIdReferenceItems(
  displayIds: readonly DisplayIdEntry[],
): CompletionItemData[] {
  return displayIds.map((entry) => ({
    label: entry.displayId,
    detail: entry.title,
    isSnippet: false,
    kind: KIND_REFERENCE,
  }));
}

/**
 * Build completion items for a `Type:` attribute trigger. Lists the
 * 16 core types (4 abstract + 12 concrete) followed by any
 * profile-declared type names. Core types come first so authors see
 * the spec-defined vocabulary before profile extensions.
 */
export function buildTypeAttributeItems(
  profileTypeNames: readonly string[],
): CompletionItemData[] {
  const items: CompletionItemData[] = [];
  for (const name of CORE_ABSTRACT_TYPES) {
    items.push({
      label: name,
      detail: "core abstract type",
      isSnippet: false,
      kind: KIND_REFERENCE,
    });
  }
  for (const name of CORE_CONCRETE_TYPES) {
    items.push({
      label: name,
      detail: "core concrete type",
      isSnippet: false,
      kind: KIND_REFERENCE,
    });
  }
  for (const name of profileTypeNames) {
    items.push({
      label: name,
      detail: "profile-declared type",
      isSnippet: false,
      kind: KIND_REFERENCE,
    });
  }
  return items;
}

/**
 * Build completion items for the trailer-key trigger. One item per
 * entry in {@linkcode TRAILER_KEYS}, each inserting `<Key>: ` with
 * the cursor placed after the colon.
 *
 * Kept as a zero-arg function (rather than a precomputed constant) for
 * naming symmetry with the other `build*Items` helpers and so future
 * profile-aware filtering can be added without changing the API.
 */
export function buildTrailerKeyItems(): CompletionItemData[] {
  return TRAILER_KEYS.map((key) => ({
    label: key,
    detail: "trailer attribute",
    insertText: `${key}: `,
    isSnippet: false,
    kind: KIND_PROPERTY,
  }));
}

/** Inputs to {@linkcode renderScaffoldSnippet}. */
export interface ScaffoldSnippetInput {
  readonly typeName: string;
  readonly prefix: string;
  readonly nextNumber: number;
  readonly ulid: string;
}

/**
 * Discriminator value for scaffold completions' resolve-time `data` payload.
 *
 * @internal Exported only so `server.ts` can attach and recognise the
 *   payload across the `onCompletion` / `onCompletionResolve` boundary.
 */
export const SCAFFOLD_COMPLETION_KIND = "scaffold";

/**
 * `data` payload attached to scaffold completion items so the
 * `completionItem/resolve` handler can re-query the workspace index
 * and regenerate the snippet with the freshest display ID + ULID.
 *
 * @internal Exported only so `server.ts` can attach and recognise the
 *   payload across the `onCompletion` / `onCompletionResolve` boundary.
 */
export interface ScaffoldCompletionData {
  readonly kind: typeof SCAFFOLD_COMPLETION_KIND;
  readonly typeName: string;
  readonly prefix: string;
}

/**
 * Escape user-provided text for inclusion in LSP snippet syntax. `$` and
 * `\` are the only metacharacters in the LSP snippet grammar (§Snippet
 * Syntax). Profile-declared prefixes / type names flow in from user-edited
 * `project.yaml` and must not be able to inject tab stops or placeholders
 * into the rendered snippet.
 */
function escapeSnippet(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
}

/**
 * Render the label + snippet text for one scaffold completion. Shared
 * by the build-time path (`buildBlockScaffoldItems`) and the resolve-
 * time path (`onCompletionResolve` in `server.ts`) so both render the
 * same shape from the same primitives.
 *
 * @returns An object with `label` and `insertText`. The `insertText`
 *   field uses LSP snippet syntax with `${}` placeholders for tab stops.
 */
export function renderScaffoldSnippet(
  input: ScaffoldSnippetInput,
): { label: string; insertText: string } {
  const safePrefix = escapeSnippet(input.prefix);
  const safeTypeName = escapeSnippet(input.typeName);
  const displayId = `${safePrefix}${padNumber(input.nextNumber)}`;
  return {
    label: `New ${safeTypeName} (${displayId})`,
    insertText:
      `${displayId}] \${1:Title}\n\n  \${2:Body.}\n\n      Id: ${input.ulid}\n      \${3:Satisfies: }`,
  };
}

/**
 * Build completion items for the entry block scaffold trigger.
 *
 * @param types - Entry types declared by the active profile. Each element
 *   carries the type `name`, its display-ID `prefix`, and the `nextNumber`
 *   to use for the pre-filled display ID.
 * @param ulidProvider - Zero-argument callback that returns a fresh ULID
 *   string. Called once per item when `types` is non-empty; the returned
 *   string is baked directly into the snippet so the author does not need
 *   to run a follow-up `markspec format` pass.
 *
 * When `types` is non-empty, returns one snippet item per type with a
 * pre-filled display ID and attribute skeleton. The typed-profile path
 * calls `ulidProvider()` once per item and bakes the real ULID into the
 * snippet text.
 *
 * When `types` is empty (no profile loaded), returns a single generic
 * scaffold item that retains the literal `${ULID}` placeholder. The
 * `ulidProvider` is accepted but unused in the zero-types branch — there
 * is no profile context to anchor a real ULID against, so the user must
 * run `markspec format` afterwards.
 */
export function buildBlockScaffoldItems(
  types: readonly EntryTypeInfo[],
  ulidProvider: () => string,
): CompletionItemData[] {
  if (types.length === 0) {
    // The fallback intentionally keeps the literal `${ULID}` placeholder —
    // there is no profile context to anchor a real ULID against, so the user
    // must run `markspec format` afterwards. The `ulidProvider` is accepted
    // but unused in this branch.
    return [
      {
        label: "New entry",
        insertText:
          "${1:PREFIX_NNNN}] ${2:Title}\n\n  ${3:Body.}\n\n      Id: \\${ULID}",
        isSnippet: true,
        kind: KIND_SNIPPET,
      },
    ];
  }

  // ADR-017 Slice 5: sort modeRecommended first, stable within each
  // group (don't re-alphabetize — preserve caller's order so
  // server.ts/getEntryTypes can control overall ordering).
  const sorted = [...types]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const aRec = a.t.modeRecommended === true ? 1 : 0;
      const bRec = b.t.modeRecommended === true ? 1 : 0;
      if (aRec !== bRec) return bRec - aRec; // recommended first
      return a.i - b.i; // stable within group
    })
    .map(({ t }) => t);

  return sorted.map((type) => {
    const rendered = renderScaffoldSnippet({
      typeName: type.name,
      prefix: type.prefix,
      nextNumber: type.nextNumber,
      ulid: ulidProvider(),
    });
    const detail = type.modeRecommended === true
      ? `${type.name} (recommended)`
      : type.name;
    return {
      label: rendered.label,
      detail,
      insertText: rendered.insertText,
      isSnippet: true,
      kind: KIND_SNIPPET,
    };
  });
}
