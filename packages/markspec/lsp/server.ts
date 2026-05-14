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
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import process from "node:process";
import {
  DEFAULT_PROJECT_CONFIG,
  type Diagnostic as CoreDiagnostic,
  discoverProjectRoot,
  type EffectiveProfile,
  loadConfig,
  loadProfileForCommand,
  type ProjectConfig,
} from "../core/mod.ts";
import { WorkspaceIndex } from "./workspace.ts";
import { groupDiagnosticsByFile, toLspDiagnostic } from "./diagnostics.ts";
import { displayIdAtPosition, formatHoverContent } from "./hover.ts";
import {
  buildBlockScaffoldItems,
  buildIdReferenceItems,
  buildTypeAttributeItems,
  type EntryTypeInfo,
  isBlockScaffoldTrigger,
  isTraceAttributeTrigger,
  isTypeAttributeTrigger,
} from "./completions.ts";
import {
  isDocCommentContext,
  isMarkspecFile,
  isSourceFile,
} from "./context.ts";
import { debounce, pathToUri, uriToPath } from "./util.ts";
import { debugLog } from "./debug_log.ts";

export const VERSION = "0.4.0";

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
  const allDiags = index.validateAll();
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
        },
        hoverProvider: true,
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
  } catch (err) {
    connection.console.error(`Indexing failed: ${err}`);
    debugLog(`onInitialized: indexing failed: ${err}`);
  }
  debugLog("onInitialized: end");
});

// ---------------------------------------------------------------------------
// Document sync
// ---------------------------------------------------------------------------

documents.onDidChangeContent(async (change) => {
  const filePath = uriToPath(change.document.uri);
  if (!isMarkspecFile(filePath)) return;

  // Re-parse the changed file
  const parseDiags = await index.parseAndUpdateFile(
    filePath,
    change.document.getText(),
  );

  // Publish file-local diagnostics immediately
  publishFileDiagnostics(filePath, parseDiags);

  // Schedule cross-file validation
  debouncedValidateAll();
});

documents.onDidSave(() => {
  // Force cross-file validation on save
  debouncedValidateAll.cancel();
  publishAllDiagnostics();
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
    const items = buildBlockScaffoldItems(types);
    return items.map((item) => ({
      label: item.label,
      detail: item.detail,
      insertText: item.insertText,
      insertTextFormat: item.isSnippet
        ? InsertTextFormat.Snippet
        : InsertTextFormat.PlainText,
      kind: item.isSnippet
        ? CompletionItemKind.Snippet
        : CompletionItemKind.Reference,
    }));
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
  const entry = index.getEntryByDisplayId(id);
  if (!entry) return null;

  return {
    contents: { kind: "markdown", value: formatHoverContent(entry) },
  };
});

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
  ]);
  try {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
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
