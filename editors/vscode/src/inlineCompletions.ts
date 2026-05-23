/**
 * MarkSpec inline AI completion provider.
 *
 * Provides ghost-text completions backed by `vscode.lm` (Copilot's
 * Language Model API). The classifier in this module decides what kind
 * of MarkSpec authoring context the cursor sits in and shapes the
 * prompt accordingly. Workspace context is pulled via the standard
 * VSCode symbol provider commands so we re-use the LSP's existing
 * `workspace/symbol` and `textDocument/documentSymbol` indexing.
 */

import type {
  CancellationToken,
  InlineCompletionContext,
  InlineCompletionItem,
  Position,
  TextDocument,
} from "vscode";

// Re-export the vscode types so downstream files can import them from
// this module without duplicating the dependency declaration.
export type {
  CancellationToken,
  InlineCompletionContext,
  InlineCompletionItem,
  Position,
  TextDocument,
};

/** A specific MarkSpec authoring context derived from the cursor position. */
export type InlineContext =
  | { readonly kind: "title-after-bracket"; readonly displayId: string }
  | {
    readonly kind: "entry-body";
    readonly entryLine: number;
    readonly entryTitle: string;
  }
  | {
    readonly kind: "trace-attribute";
    readonly attribute: string;
    readonly entryTitle: string;
  }
  | { readonly kind: "doc-prose" }
  | { readonly kind: "skip" };

/** Lines scanned either side of the cursor when looking for the enclosing entry. */
const ENTRY_SEARCH_RADIUS = 50;

/** Entry-block opener: `- [DISPLAY_ID] Title` (trailing content optional). */
const ENTRY_OPENER_RE = /^\s*-\s+\[([A-Z][A-Z0-9_-]+)\]\s*(.*)$/;

/** Title-slot trigger: cursor at end of `- [DISPLAY_ID] ` with nothing after. */
const TITLE_SLOT_RE = /^\s*-\s+\[([A-Z][A-Z0-9_-]+)\]\s*$/;

/** Trace attribute keyword followed by the colon and any leading value. */
const TRACE_ATTR_RE =
  /^\s{4,}(Satisfies|Derived-from|Verified-by|References|Tests|Depends-on|Part-of|Allocated-to|Realizes|Generated-from|Supersedes)\s*:\s*/;

/** `Id:` trailer line — completions are suppressed here. */
const ID_TRAILER_RE = /^\s{4,}Id\s*:/;

/**
 * Classify the cursor context for inline-completion purposes.
 *
 * Cheap regex-based decision over a small window around the cursor.
 * No AST, no parser. Five outcomes: `skip` (no completion offered);
 * `title-after-bracket` (right after `- [DISPLAY_ID] `);
 * `entry-body` (inside an entry's body region);
 * `trace-attribute` (right after `Satisfies:` etc.);
 * `doc-prose` (anywhere else in a markdown file).
 */
export function classifyContext(
  document: TextDocument,
  position: Position,
): InlineContext {
  const line = document.lineAt(position.line).text;
  const beforeCursor = line.slice(0, position.character);

  // Hard-skip: cursor on an `Id:` trailer line.
  if (ID_TRAILER_RE.test(line)) {
    return { kind: "skip" };
  }

  // Title slot: line matches `- [DISPLAY_ID] ` and cursor is at end of line.
  const titleMatch = TITLE_SLOT_RE.exec(beforeCursor);
  if (titleMatch && position.character === beforeCursor.length) {
    return { kind: "title-after-bracket", displayId: titleMatch[1] };
  }

  // Trace attribute: cursor after `Satisfies: ` (etc.) on an indented line.
  const traceMatch = TRACE_ATTR_RE.exec(beforeCursor);
  if (traceMatch) {
    const enclosing = findEnclosingEntry(document, position.line);
    if (enclosing) {
      return {
        kind: "trace-attribute",
        attribute: traceMatch[1],
        entryTitle: enclosing.title,
      };
    }
  }

  // Entry body: scan backward for an entry opener within the search radius;
  // if found and the cursor is on an indented (≥2 spaces) line that is NOT
  // in the trailer region (≥4 spaces) and NOT another entry opener, classify
  // as `entry-body`.
  const enclosing = findEnclosingEntry(document, position.line);
  if (enclosing && enclosing.line !== position.line) {
    const indentMatch = /^(\s*)/.exec(line);
    const indent = indentMatch ? indentMatch[1].length : 0;
    if (indent >= 2 && indent < 4) {
      return {
        kind: "entry-body",
        entryLine: enclosing.line,
        entryTitle: enclosing.title,
      };
    }
  }

  // Default: plain markdown prose.
  return { kind: "doc-prose" };
}

interface EnclosingEntry {
  readonly line: number;
  readonly displayId: string;
  readonly title: string;
}

function findEnclosingEntry(
  document: TextDocument,
  fromLine: number,
): EnclosingEntry | undefined {
  const minLine = Math.max(0, fromLine - ENTRY_SEARCH_RADIUS);
  for (let i = fromLine; i >= minLine; i--) {
    const text = document.lineAt(i).text;
    const match = ENTRY_OPENER_RE.exec(text);
    if (match) {
      return { line: i, displayId: match[1], title: match[2].trim() };
    }
  }
  return undefined;
}
