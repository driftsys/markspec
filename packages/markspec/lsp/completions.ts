/**
 * @module lsp/completions
 *
 * Completion providers for MarkSpec entry blocks and ID references.
 *
 * Two triggers:
 * 1. Block scaffold — `- [` at line start → full entry block snippet
 * 2. ID reference — trace attribute keyword (e.g., `Satisfies:`) → display ID list
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

/** Entry type info for block scaffold completion. */
export interface EntryTypeInfo {
  readonly name: string;
  readonly prefix: string;
  readonly nextNumber: number;
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
 * Build completion items for the entry block scaffold trigger.
 *
 * If entry types are provided (from profile), returns one item per type
 * with pre-filled display ID and attribute skeleton. Otherwise returns
 * a single generic scaffold item.
 */
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

export function buildBlockScaffoldItems(
  types: readonly EntryTypeInfo[],
  ulidProvider: () => string,
): CompletionItemData[] {
  if (types.length === 0) {
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

  return types.map((type) => {
    const displayId = `${type.prefix}${padNumber(type.nextNumber)}`;
    const ulid = ulidProvider();
    return {
      label: `New ${type.name} (${displayId})`,
      detail: type.name,
      insertText:
        `${displayId}] \${1:Title}\n\n  \${2:Body.}\n\n      Id: ${ulid}\n      \${3:Satisfies: }`,
      isSnippet: true,
      kind: KIND_SNIPPET,
    };
  });
}
