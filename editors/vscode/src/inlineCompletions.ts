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

/** Lines scanned backward from the cursor when looking for the enclosing entry opener. */
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

  // Title slot: full line matches `- [DISPLAY_ID] ` with nothing after.
  const titleMatch = TITLE_SLOT_RE.exec(line);
  if (titleMatch) {
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

  // Trailer region (indent ≥ 4) with a non-trace attribute key: skip.
  // The eleven trace-link keys are already handled above; this guard
  // covers `Labels:`, `Type:`, and any unknown trailer key so we don't
  // send the AI a prose prompt on an attribute-value line.
  if (/^\s{4,}[A-Z][A-Za-z-]*\s*:/.test(line)) {
    return { kind: "skip" };
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

import { buildUserPrompt, type EntryRef, SYSTEM_PROMPT } from "./prompts";

/**
 * Lazy producer of model output. Each yielded string is a fresh chunk.
 * The provider concatenates chunks and aborts when the cancellation
 * token fires. In production this wraps `vscode.lm.sendRequest(...)`;
 * in tests it is replaced with a hand-rolled generator.
 */
export type ModelInvoker = (
  messages: readonly string[],
  token: CancellationToken,
) => AsyncIterable<string>;

/** Constructor dependencies for {@linkcode MarkspecInlineCompletionProvider}. */
export interface InlineProviderDeps {
  readonly modelInvoker: ModelInvoker;
  readonly listDocumentSymbols: (
    uri: unknown,
  ) => Promise<readonly EntryRef[]>;
  readonly listWorkspaceSymbols: (
    query: string,
  ) => Promise<readonly EntryRef[]>;
  readonly maxWorkspaceEntries: number;
}

/**
 * Lines of the document collected either side of the cursor and packed
 * into the prompt's `localWindow`. Kept tight to stay under typical
 * model context limits while preserving enough surrounding text for
 * the model to follow voice and structure.
 */
const LOCAL_WINDOW_RADIUS = 30;

export class MarkspecInlineCompletionProvider {
  constructor(private readonly deps: InlineProviderDeps) {}

  async provideInlineCompletionItems(
    document: TextDocument,
    position: Position,
    _context: InlineCompletionContext,
    token: CancellationToken,
  ): Promise<readonly InlineCompletionItem[] | null> {
    const cursorContext = classifyContext(document, position);
    if (cursorContext.kind === "skip") return null;

    const localWindow = readLocalWindow(document, position);
    const [currentFileEntries, workspaceEntries] = await Promise.all([
      this.deps.listDocumentSymbols(undefined),
      this.deps.listWorkspaceSymbols(""),
    ]);

    if (token.isCancellationRequested) return null;

    const cappedWorkspace = workspaceEntries.slice(
      0,
      this.deps.maxWorkspaceEntries,
    );

    const promptCtx = {
      cursorContext,
      localWindow,
      currentFileEntries,
      workspaceEntries: cappedWorkspace,
    };
    const userPrompt = buildUserPrompt(promptCtx);
    const messages = [SYSTEM_PROMPT, userPrompt];

    let text = "";
    for await (const chunk of this.deps.modelInvoker(messages, token)) {
      if (token.isCancellationRequested) return null;
      text += chunk;
    }
    if (token.isCancellationRequested) return null;
    if (text.length === 0) return null;

    // Return a plain object the production registration site converts
    // to `vscode.InlineCompletionItem`. Tests assert on the
    // `insertText` shape directly.
    return [{ insertText: text } as unknown as InlineCompletionItem];
  }
}

function readLocalWindow(
  document: TextDocument,
  position: Position,
): string {
  const start = Math.max(0, position.line - LOCAL_WINDOW_RADIUS);
  const end = Math.min(
    document.lineCount - 1,
    position.line + LOCAL_WINDOW_RADIUS,
  );
  const lines: string[] = [];
  for (let i = start; i <= end; i++) {
    lines.push(document.lineAt(i).text);
  }
  return lines.join("\n");
}
