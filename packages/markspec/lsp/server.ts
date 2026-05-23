/**
 * @module lsp
 *
 * MarkSpec LSP server — real-time diagnostics, entry block completion,
 * and ID reference completion for MarkSpec documents and source doc comments.
 *
 * This is a standalone compile target:
 *   deno compile packages/markspec/lsp/server.ts → markspec-lsp
 *
 * Communicates over stdin/stdout JSON-RPC. The `markspec lsp` CLI subcommand
 * dispatches to the `markspec-lsp` binary on PATH.
 */

import {
  type CompletionItem,
  CompletionItemKind,
  createConnection,
  type Diagnostic as LspDiagnosticType,
  type InitializeParams,
  type InitializeResult,
  InsertTextFormat,
  ProposedFeatures,
  StreamMessageReader,
  StreamMessageWriter,
  TextDocuments,
  TextDocumentSyncKind,
  type TextEdit as LspTextEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import process from "node:process";
import { join } from "@std/path";
import { ulid } from "@std/ulid";
import {
  CORE_SCHEMA_VERSION,
  DEFAULT_PROJECT_CONFIG,
  type Diagnostic as CoreDiagnostic,
  discoverProjectRoot,
  type EffectiveProfile,
  loadConfig,
  loadProfileForCommand,
  makeDisplayId,
  type ProjectConfig,
  VERSION,
} from "../core/mod.ts";
import { WorkspaceIndex } from "./workspace.ts";
import { groupDiagnosticsByFile, toLspDiagnostic } from "./diagnostics.ts";
import { buildCodeActions } from "./code_actions.ts";
import { entryToLspLocation } from "./definition.ts";
import { displayIdAtPosition, formatHoverContent } from "./hover.ts";
import { entriesToFoldingRanges } from "./folding.ts";
import { findOccurrencesInFile } from "./highlights.ts";
import { findReferencingEntries } from "./references.ts";
import { findIdOccurrencesInFile, prepareRenameRange } from "./rename.ts";
import {
  buildSemanticTokens,
  SEMANTIC_TOKEN_LEGEND,
} from "./semantic_tokens.ts";
import { buildEntryRanges, type EntryRangesResponse } from "./entry_ranges.ts";
import {
  entriesToDocumentSymbols,
  entriesToWorkspaceSymbols,
} from "./symbols.ts";
import {
  buildBlockScaffoldItems,
  buildIdReferenceItems,
  buildTypeAttributeItems,
  type EntryTypeInfo,
  isBlockScaffoldTrigger,
  isTraceAttributeTrigger,
  isTypeAttributeTrigger,
  renderScaffoldSnippet,
} from "./completions.ts";
import {
  isDocCommentContext,
  isMarkspecFile,
  isSourceFile,
} from "./context.ts";
import {
  debounce,
  type DebouncedFunction,
  pathToUri,
  uriToPath,
} from "./util.ts";
import { debugLog } from "./debug_log.ts";

// ---------------------------------------------------------------------------
// Connection and document manager
// ---------------------------------------------------------------------------

const connection = createConnection(
  ProposedFeatures.all,
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);
const documents = new TextDocuments(TextDocument);

debugLog(
  `server starting (pid=${Deno.pid}, args=${JSON.stringify(Deno.args)})`,
);

globalThis.addEventListener("unhandledrejection", (e) => {
  e.preventDefault();
  const reason = (e.reason as Error)?.stack ?? String(e.reason);
  debugLog(`unhandledrejection: ${reason}`);
  try {
    connection.console.error(`unhandled rejection: ${reason}`);
  } catch { /* connection may not be ready */ }
});

globalThis.addEventListener("error", (e) => {
  const stack = e.error?.stack ?? e.message;
  debugLog(`error: ${stack}`);
  try {
    connection.console.error(`uncaught error: ${stack}`);
  } catch { /* connection may not be ready */ }
});

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

let projectRoot: string | undefined;
let _config: ProjectConfig = DEFAULT_PROJECT_CONFIG;
let profile: EffectiveProfile | undefined;
const index = new WorkspaceIndex();
// Cached cross-file validation result. Updated by publishAllDiagnostics
// and read by request handlers (e.g. markspec/entryRanges) so they
// don't re-run validateAll() on every keystroke.
let lastDiagnostics: readonly CoreDiagnostic[] = [];

// ---------------------------------------------------------------------------
// File reader for core functions (uses Deno APIs — allowed in entry points)
// ---------------------------------------------------------------------------

async function readFile(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return undefined;
  }
}

async function readFileRequired(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/** Publish diagnostics for a single file from its parsed entries. */
function publishFileDiagnostics(
  filePath: string,
  diagnostics: readonly CoreDiagnostic[],
): void {
  const uri = pathToUri(filePath);
  const lspDiags = diagnostics
    .filter((d) => d.location?.file === filePath)
    .map(toLspDiagnostic) as unknown as LspDiagnosticType[];
  connection.sendDiagnostics({ uri, diagnostics: lspDiags });
}

/** Run cross-file validation and publish diagnostics for all files. */
function publishAllDiagnostics(): void {
  const allDiags = index.validateAll(profile ?? null);
  lastDiagnostics = allDiags;
  const grouped = groupDiagnosticsByFile(allDiags);

  // Send diagnostics for files that have issues
  for (const [file, diags] of grouped) {
    const uri = pathToUri(file);
    connection.sendDiagnostics({
      uri,
      diagnostics: diags.map(toLspDiagnostic) as unknown as LspDiagnosticType[],
    });
  }

  // Clear diagnostics for tracked files with no issues
  for (const file of index.getFilePaths()) {
    if (!grouped.has(file)) {
      connection.sendDiagnostics({
        uri: pathToUri(file),
        diagnostics: [],
      });
    }
  }
}

// Debounced cross-file validation (1000ms)
const debouncedValidateAll = debounce(publishAllDiagnostics, 1000);

// Per-file debounced parse — serializes rapid edits and prevents stale
// index writes from concurrent async parse calls (B2).
const pendingContent = new Map<string, string>();
// deno-lint-ignore no-explicit-any
const debouncedFileParses = new Map<string, DebouncedFunction<any>>();

// ---------------------------------------------------------------------------
// Completions
// ---------------------------------------------------------------------------

/** Build EntryTypeInfo array from the active profile. */
function getEntryTypes(): EntryTypeInfo[] {
  if (!profile) return [];
  const types: EntryTypeInfo[] = [];
  for (const [name, typeDef] of profile.types) {
    const pattern = typeDef.value.displayIdPattern.value;
    if (!pattern) continue;
    // Extract the fixed prefix before the numeric placeholder.
    // Patterns look like "STK_AEB_{NNNN}" or "STK_{NNNN}".
    const placeholderIndex = pattern.indexOf("{");
    if (placeholderIndex < 0) continue;
    const prefix = pattern.slice(0, placeholderIndex);
    const nextNumber = index.getNextDisplayIdNumber(prefix);
    types.push({ name, prefix, nextNumber });
  }
  return types;
}

/**
 * Encode the intermediate semantic-token shape to the LSP wire
 * format — a flat number array where each token contributes 5 ints:
 * deltaLine, deltaStart, length, tokenType, tokenModifiers (bitmask).
 *
 * Input tokens MUST be sorted by (line, startChar). `buildSemanticTokens`
 * returns them sorted.
 */
function encodeSemanticTokens(
  tokens: ReturnType<typeof buildSemanticTokens>,
): number[] {
  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;
  for (const t of tokens) {
    const deltaLine = t.line - prevLine;
    const deltaStart = deltaLine === 0 ? t.startChar - prevChar : t.startChar;
    const typeIndex = SEMANTIC_TOKEN_LEGEND.tokenTypes.indexOf(t.tokenType);
    let modMask = 0;
    for (const m of t.tokenModifiers) {
      const idx = SEMANTIC_TOKEN_LEGEND.tokenModifiers.indexOf(m);
      if (idx >= 0) modMask |= 1 << idx;
    }
    data.push(deltaLine, deltaStart, t.length, typeIndex, modMask);
    prevLine = t.line;
    prevChar = t.startChar;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

connection.onInitialize(
  async (params: InitializeParams): Promise<InitializeResult> => {
    debugLog("onInitialize: start");
    const rootUri = params.rootUri ?? params.rootPath;
    if (rootUri) {
      const rootPath = rootUri.startsWith("file://")
        ? uriToPath(rootUri)
        : rootUri;
      projectRoot = await discoverProjectRoot(rootPath, readFile) ?? rootPath;

      // Load config
      try {
        const configResult = await loadConfig(projectRoot, readFile);
        if (configResult) {
          _config = configResult.config;
        }
      } catch {
        connection.console.warn("Failed to load project.yaml");
      }

      // Load profile
      try {
        const profileResult = await loadProfileForCommand(
          projectRoot,
          readFile,
        );
        if (profileResult.chain) {
          profile = profileResult.chain.effective;
        }
      } catch {
        connection.console.warn("Failed to load profile");
      }
    }

    debugLog("onInitialize: end");
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,
        completionProvider: {
          triggerCharacters: ["[", ":"],
          resolveProvider: true,
        },
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        renameProvider: { prepareProvider: true },
        foldingRangeProvider: true,
        documentHighlightProvider: true,
        codeActionProvider: { codeActionKinds: ["quickfix"] },
        semanticTokensProvider: {
          legend: {
            tokenTypes: [...SEMANTIC_TOKEN_LEGEND.tokenTypes],
            tokenModifiers: [...SEMANTIC_TOKEN_LEGEND.tokenModifiers],
          },
          range: false,
          full: true,
        },
      },
      serverInfo: {
        name: "markspec",
        version: `${VERSION} (core-schema ${CORE_SCHEMA_VERSION})`,
      },
    };
  },
);

// ---------------------------------------------------------------------------
// Initialized — build the workspace index
// ---------------------------------------------------------------------------

connection.onInitialized(async () => {
  debugLog("onInitialized: start");
  if (!projectRoot) {
    connection.console.log("No project root found — running without index");
    debugLog("onInitialized: end (no project root)");
    return;
  }

  connection.console.log(`Indexing project at ${projectRoot}...`);

  try {
    // Discover all relevant files
    const files: string[] = [];
    for await (const entry of walkDirectory(projectRoot)) {
      if (isMarkspecFile(entry)) {
        files.push(entry);
      }
    }

    // Parse all files
    for (const filePath of files) {
      try {
        const content = await readFileRequired(filePath);
        await index.parseAndUpdateFile(filePath, content);
      } catch {
        connection.console.warn(`Failed to parse: ${filePath}`);
      }
    }

    connection.console.log(
      `Indexed ${files.length} files, ${index.getAllEntries().length} entries`,
    );
    debugLog(`onInitialized: indexed ${files.length} files`);

    // Initial cross-file validation
    publishAllDiagnostics();

    connection.sendNotification("markspec/indexed", {
      files: files.length,
      entries: index.getAllEntries().length,
    });

    connection.sendNotification("markspec/version", {
      release: VERSION,
      coreSchemaVersion: CORE_SCHEMA_VERSION,
    });
  } catch (err) {
    connection.console.error(`Indexing failed: ${err}`);
    debugLog(`onInitialized: indexing failed: ${err}`);
  }
  debugLog("onInitialized: end");
});

// ---------------------------------------------------------------------------
// Document sync
// ---------------------------------------------------------------------------

documents.onDidChangeContent((change) => {
  const filePath = uriToPath(change.document.uri);
  if (!isMarkspecFile(filePath)) return;

  // Stash latest content so the debounced parse always uses the most
  // recent snapshot, even if multiple edits arrive before the timer fires.
  pendingContent.set(filePath, change.document.getText());

  let debouncedParse = debouncedFileParses.get(filePath);
  if (!debouncedParse) {
    debouncedParse = debounce(async () => {
      const content = pendingContent.get(filePath);
      if (content === undefined) return;
      const parseDiags = await index.parseAndUpdateFile(filePath, content);
      publishFileDiagnostics(filePath, parseDiags);
      debouncedValidateAll();
    }, 50);
    debouncedFileParses.set(filePath, debouncedParse);
  }
  debouncedParse();
});

documents.onDidSave(() => {
  // Force cross-file validation on save
  debouncedValidateAll.cancel();
  publishAllDiagnostics();
});

documents.onDidClose((event) => {
  const filePath = uriToPath(event.document.uri);
  if (!isMarkspecFile(filePath)) return;
  // Remove the file from the index and clear its diagnostics so stale
  // entries don't affect cross-file validation after the buffer closes.
  index.removeFile(filePath);
  pendingContent.delete(filePath);
  debouncedFileParses.delete(filePath);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  debouncedValidateAll();
});

documents.onDidOpen(async (event) => {
  const filePath = uriToPath(event.document.uri);
  if (!isMarkspecFile(filePath)) return;
  // Index newly opened files immediately so rename and other workspace
  // operations cover them even before the first edit event fires.
  if (index.getFilePaths().includes(filePath)) return; // already indexed
  const parseDiags = await index.parseAndUpdateFile(
    filePath,
    event.document.getText(),
  );
  publishFileDiagnostics(filePath, parseDiags);
  debouncedValidateAll();
});

// ---------------------------------------------------------------------------
// Completions
// ---------------------------------------------------------------------------

connection.onCompletion((params): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const filePath = uriToPath(params.textDocument.uri);

  // Source file position guard
  if (isSourceFile(filePath)) {
    const lines = document.getText().split("\n");
    if (!isDocCommentContext(lines, params.position.line)) {
      return [];
    }
  }

  const line = document.getText({
    start: { line: params.position.line, character: 0 },
    end: params.position,
  });

  // Trigger 1: Block scaffold
  if (isBlockScaffoldTrigger(line)) {
    const types = getEntryTypes();
    const items = buildBlockScaffoldItems(types, ulid);
    return items.map((item, i) => {
      const type = types[i];
      return {
        label: item.label,
        detail: item.detail,
        insertText: item.insertText,
        insertTextFormat: item.isSnippet
          ? InsertTextFormat.Snippet
          : InsertTextFormat.PlainText,
        kind: item.isSnippet
          ? CompletionItemKind.Snippet
          : CompletionItemKind.Reference,
        data: type
          ? { kind: "scaffold", typeName: type.name, prefix: type.prefix }
          : undefined,
      };
    });
  }

  // Trigger 2: ID reference
  if (isTraceAttributeTrigger(line)) {
    const displayIds = index.getAllDisplayIds();
    const items = buildIdReferenceItems(displayIds);
    return items.map((item) => ({
      label: item.label,
      detail: item.detail,
      kind: CompletionItemKind.Reference,
    }));
  }

  // Trigger 3: Type: attribute value — core types + profile types.
  if (isTypeAttributeTrigger(line)) {
    const profileTypeNames = profile ? [...profile.types.keys()] : [];
    const items = buildTypeAttributeItems(profileTypeNames);
    return items.map((item) => ({
      label: item.label,
      detail: item.detail,
      kind: CompletionItemKind.Reference,
    }));
  }

  return [];
});

connection.onCompletionResolve((item): CompletionItem => {
  const data = item.data as
    | { kind?: string; typeName?: string; prefix?: string }
    | undefined;
  if (data?.kind !== "scaffold" || !data.typeName || !data.prefix) {
    return item;
  }
  const nextNumber = index.getNextDisplayIdNumber(data.prefix);
  const rendered = renderScaffoldSnippet({
    typeName: data.typeName,
    prefix: data.prefix,
    nextNumber,
    ulid: ulid(),
  });
  return {
    ...item,
    label: rendered.label,
    insertText: rendered.insertText,
  };
});

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

connection.onHover((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const filePath = uriToPath(params.textDocument.uri);

  // Source-file position guard — only consider doc-comment context.
  if (isSourceFile(filePath)) {
    const lines = document.getText().split("\n");
    if (!isDocCommentContext(lines, params.position.line)) {
      return null;
    }
  }

  const line = document.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line, character: Number.MAX_SAFE_INTEGER },
  });

  const id = displayIdAtPosition(line, params.position.character);
  if (!id) return null;
  const entry = index.getEntryByDisplayId(makeDisplayId(id));
  if (!entry) return null;

  return {
    contents: { kind: "markdown", value: formatHoverContent(entry) },
  };
});

// ---------------------------------------------------------------------------
// Definition (go to entry source)
// ---------------------------------------------------------------------------

connection.onDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const filePath = uriToPath(params.textDocument.uri);

  // Source-file position guard.
  if (isSourceFile(filePath)) {
    const lines = document.getText().split("\n");
    if (!isDocCommentContext(lines, params.position.line)) {
      return null;
    }
  }

  const line = document.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line, character: Number.MAX_SAFE_INTEGER },
  });

  const id = displayIdAtPosition(line, params.position.character);
  if (!id) return null;
  const entry = index.getEntryByDisplayId(makeDisplayId(id));
  if (!entry) return null;

  return entryToLspLocation(entry);
});

// ---------------------------------------------------------------------------
// References (find all references to an entry)
// ---------------------------------------------------------------------------

connection.onReferences((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const filePath = uriToPath(params.textDocument.uri);
  if (isSourceFile(filePath)) {
    const lines = document.getText().split("\n");
    if (!isDocCommentContext(lines, params.position.line)) {
      return null;
    }
  }

  const line = document.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line, character: Number.MAX_SAFE_INTEGER },
  });

  const id = displayIdAtPosition(line, params.position.character);
  if (!id) return null;

  const referencing = findReferencingEntries(index.getAllEntries(), id);
  const locations = referencing.map(entryToLspLocation);

  // includeDeclaration: prepend the declaration's location when asked.
  if (params.context?.includeDeclaration) {
    const decl = index.getEntryByDisplayId(makeDisplayId(id));
    if (decl) locations.unshift(entryToLspLocation(decl));
  }

  return locations;
});

// ---------------------------------------------------------------------------
// Document symbols (outline view)
// ---------------------------------------------------------------------------

connection.onDocumentSymbol((params) => {
  const filePath = uriToPath(params.textDocument.uri);
  if (!isMarkspecFile(filePath)) return null;
  const entries = index.getEntriesForFile(filePath);
  // The result conforms to LSP `DocumentSymbol[]`; cast to satisfy the
  // node-server.d.ts overload that returns `SymbolInformation[]` by
  // default when the parameter is unannotated.
  // deno-lint-ignore no-explicit-any
  return entriesToDocumentSymbols(entries) as any;
});

// ---------------------------------------------------------------------------
// Workspace symbols (fuzzy entry search)
// ---------------------------------------------------------------------------

connection.onWorkspaceSymbol((params) => {
  // The result conforms to LSP `SymbolInformation[]`; cast to satisfy
  // the typed `SymbolKind` enum the d.ts expects.
  // deno-lint-ignore no-explicit-any
  return entriesToWorkspaceSymbols(index.getAllEntries(), params.query) as any;
});

// ---------------------------------------------------------------------------
// Rename (workspace-wide rename of a display ID)
// ---------------------------------------------------------------------------

connection.onPrepareRename((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const filePath = uriToPath(params.textDocument.uri);
  if (isSourceFile(filePath)) {
    const lines = document.getText().split("\n");
    if (!isDocCommentContext(lines, params.position.line)) {
      return null;
    }
  }

  const line = document.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line, character: Number.MAX_SAFE_INTEGER },
  });
  return prepareRenameRange(
    line,
    params.position.character,
    params.position.line,
  );
});

connection.onRenameRequest(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const filePath = uriToPath(params.textDocument.uri);
  if (isSourceFile(filePath)) {
    const lines = document.getText().split("\n");
    if (!isDocCommentContext(lines, params.position.line)) {
      return null;
    }
  }

  const line = document.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line, character: Number.MAX_SAFE_INTEGER },
  });
  const oldId = displayIdAtPosition(line, params.position.character);
  if (!oldId) return null;
  const newId = params.newName;
  if (!newId || newId === oldId) return null;

  // Build per-file TextEdits across the entire workspace. For each
  // tracked file, prefer the open-document text (live editor state)
  // and fall back to reading from disk.
  const changes: Record<string, LspTextEdit[]> = {};
  for (const path of index.getFilePaths()) {
    const uri = pathToUri(path);
    let text: string | undefined;
    const openDoc = documents.get(uri);
    if (openDoc) {
      text = openDoc.getText();
    } else {
      text = await readFile(path);
    }
    if (text === undefined) continue;
    const fileEdits = findIdOccurrencesInFile(text, oldId, newId);
    if (fileEdits.length > 0) {
      changes[uri] = fileEdits as unknown as LspTextEdit[];
    }
  }
  return { changes };
});

// ---------------------------------------------------------------------------
// Code actions (quick fixes for diagnostics)
// ---------------------------------------------------------------------------

connection.onCodeAction((params) => {
  const filePath = uriToPath(params.textDocument.uri);
  if (!isMarkspecFile(filePath)) return null;
  const document = documents.get(params.textDocument.uri);
  const documentText = document?.getText();
  // deno-lint-ignore no-explicit-any
  const diagnostics = params.context.diagnostics as any;
  const actions = buildCodeActions(
    params.textDocument.uri,
    diagnostics,
    documentText,
  );
  // deno-lint-ignore no-explicit-any
  return actions as any;
});

// ---------------------------------------------------------------------------
// Document highlights (mark every occurrence in the current file)
// ---------------------------------------------------------------------------

connection.onDocumentHighlight((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const filePath = uriToPath(params.textDocument.uri);
  if (isSourceFile(filePath)) {
    const lines = document.getText().split("\n");
    if (!isDocCommentContext(lines, params.position.line)) {
      return null;
    }
  }

  const line = document.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line, character: Number.MAX_SAFE_INTEGER },
  });
  const id = displayIdAtPosition(line, params.position.character);
  if (!id) return null;
  // deno-lint-ignore no-explicit-any
  return findOccurrencesInFile(document.getText(), id) as any;
});

// ---------------------------------------------------------------------------
// Folding ranges (one foldable region per entry block)
// ---------------------------------------------------------------------------

connection.onFoldingRanges((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const filePath = uriToPath(params.textDocument.uri);
  if (!isMarkspecFile(filePath)) return null;
  const entries = index.getEntriesForFile(filePath);
  const totalLines = document.getText().split("\n").length;
  // deno-lint-ignore no-explicit-any
  return entriesToFoldingRanges(entries, totalLines) as any;
});

// ---------------------------------------------------------------------------
// Semantic tokens
// ---------------------------------------------------------------------------

connection.languages.semanticTokens.on((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return { data: [] };
  const filePath = uriToPath(params.textDocument.uri);
  if (!isMarkspecFile(filePath)) return { data: [] };
  const entries = index.getEntriesForFile(filePath);
  const lines = document.getText().split("\n");
  const tokens = buildSemanticTokens(entries, profile, lines);
  return { data: encodeSemanticTokens(tokens) };
});

// ---------------------------------------------------------------------------
// markspec/entryRanges — custom request driving VS Code decorations
// ---------------------------------------------------------------------------

connection.onRequest(
  "markspec/entryRanges",
  (params: { uri: string }): EntryRangesResponse => {
    const document = documents.get(params.uri);
    if (!document) return { entries: [] };
    const filePath = uriToPath(params.uri);
    if (!isMarkspecFile(filePath)) return { entries: [] };
    const entries = index.getEntriesForFile(filePath);
    // Reuse the cached cross-file validation result that
    // publishAllDiagnostics maintains, so we don't re-run validateAll()
    // on every keystroke (the handler is invoked per-edit by the
    // VS Code DecorationManager).
    const diagnostics = lastDiagnostics;
    const lines = document.getText().split("\n");
    return buildEntryRanges(entries, profile, diagnostics, lines);
  },
);

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

connection.onShutdown(() => {
  debugLog("onShutdown");
  debouncedValidateAll.cancel();
});

connection.onExit(() => {
  debugLog("onExit");
});

// ---------------------------------------------------------------------------
// File walker (Deno-specific — allowed in entry points)
// ---------------------------------------------------------------------------

/** Recursively walk a directory yielding file paths. */
async function* walkDirectory(dir: string): AsyncGenerator<string> {
  const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    ".worktrees",
    "target",
    "dist",
    "build",
    "skills", // upskill SSOT — not MarkSpec requirement documents
  ]);
  try {
    for await (const entry of Deno.readDir(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          yield* walkDirectory(path);
        }
      } else if (entry.isFile) {
        yield path;
      }
    }
  } catch {
    // Skip unreadable directories
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

documents.listen(connection);
connection.listen();
