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
  CodeLensRefreshRequest,
  type CompletionItem,
  CompletionItemKind,
  type CompletionList,
  createConnection,
  type Diagnostic as LspDiagnosticType,
  DidChangeWatchedFilesNotification,
  type Disposable,
  type FileEvent,
  type InitializeParams,
  type InitializeResult,
  InlayHintRefreshRequest,
  InsertTextFormat,
  ProposedFeatures,
  StreamMessageReader,
  StreamMessageWriter,
  TextDocuments,
  TextDocumentSyncKind,
  type TextEdit as LspTextEdit,
  WatchKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import process from "node:process";
import { isAbsolute, join } from "@std/path";
import { ulid } from "@std/ulid";
import {
  CORE_SCHEMA_VERSION,
  type Diagnostic as CoreDiagnostic,
  filterEntriesByTraceTargets,
  format,
  formatEntryOrigin,
  isLineFenced,
  isWithin,
  loadMarkdownFormatter,
  makeDisplayId,
  targetsForRelation,
  VERSION,
} from "../core/mod.ts";
import { parseUxRef } from "../core/uxil/mod.ts";
import { ProjectContext, type ProjectContextHost } from "./project_context.ts";
import { ProjectRegistry } from "./project_registry.ts";
import { buildCodeLenses } from "./code_lens.ts";
import { buildDocumentLinks } from "./document_links.ts";
import {
  buildF012FallbackMessage,
  buildFormattingEdits,
} from "./formatting.ts";
import { toLspDiagnostic } from "./diagnostics.ts";
import { buildCodeActions } from "./code_actions.ts";
import {
  resolveNavigableLocation,
  sourceLocationToLspLocation,
} from "./definition.ts";
import { displayIdAtPosition, formatHoverContent } from "./hover.ts";
import { entriesToFoldingRanges } from "./folding.ts";
import { findOccurrencesInFile } from "./highlights.ts";
import { buildInlayHints } from "./inlay_hint.ts";
import {
  EMPTY_PROFILE_RESPONSE,
  type MarkspecProfileResponse,
} from "./profile_request.ts";
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
  buildMidTypedScaffoldItems,
  buildTrailerKeyItems,
  buildTypeAttributeItems,
  extractMidTypedPartial,
  extractRelationName,
  extractTracePartial,
  isBlockScaffoldTrigger,
  isMidTypedScaffoldTrigger,
  isTraceAttributeTrigger,
  isTrailerKeyContext,
  isTypeAttributeTrigger,
  renderScaffoldSnippet,
  type ReplacementRange,
  SCAFFOLD_COMPLETION_KIND,
  type ScaffoldCompletionData,
} from "./completions.ts";
import { findEnclosingEntry } from "./find_entry.ts";
import { mintReservedNumber } from "./id_reservations.ts";
import {
  isDocCommentContext,
  isMarkspecFile,
  isSourceFile,
} from "./context.ts";
import { relevantWatchedUris } from "./watched_files.ts";
import {
  createSerialRunner,
  debounce,
  type DebouncedFunction,
  pathToUri,
  uriToPath,
} from "./util.ts";
import {
  flushSync as flushEventLog,
  logEvent,
  setProjectRoot as setEventLogProjectRoot,
} from "./event_log.ts";
import { snapshot as methodCountsSnapshot, tally } from "./method_counts.ts";
import { time } from "./timing.ts";
import {
  buildDollarNameCompletions,
  dollarNameAtPosition,
  formatTyplHoverContent,
  isDollarNameTrigger,
  isRelativeDollarTrigger,
} from "./typl.ts";
import {
  buildUxCompletionItems,
  extractUxRefPartial,
  formatUxHoverContent,
  isUxRefTrigger,
  resolveUxRef,
  uxRefTokenAtPosition,
} from "./uxil.ts";
import { buildVersionNotification } from "./version_notification.ts";

// ---------------------------------------------------------------------------
// Connection and document manager
// ---------------------------------------------------------------------------

const connection = createConnection(
  ProposedFeatures.all,
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);
const documents = new TextDocuments(TextDocument);

logEvent("info", "lifecycle", {
  event: "starting",
  pid: Deno.pid,
  args: JSON.stringify(Deno.args),
});

globalThis.addEventListener("unhandledrejection", (e) => {
  e.preventDefault();
  const reason = (e.reason as Error)?.stack ?? String(e.reason);
  logEvent("error", "uncaught", { type: "rejection", stack: reason });
  try {
    connection.console.error(`unhandled rejection: ${reason}`);
  } catch { /* connection may not be ready */ }
});

globalThis.addEventListener("error", (e) => {
  const stack = e.error?.stack ?? e.message;
  logEvent("error", "uncaught", { type: "error", stack });
  try {
    connection.console.error(`uncaught error: ${stack}`);
  } catch { /* connection may not be ready */ }
});

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

/** Monotonic clock reading captured at module load. Subtracted from the
 * `onShutdown` reading to compute the `durMs` field on the shutdown
 * event — close enough to "session lifetime" for analytics; the wall
 * clock is unsuitable here because it can jump backwards. */
const sessionStartedAt = performance.now();

/** `true` once the event log was pointed at a MarkSpec root. The event
 * log stays single for the whole session, even when several projects are
 * open. */
let eventLogRootSet = false;

/** `true` when the client declared LSP 3.17 `RelativePattern` support
 * for `workspace/didChangeWatchedFiles` registrations. */
let clientSupportsRelativePattern = false;
/** The extra watcher for a primary root that lies above the workspace
 * folder, or `undefined` when none is registered. */
let primaryRootWatcher: Disposable | undefined;
/** Set once the "cannot watch the primary root" warning was logged. */
let primaryRootWatchWarningLogged = false;
/** Runs primary-root watcher (re-)registrations one at a time. A rebuild
 * can request one while the startup registration still waits for the
 * client; without this, both would register and one handle would leak. */
const runWatcherRegistration = createSerialRunner();
/** Set by `onShutdown`, so no watcher registration starts afterwards. */
let serverShuttingDown = false;

/** Connection-facing I/O shared by every {@linkcode ProjectContext}. */
const contextHost: ProjectContextHost = {
  readFile,
  realPath: (p) => Deno.realPath(p),
  readDir: (p) => Deno.readDir(p),
  sendDiagnostics: (uri, diagnostics) =>
    connection.sendDiagnostics({
      uri,
      diagnostics: diagnostics as unknown as LspDiagnosticType[],
    }),
  sendNotification: (method, params) =>
    connection.sendNotification(method, params),
  refreshLenses: () => {
    // Fire-and-forget: an older client that never declared refresh
    // support may reject the request, which must not block diagnostics.
    connection.sendRequest(CodeLensRefreshRequest.type).catch(() => {});
    connection.sendRequest(InlayHintRefreshRequest.type).catch(() => {});
  },
  log: (message) => connection.console.log(message),
  warn: (message) => connection.console.warn(message),
  logEvent,
};

/**
 * One {@linkcode ProjectContext} per MarkSpec project in the workspace
 * (#840, #694). Every per-document handler resolves its context with
 * `projects.contextFor(path)`; see `project_registry.ts` for the
 * ownership rules.
 */
const projects = new ProjectRegistry({
  readFile,
  readDir: (p) => Deno.readDir(p),
  // Indexing parses the live editor buffer, when one is open, instead of
  // the file on disk.
  openText: (path) => documents.get(pathToUri(path))?.getText(),
  createContext: (root) => new ProjectContext(root, contextHost),
  afterRebuild: async () => {
    await pointEventLogAtMarkspecRoot();
    await registerPrimaryRootWatcher();
    await reindexOpenDocuments();
    const primary = projects.primary;
    if (primary) {
      connection.sendNotification(
        "markspec/profileChanged",
        primary.profileChangedParams(),
      );
    }
    connection.sendNotification("markspec/indexed", projects.totals());
  },
  onReloadError: (err) => {
    // Keep the event-log write so reload failures stay visible in
    // .markspec/lsp.log (#799 review).
    logEvent("error", "reload", { err: String(err) });
    connection.console.warn(`Watched-file reload failed: ${err}`);
  },
});

/**
 * Point the event log at the first MarkSpec root (the primary root when
 * it holds a `.markspec.yaml`, else the first nested one). Gates the
 * event log on MarkSpec-project membership (#609): a project is
 * MarkSpec-activated only when a `.markspec.yaml` is discoverable
 * (ADR-008). In a plain Markdown or source repo with no activator the
 * server stays inert on disk — it never creates the `.markspec/` runtime
 * directory or its `lsp.log`, so a non-MarkSpec working tree is never
 * dirtied. A no-op once the log root is set.
 */
async function pointEventLogAtMarkspecRoot(): Promise<void> {
  if (eventLogRootSet) return;
  const [first] = await projects.markspecRoots();
  if (first === undefined) return;
  setEventLogProjectRoot(first);
  eventLogRootSet = true;
}

/**
 * Watch the config files of a primary root that lies ABOVE the workspace
 * folder (#694 layout: workspace `proj/docs`, primary root `proj/`). The
 * plain `**`-prefixed glob watchers only cover files inside the workspace
 * folders, so without this an edit of `proj/.markspec.yaml` or a re-lock
 * of `proj/markspec.lock` would never reach the server. Registers an LSP
 * 3.17 `RelativePattern` watcher based at the primary root; events from it
 * resolve to the primary context through the registry like any other.
 * When the client lacks `RelativePattern` support, logs one warning and
 * does nothing. Replaces any earlier registration, so it is safe to call
 * again after a rebuild; calls are serialized, so each one disposes the
 * handle the previous one stored.
 */
function registerPrimaryRootWatcher(): Promise<void> {
  return runWatcherRegistration(replacePrimaryRootWatcher);
}

/** The body of {@linkcode registerPrimaryRootWatcher}; only ever runs
 * through its serial runner. */
async function replacePrimaryRootWatcher(): Promise<void> {
  if (serverShuttingDown) return;
  primaryRootWatcher?.dispose();
  primaryRootWatcher = undefined;
  const workspaceRoot = projects.workspace;
  const primary = projects.primary;
  if (!workspaceRoot || !primary || isWithin(workspaceRoot, primary.root)) {
    return;
  }
  if (!clientSupportsRelativePattern) {
    if (!primaryRootWatchWarningLogged) {
      primaryRootWatchWarningLogged = true;
      connection.console.warn(
        `Project root ${primary.root} is outside the workspace folder and ` +
          "the client does not support relative watch patterns: changes to " +
          "its .markspec.yaml, project.yaml and markspec.lock are not " +
          "picked up until the server restarts.",
      );
    }
    return;
  }
  try {
    primaryRootWatcher = await connection.client.register(
      DidChangeWatchedFilesNotification.type,
      {
        watchers: [{
          globPattern: {
            baseUri: pathToUri(primary.root),
            pattern: "{.markspec.yaml,project.yaml,markspec.lock}",
          },
          kind: WatchKind.Create | WatchKind.Change | WatchKind.Delete,
        }],
      },
    );
  } catch (err) {
    connection.console.warn(`Failed to register project-root watcher: ${err}`);
  }
}

/**
 * Parse every open document into the context that owns it now. Called
 * after a registry rebuild, which discards the indexes that held the
 * open documents' buffer content.
 */
async function reindexOpenDocuments(): Promise<void> {
  for (const document of documents.all()) {
    const filePath = uriToPath(document.uri);
    if (!isMarkspecFile(filePath)) continue;
    const epoch = bufferEpoch(filePath);
    const ctx = await projects.ensureContextFor(filePath);
    if (!ctx || ctx.isCorpusFile(filePath)) continue;
    const parseDiags = await ctx.index.parseAndUpdateFile(
      filePath,
      document.getText(),
    );
    // The buffer was closed, or the context replaced, during the awaits.
    if (ctx.isDisposed || bufferEpoch(filePath) !== epoch) continue;
    if (!stillOwnedBy(ctx, filePath)) continue;
    publishFileDiagnostics(filePath, parseDiags);
    ctx.scheduleValidateAll();
  }
}

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

// Per-file debounced parse — serializes rapid edits and prevents stale
// index writes from concurrent async parse calls (B2).
const pendingContent = new Map<string, string>();
// deno-lint-ignore no-explicit-any
const debouncedFileParses = new Map<string, DebouncedFunction<any>>();

/**
 * Per-path buffer epoch: incremented on every open and close of the
 * document at that path. A parse captures the epoch before it awaits
 * (the registry gate, the parse itself) and discards its result when the
 * epoch moved — the buffer was closed, or closed and reopened, meanwhile.
 * Without it a parse that started before a close lands in the index
 * after the close removed the file, and a closed buffer comes back.
 */
const bufferEpochs = new Map<string, number>();

/**
 * `true` when `ctx` still owns `filePath` after a parse that awaited. A
 * parse can span an on-demand root discovery (the first parse of a source
 * file waits for its grammar to load); if another project took the file
 * over meanwhile, the stale result is removed from `ctx` instead of being
 * published from the wrong project, and the open buffer is parsed again
 * into its new owner, which may not have seen it on disk.
 */
function stillOwnedBy(ctx: ProjectContext, filePath: string): boolean {
  if (projects.contextFor(filePath) === ctx) return true;
  ctx.index.removeFile(filePath);
  const document = documents.get(pathToUri(filePath));
  if (document) scheduleParse(filePath, document.getText());
  return false;
}

/**
 * Parse `text` for `filePath` after 50 ms of quiet, into the project that
 * owns the file at that time. Shared by the document-change event and the
 * owner-change path above. The latest text wins when several edits arrive
 * before the timer fires.
 */
function scheduleParse(filePath: string, text: string): void {
  pendingContent.set(filePath, text);
  let debouncedParse = debouncedFileParses.get(filePath);
  if (!debouncedParse) {
    debouncedParse = debounce(async () => {
      const content = pendingContent.get(filePath);
      if (content === undefined) return;
      const epoch = bufferEpoch(filePath);
      const ctx = await projects.ensureContextFor(filePath);
      if (!ctx || ctx.isCorpusFile(filePath)) return;
      if (bufferEpoch(filePath) !== epoch) return; // closed meanwhile
      const parseDiags = await ctx.index.parseAndUpdateFile(filePath, content);
      // A rebuild may have replaced this context, or the buffer may have
      // been closed, during the awaits.
      if (ctx.isDisposed || bufferEpoch(filePath) !== epoch) return;
      if (!stillOwnedBy(ctx, filePath)) return;
      // The just-parsed entries now carry any display ID a scaffold accept
      // reserved — drop those reservations so the numbers aren't blocked.
      ctx.releaseObservedReservations(filePath);
      publishFileDiagnostics(filePath, parseDiags);
      ctx.scheduleValidateAll();
    }, 50);
    debouncedFileParses.set(filePath, debouncedParse);
  }
  debouncedParse();
}

function bufferEpoch(filePath: string): number {
  return bufferEpochs.get(filePath) ?? 0;
}

function bumpBufferEpoch(filePath: string): void {
  bufferEpochs.set(filePath, bufferEpoch(filePath) + 1);
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
    logEvent("info", "lifecycle", { event: "onInitialize.start" });
    clientSupportsRelativePattern = params.capabilities.workspace
      ?.didChangeWatchedFiles?.relativePatternSupport === true;
    const rootUri = params.rootUri ?? params.rootPath;
    if (rootUri) {
      const rootPath = rootUri.startsWith("file://")
        ? uriToPath(rootUri)
        : rootUri;
      // Create and load the primary project: the nearest `.markspec.yaml`
      // at or above the workspace root, else the nearest `project.yaml`,
      // else the workspace root itself (#694). Loading reads project.yaml,
      // the .markspec.yaml tool config, the profile, and markspec.lock.
      // Projects nested below the workspace root are discovered in
      // onInitialized (#840).
      await projects.init(rootPath);
      // In-memory indexing runs even without a `.markspec.yaml` (it
      // writes nothing to disk); only the event log is gated.
      await pointEventLogAtMarkspecRoot();
    }

    logEvent("info", "lifecycle", { event: "onInitialize.end" });
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
        documentFormattingProvider: true,
        codeLensProvider: { resolveProvider: false },
        inlayHintProvider: { resolveProvider: false },
        codeActionProvider: { codeActionKinds: ["quickfix"] },
        documentLinkProvider: { resolveProvider: false },
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
// Watched files — `.markspec.yaml`, `project.yaml`, `markspec.lock`.
// A change reloads only the project that owns the changed file (see
// ProjectContext.reloadWatchedFiles: a `markspec.lock`-only change takes
// the cheap upstream-re-seed branch, #771). Creating or deleting a
// `.markspec.yaml` changes file ownership and rebuilds the registry.
// Debounced 500ms so rapid-fire saves coalesce into one reload; the
// registry serializes the reloads.
// ---------------------------------------------------------------------------

const debouncedReloadWatchedFiles = debounce(() => {
  void projects.enqueueWatchedReload();
}, 500);

// ---------------------------------------------------------------------------
// Initialized — build the workspace indexes
// ---------------------------------------------------------------------------

connection.onInitialized(async () => {
  logEvent("info", "lifecycle", { event: "onInitialized.start" });
  const primary = projects.primary;
  if (!primary) {
    connection.console.log("No project root found — running without index");
    logEvent("info", "lifecycle", {
      event: "onInitialized.end",
      reason: "no-project-root",
    });
    return;
  }

  connection.console.log(`Indexing project at ${primary.root}...`);

  try {
    // Discover the projects nested below the primary root, then seed each
    // project's corpora and parse its files. Each project publishes its
    // own cross-file diagnostics.
    const parseAllStart = performance.now();
    await projects.indexAll();
    const parseAllMs = Math.round(performance.now() - parseAllStart);

    // When the primary root has no `.markspec.yaml`, the event log can
    // only be placed once a nested project is known.
    await pointEventLogAtMarkspecRoot();

    const totals = projects.totals();
    connection.console.log(
      `Indexed ${totals.files} files, ${totals.entries} entries in ${projects.all().length} project(s)`,
    );
    logEvent("info", "lifecycle", {
      event: "onInitialized.indexed",
      files: totals.files,
    });

    connection.sendNotification("markspec/indexed", totals);

    logEvent("info", "startup", {
      files: totals.files,
      entries: totals.entries,
      parseAllMs,
    });

    connection.sendNotification(
      "markspec/version",
      buildVersionNotification(
        VERSION,
        CORE_SCHEMA_VERSION,
        projects.primary?.lockfile,
      ),
    );

    // Register the profile-file + lockfile watcher. We do this even when
    // no profile/lockfile is currently loaded so a later
    // `.markspec.yaml`/`markspec.lock` creation triggers a reload. See
    // design doc §4 step 2. `markspec.lock` is watched so a re-lock (new
    // or dropped upstreams) re-seeds the upstream corpus
    // (federated-upstream slice 4).
    try {
      await connection.client.register(
        DidChangeWatchedFilesNotification.type,
        {
          watchers: [
            {
              globPattern: "**/.markspec.yaml",
              kind: WatchKind.Create | WatchKind.Change | WatchKind.Delete,
            },
            {
              globPattern: "**/project.yaml",
              kind: WatchKind.Create | WatchKind.Change | WatchKind.Delete,
            },
            {
              globPattern: "**/markspec.lock",
              kind: WatchKind.Create | WatchKind.Change | WatchKind.Delete,
            },
          ],
        },
      );
    } catch (err) {
      connection.console.warn(
        `Failed to register profile-file watcher: ${err}`,
      );
    }
    await registerPrimaryRootWatcher();
  } catch (err) {
    connection.console.error(`Indexing failed: ${err}`);
    logEvent("error", "lifecycle", {
      event: "onInitialized.failed",
      err: String(err),
    });
  }
  logEvent("info", "lifecycle", { event: "onInitialized.end" });
});

// ---------------------------------------------------------------------------
// onDidChangeWatchedFiles — profile-file edits debounce → reload
// ---------------------------------------------------------------------------

connection.onDidChangeWatchedFiles((params: { changes: FileEvent[] }) => {
  // The dispatcher owns `.markspec.yaml`, `project.yaml`, and
  // `markspec.lock` — but the client can forward broader fileEvents
  // than our dynamic registration (the VS Code extension synchronizes
  // every Markdown file), so filter first: without it every .md save
  // escalated to a full profile reload (#799 review). Debounce 500ms
  // (design doc §4.1).
  const relevant = new Set(
    relevantWatchedUris(params.changes.map((c) => c.uri)),
  );
  const changes = params.changes
    .filter((c) => relevant.has(c.uri))
    .map((c) => ({ uri: c.uri, path: uriToPath(c.uri), type: c.type }));
  if (!projects.noteWatchedChanges(changes)) return;
  debouncedReloadWatchedFiles();
});

// ---------------------------------------------------------------------------
// Document sync
// ---------------------------------------------------------------------------

documents.onDidChangeContent((change) => {
  const filePath = uriToPath(change.document.uri);
  if (!isMarkspecFile(filePath)) return;
  // Corpus files are read-only; their index slot is owned by the
  // project's corpus seeders (ADR-030) — never reparse from a buffer edit.
  if (projects.contextFor(filePath)?.isCorpusFile(filePath)) return;

  // Stash latest content so the debounced parse always uses the most
  // recent snapshot, even if multiple edits arrive before the timer fires.
  scheduleParse(filePath, change.document.getText());
});

documents.onDidSave((event) => {
  // Force cross-file validation on save
  projects.contextFor(uriToPath(event.document.uri))?.validateAllNow();
});

documents.onDidClose((event) => {
  const filePath = uriToPath(event.document.uri);
  if (!isMarkspecFile(filePath)) return;
  const ctx = projects.contextFor(filePath);
  // Corpus files are read-only; their index slot is owned by the
  // project's corpus seeders (ADR-030) — closing the buffer must neither
  // remove the entries nor touch diagnostics (none were published).
  if (ctx?.isCorpusFile(filePath)) return;
  // Record the close first, whether or not a context is known right now
  // (none is while a rebuild runs): any parse of this buffer still in
  // flight discards its result, so the closed buffer never comes back.
  bumpBufferEpoch(filePath);
  pendingContent.delete(filePath);
  debouncedFileParses.get(filePath)?.cancel();
  debouncedFileParses.delete(filePath);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  if (!ctx) return;
  // Remove the file from the index and clear its diagnostics so stale
  // entries don't affect cross-file validation after the buffer closes.
  ctx.index.removeFile(filePath);
  ctx.scheduleValidateAll();
});

documents.onDidOpen(async (event) => {
  const filePath = uriToPath(event.document.uri);
  if (!isMarkspecFile(filePath)) return;
  bumpBufferEpoch(filePath);
  const epoch = bufferEpoch(filePath);
  // A document outside every known project walks up to its own config
  // here; the project is created and indexed first.
  const ctx = await projects.ensureContextFor(filePath);
  if (!ctx) return;
  // Corpus files are read-only; their index slot is owned by the
  // project's corpus seeders (ADR-030) — never reparse from an opened
  // buffer.
  if (ctx.isCorpusFile(filePath)) return;
  if (bufferEpoch(filePath) !== epoch) return; // closed meanwhile
  // Parse the opened buffer even when the file is already indexed from
  // disk: the buffer is the source of truth while it is open, and the
  // index must cover it before the first edit event fires.
  const parseDiags = await ctx.index.parseAndUpdateFile(
    filePath,
    event.document.getText(),
  );
  // A rebuild may have replaced this context, or the buffer may have
  // been closed, during the awaits.
  if (ctx.isDisposed || bufferEpoch(filePath) !== epoch) return;
  if (!stillOwnedBy(ctx, filePath)) return;
  ctx.releaseObservedReservations(filePath);
  publishFileDiagnostics(filePath, parseDiags);
  ctx.scheduleValidateAll();
});
// ---------------------------------------------------------------------------
// Completions
// ---------------------------------------------------------------------------

connection.onCompletion((params): CompletionItem[] | CompletionList => {
  tally("completion");
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const filePath = uriToPath(params.textDocument.uri);
  const ctx = projects.contextFor(filePath);
  if (!ctx) return [];

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

  // Trigger 0: Mid-typed display-ID scaffold — `- [<partial>`. More
  // specific than the bare-bracket block scaffold below, so it is tried
  // first. Each item carries an explicit textEdit replacing exactly the
  // typed partial (VS Code's word-boundary heuristic treats `_` and
  // digits as word chars and would otherwise pick the wrong span).
  if (isMidTypedScaffoldTrigger(line)) {
    return time("onCompletion/midTypedScaffold", () => {
      const partial = extractMidTypedPartial(line);
      const bracketIndex = line.lastIndexOf("[");
      const replacementRange: ReplacementRange = {
        start: { line: params.position.line, character: bracketIndex + 1 },
        end: {
          line: params.position.line,
          character: params.position.character,
        },
      };
      const items = buildMidTypedScaffoldItems(
        ctx.getEntryTypes(),
        partial,
        ulid,
        replacementRange,
      );
      // No matching profile type → return nothing (no profile loaded or
      // the partial matches no declared prefix), matching prior behaviour
      // for a mid-typed bracket.
      return items.map((item) => ({
        label: item.label,
        detail: item.detail,
        insertText: item.textEdit.newText,
        insertTextFormat: InsertTextFormat.Snippet,
        kind: CompletionItemKind.Snippet,
        textEdit: item.textEdit,
        data: {
          kind: SCAFFOLD_COMPLETION_KIND,
          typeName: item.typeName,
          prefix: item.prefix,
          width: item.width,
          suffix: item.suffix,
          named: item.named,
          replacementRange: item.textEdit.range,
          uri: params.textDocument.uri,
        } satisfies ScaffoldCompletionData,
      }));
    });
  }

  // Trigger 1: Block scaffold
  if (isBlockScaffoldTrigger(line)) {
    return time("onCompletion/scaffold", () => {
      const types = ctx.getEntryTypes();
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
            ? {
              kind: SCAFFOLD_COMPLETION_KIND,
              typeName: type.name,
              prefix: type.prefix,
              width: type.width,
              suffix: type.suffix,
              named: type.named,
              uri: params.textDocument.uri,
            } satisfies ScaffoldCompletionData
            : undefined,
        };
      });
    });
  }

  // Trigger 2: Trailer attribute key — indented blank or partial key.
  if (isTrailerKeyContext(line)) {
    return time("onCompletion/trailerKey", () => {
      const items = buildTrailerKeyItems();
      return items.map((item) => ({
        label: item.label,
        detail: item.detail,
        insertText: item.insertText,
        kind: CompletionItemKind.Property,
      }));
    });
  }

  // Trigger 3: ID reference
  if (isTraceAttributeTrigger(line)) {
    return time("onCompletion/idRef", () => {
      // Narrow the suggestion list to entries the profile's trace
      // rule actually allows in this slot (e.g. `Satisfies:` on a
      // software-requirement should only suggest system-requirement
      // IDs). The narrowing fires only when we can resolve: the
      // enclosing entry's type, the relation name, and a TraceRule
      // for that pair. Any missing piece falls back to the full
      // workspace listing — better to over-suggest than to hide.
      const enclosing = ctx.profile
        ? findEnclosingEntry(
          ctx.index.getEntriesForFile(filePath),
          params.position.line + 1, // LSP is 0-based; Entry is 1-based.
        )
        : undefined;
      const relationName = ctx.profile ? extractRelationName(line) : undefined;
      const targets = ctx.profile && relationName
        ? targetsForRelation(ctx.profile, enclosing?.type, relationName)
        : undefined;
      let displayIds = ctx.profile && targets
        ? filterEntriesByTraceTargets(
          ctx.index.getAllEntries(),
          targets,
          ctx.profile,
        ).map((e) => ({
          displayId: e.displayId,
          title: e.title,
          origin: e.origin ? formatEntryOrigin(e.origin) : undefined,
        }))
        : ctx.index.getAllDisplayIds();
      // Server-side prefix filter on the partial the user has typed
      // after the colon. Case-insensitive to match VS Code's
      // client-side filter UX. The CompletionList is marked
      // `isIncomplete` so the client re-queries as the prefix grows
      // — otherwise the client would narrow its cached set further,
      // hiding IDs that match a different prefix path (e.g. after a
      // backspace + retype).
      const partial = extractTracePartial(line);
      if (partial) {
        const needle = partial.toLowerCase();
        displayIds = displayIds.filter((e) =>
          e.displayId.toLowerCase().startsWith(needle)
        );
      }
      const items = buildIdReferenceItems(displayIds).map((item) => ({
        label: item.label,
        detail: item.detail,
        kind: CompletionItemKind.Reference,
      }));
      return { isIncomplete: partial.length > 0, items };
    });
  }

  // Trigger 4: Type: attribute value — core types + profile types.
  if (isTypeAttributeTrigger(line)) {
    return time("onCompletion/typeAttr", () => {
      const profileTypeNames = ctx.profile ? [...ctx.profile.types.keys()] : [];
      const items = buildTypeAttributeItems(profileTypeNames);
      return items.map((item) => ({
        label: item.label,
        detail: item.detail,
        kind: CompletionItemKind.Reference,
      }));
    });
  }

  // Trigger 5: $Name identifier — typl binding names from the corpus registry.
  if (isDollarNameTrigger(line)) {
    return time("onCompletion/dollarName", () => {
      const registry = ctx.index.getTypeRegistry();
      // Published tier (#750): scope relative `$.x` shorthands to the
      // enclosing entry's root namespace, and switch to relative-only
      // suggestions when the partial is `$.`-led.
      const enclosing = findEnclosingEntry(
        ctx.index.getEntriesForFile(filePath),
        params.position.line + 1, // LSP is 0-based; Entry is 1-based.
      );
      const items = buildDollarNameCompletions(registry, {
        rootNamespace: enclosing?.types?.rootNamespace,
        relative: isRelativeDollarTrigger(line),
      });
      return items.map((item) => ({
        label: item.label,
        detail: item.detail,
        documentation: item.documentation,
        kind: CompletionItemKind.Variable,
      }));
    });
  }

  // Trigger 6: ux: reference — known surface paths from the uxil registry
  // (S10 #728). Empty when no profile type designates ux-surface.
  if (isUxRefTrigger(line)) {
    return time("onCompletion/uxRef", () => {
      const uxRegistry = ctx.index.getUxRegistry(ctx.profile ?? null);
      if (!uxRegistry) return [];
      const partial = extractUxRefPartial(line);
      const items = buildUxCompletionItems(uxRegistry, partial);
      // Explicit textEdit spanning the typed partial — without it, the
      // client's default word-boundary heuristic excludes '.' from a
      // "word," so accepting a dotted label like "media.home" after
      // typing past a dot would only replace the text after the last
      // dot (mirrors the mid-typed scaffold's replacementRange fix).
      const replaceRange = {
        start: {
          line: params.position.line,
          character: params.position.character - partial.length,
        },
        end: params.position,
      };
      return {
        isIncomplete: partial.length > 0,
        items: items.map((item) => ({
          label: item.label,
          detail: item.detail,
          kind: CompletionItemKind.Reference,
          textEdit: { range: replaceRange, newText: item.label },
        })),
      };
    });
  }

  return [];
});

connection.onCompletionResolve((item): CompletionItem => {
  tally("completionResolve");
  const data = item.data as ScaffoldCompletionData | undefined;
  if (data?.kind !== SCAFFOLD_COMPLETION_KIND) {
    return item;
  }
  // Defend against tampered or malformed resolve payloads from a hostile or
  // buggy LSP client. The typed cast above does not validate at runtime.
  // These checks apply to both numbered and named scaffolds.
  if (
    typeof data.prefix !== "string" || data.prefix.length > 64 ||
    typeof data.typeName !== "string" || data.typeName.length > 128 ||
    typeof data.suffix !== "string" || data.suffix.length > 64
  ) {
    return item;
  }
  let rendered: { label: string; insertText: string };
  if (data.named === true) {
    // Named (counter-less) type (#598): no number to mint. Re-render the
    // `${1:NAME}` snippet with a fresh ULID; width / suffix are unused.
    rendered = renderScaffoldSnippet({
      typeName: data.typeName,
      prefix: data.prefix,
      width: 0,
      suffix: "",
      nextNumber: 0,
      ulid: ulid(),
      named: true,
    });
  } else {
    if (
      typeof data.width !== "number" || !Number.isInteger(data.width) ||
      data.width < 1 || data.width > 32
    ) {
      return item;
    }
    // Mint from the index of the project that owns the document (#840).
    const ctx = resolveContextForUri(data.uri);
    if (!ctx) return item;
    // Mint and reserve the number atomically. Reserving before the snippet
    // is built means a second resolve firing inside the parse-debounce
    // window — before this entry reaches the index — sees the number as
    // taken and picks the next one, closing the duplicate-ID race.
    const { prefix, suffix } = data;
    const nextNumber = mintReservedNumber(
      prefix,
      suffix,
      (reserved) => ctx.index.getNextDisplayIdNumber(prefix, suffix, reserved),
    );
    rendered = renderScaffoldSnippet({
      typeName: data.typeName,
      prefix: data.prefix,
      width: data.width,
      suffix: data.suffix,
      nextNumber,
      ulid: ulid(),
    });
  }
  // Mid-typed scaffold items carry the replacement range: rebuild the
  // textEdit with the freshly rendered snippet (a stale textEdit.newText
  // would otherwise win over insertText). Range is unchanged — the cursor
  // hasn't moved between completion and resolve. Bare block-scaffold items
  // have no range and keep the plain-insertText path.
  if (isValidReplacementRange(data.replacementRange)) {
    return {
      ...item,
      label: rendered.label,
      textEdit: {
        range: data.replacementRange,
        newText: rendered.insertText,
      },
      insertTextFormat: InsertTextFormat.Snippet,
    };
  }
  return {
    ...item,
    label: rendered.label,
    insertText: rendered.insertText,
    insertTextFormat: InsertTextFormat.Snippet,
  };
});

/**
 * The project that owns the document at `uri`, or the primary project
 * when `uri` is absent or not a valid `file://` URI. The value comes from
 * a client-echoed resolve payload, so it is not trusted to be well formed.
 */
function resolveContextForUri(uri: unknown): ProjectContext | undefined {
  if (typeof uri !== "string") return projects.primary;
  try {
    return projects.contextFor(uriToPath(uri));
  } catch {
    return projects.primary;
  }
}

/** Narrow + validate a resolve-payload replacement range. Defends against
 * tampered or malformed `data` from a hostile or buggy LSP client — the
 * typed cast at the resolve handler's top does not validate at runtime. */
function isValidReplacementRange(
  range: ReplacementRange | undefined,
): range is ReplacementRange {
  if (!range) return false;
  const { start, end } = range;
  return typeof start?.line === "number" &&
    typeof start?.character === "number" &&
    typeof end?.line === "number" &&
    typeof end?.character === "number";
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

connection.onHover((params) => {
  tally("hover");
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const filePath = uriToPath(params.textDocument.uri);
  const ctx = projects.contextFor(filePath);
  if (!ctx) return null;

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

  // Try typl $Name token first — it takes priority over display-ID lookup.
  const dollarName = dollarNameAtPosition(line, params.position.character);
  if (dollarName) {
    const registry = ctx.index.getTypeRegistry();
    // Published tier (#750): give hover the enclosing entry so it can
    // resolve a relative `$.x` against the entry root namespace and mark a
    // published symbol as declared "in this entry" vs. cited from another.
    const enclosing = findEnclosingEntry(
      ctx.index.getEntriesForFile(filePath),
      params.position.line + 1, // LSP is 0-based; Entry is 1-based.
    );
    const hoverContent = formatTyplHoverContent(dollarName, registry, {
      entryDisplayId: enclosing?.displayId,
      rootNamespace: enclosing?.types?.rootNamespace,
    });
    if (hoverContent) {
      return { contents: { kind: "markdown", value: hoverContent } };
    }
  }

  // Try a ux: ref next (S10 #728) — inert (no registry) unless the
  // profile designates a declaring type (uxilDeclaringTypes).
  const uxToken = uxRefTokenAtPosition(line, params.position.character);
  if (uxToken) {
    const uxRegistry = ctx.index.getUxRegistry(ctx.profile ?? null);
    if (uxRegistry) {
      const { ref } = parseUxRef(uxToken);
      if (ref) {
        const hoverContent = formatUxHoverContent(ref, uxRegistry);
        if (hoverContent) {
          return { contents: { kind: "markdown", value: hoverContent } };
        }
      }
    }
  }

  const id = displayIdAtPosition(line, params.position.character);
  if (!id) return null;
  const entry = ctx.index.getEntryByDisplayId(makeDisplayId(id));
  if (!entry) return null;

  return {
    contents: { kind: "markdown", value: formatHoverContent(entry) },
  };
});

// ---------------------------------------------------------------------------
// Definition (go to entry source)
// ---------------------------------------------------------------------------

connection.onDefinition((params) => {
  tally("definition");
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const filePath = uriToPath(params.textDocument.uri);
  const ctx = projects.contextFor(filePath);
  if (!ctx) return null;

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

  // Try a ux: ref first (S10 #728) — its token grammar (colon-bearing)
  // never overlaps a display-ID token's.
  const uxToken = uxRefTokenAtPosition(line, params.position.character);
  if (uxToken) {
    const uxRegistry = ctx.index.getUxRegistry(ctx.profile ?? null);
    if (uxRegistry) {
      const { ref } = parseUxRef(uxToken);
      const surface = ref ? resolveUxRef(ref, uxRegistry) : undefined;
      if (surface) {
        return sourceLocationToLspLocation(surface.location);
      }
    }
  }

  const id = displayIdAtPosition(line, params.position.character);
  if (!id) return null;
  const entry = ctx.index.getEntryByDisplayId(makeDisplayId(id));
  if (!entry) return null;

  return resolveNavigableLocation(entry);
});

// ---------------------------------------------------------------------------
// References (find all references to an entry)
// ---------------------------------------------------------------------------

connection.onReferences((params) => {
  tally("references");
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const filePath = uriToPath(params.textDocument.uri);
  const ctx = projects.contextFor(filePath);
  if (!ctx) return null;
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

  const referencing = findReferencingEntries(ctx.index.getAllEntries(), id);
  const locations = referencing
    .map(resolveNavigableLocation)
    .filter((loc): loc is NonNullable<typeof loc> => loc !== null);

  // includeDeclaration: prepend the declaration's location when asked.
  if (params.context?.includeDeclaration) {
    const decl = ctx.index.getEntryByDisplayId(makeDisplayId(id));
    if (decl) {
      const declLoc = resolveNavigableLocation(decl);
      if (declLoc) locations.unshift(declLoc);
    }
  }

  return locations;
});

// ---------------------------------------------------------------------------
// Document symbols (outline view)
// ---------------------------------------------------------------------------

connection.onDocumentSymbol((params) => {
  tally("documentSymbol");
  const filePath = uriToPath(params.textDocument.uri);
  const ctx = projects.contextFor(filePath);
  if (!ctx) return null;
  if (!isMarkspecFile(filePath)) return null;
  const entries = ctx.index.getEntriesForFile(filePath);
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
  tally("workspaceSymbol");
  // The result conforms to LSP `SymbolInformation[]`; cast to satisfy
  // the typed `SymbolKind` enum the d.ts expects.
  // Union every project's entries: the search spans the whole workspace.
  const allEntries = projects.all().flatMap((ctx) => ctx.index.getAllEntries());
  // deno-lint-ignore no-explicit-any
  return entriesToWorkspaceSymbols(allEntries, params.query) as any;
});

// ---------------------------------------------------------------------------
// Rename (rename of a display ID across the project that owns the document)
// ---------------------------------------------------------------------------

connection.onPrepareRename((params) => {
  tally("prepareRename");
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const filePath = uriToPath(params.textDocument.uri);
  const ctx = projects.contextFor(filePath);
  if (!ctx) return null;
  if (isSourceFile(filePath)) {
    const lines = document.getText().split("\n");
    if (!isDocCommentContext(lines, params.position.line)) {
      return null;
    }
  }
  // A token inside a fenced illustrative example is not a live reference
  // (#680) — findIdOccurrencesInFile would exclude it from the rename's
  // edits anyway, so reject the rename here rather than opening an input
  // box for a token that silently won't change.
  if (isLineFenced(document.getText(), params.position.line)) return null;

  const line = document.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line, character: Number.MAX_SAFE_INTEGER },
  });
  const id = displayIdAtPosition(line, params.position.character);
  if (id) {
    const targetEntry = ctx.index.getEntryByDisplayId(makeDisplayId(id));
    if (targetEntry?.origin) return null; // delivered corpus is read-only (ADR-030)
  }
  return prepareRenameRange(
    line,
    params.position.character,
    params.position.line,
  );
});

connection.onRenameRequest(async (params) => {
  tally("rename");
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const filePath = uriToPath(params.textDocument.uri);
  const ctx = projects.contextFor(filePath);
  if (!ctx) return null;
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
  const targetEntry = ctx.index.getEntryByDisplayId(makeDisplayId(oldId));
  if (targetEntry?.origin) return null; // delivered corpus is read-only (ADR-030)
  const newId = params.newName;
  if (!newId || newId === oldId) return null;

  // Build per-file TextEdits across the project that owns the document.
  // Display IDs are scoped to one project, so other projects in the same
  // workspace are left untouched (#840). For each tracked file, prefer
  // the open-document text (live editor state) and fall back to reading
  // from disk.
  const changes: Record<string, LspTextEdit[]> = {};
  for (const path of ctx.index.getFilePaths()) {
    // Delivered corpus files are read-only (ADR-030) — a project-ID rename
    // must never emit WorkspaceEdits against the profile cache.
    if (ctx.isCorpusFile(path)) continue;
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
  tally("codeAction");
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
// Document links — clickable `Verified-by:` file-path values (§5.3)
// ---------------------------------------------------------------------------

connection.onDocumentLinks((params) => {
  tally("documentLink");
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  const filePath = uriToPath(params.textDocument.uri);
  const ctx = projects.contextFor(filePath);
  if (!ctx) return [];
  if (!isMarkspecFile(filePath)) return [];

  const entries = ctx.index.getEntriesForFile(filePath);
  const root = ctx.root;
  const resolveTarget = (
    relPath: string,
    lineSuffix: number | undefined,
  ): string | undefined => {
    const absPath = isAbsolute(relPath) ? relPath : join(root, relPath);
    const baseUri = pathToUri(absPath);
    return lineSuffix === undefined ? baseUri : `${baseUri}#L${lineSuffix}`;
  };

  // deno-lint-ignore no-explicit-any
  return buildDocumentLinks(entries, document.getText(), resolveTarget) as any;
});

// ---------------------------------------------------------------------------
// Document formatting (wraps core/formatter — same code path as `markspec format`)
// ---------------------------------------------------------------------------

connection.onDocumentFormatting(async (params) => {
  tally("documentFormatting");
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const filePath = uriToPath(params.textDocument.uri);
  const ctx = projects.contextFor(filePath);
  if (!ctx) return [];
  // Spec §3.4: non-MarkSpec files MUST return an empty TextEdit[], not null
  // (null would be interpreted as "no opinion" / fall through to other formatters).
  // Checked before loadMarkdownFormatter() so the WASM prose formatter is
  // never loaded for files the server won't format.
  if (!isMarkspecFile(filePath)) return [];
  // Delivered corpus files are read-only (ADR-030) — never format them.
  if (ctx.isCorpusFile(filePath)) return [];

  // Source files are read-only for formatting (ADR-029: Markdown files
  // only) — doc-comment layout belongs to the host language's formatter.
  // Returning [] preserves the pre-ADR-029 no-op and the spec §3.4
  // "empty TextEdit[], not null" contract.
  if (isSourceFile(filePath)) return [];

  const currentText = document.getText();
  // If the WASM plugin can't load, degrade to entry-only formatting (ULID
  // stamping, trailer normalization still apply) rather than failing the
  // format request — format-on-save keeps working. The loader un-caches a
  // failed load, so a later request retries.
  let formatMarkdownProse;
  try {
    formatMarkdownProse = await loadMarkdownFormatter();
  } catch (err) {
    connection.console.error(
      `Markdown formatter unavailable — formatting entry blocks only: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    formatMarkdownProse = undefined;
  }
  const result = format(currentText, { file: filePath, formatMarkdownProse });

  // Surface Markdown-pass fallbacks (MSL-F012, info): a body or prose
  // segment whose dprint output was rejected/errored and kept as-is. The
  // CLI prints these to stderr; in the editor they would otherwise vanish
  // (format-time diagnostics don't flow through publishDiagnostics). One
  // logMessage summary keeps the editor's output channel informed without
  // a toast per save.
  const fallbackNotice = buildF012FallbackMessage(result.diagnostics);
  if (fallbackNotice) connection.console.info(fallbackNotice);

  // On parse failure the formatter returns `output === input` and emits
  // diagnostics via its existing channel — clients see them through the
  // ordinary publishDiagnostics flow. Returning `null` here would be wrong
  // (the client would interpret it as "server has no opinion"); returning
  // an empty TextEdit[] is the spec-conforming "no edits to apply" reply.
  // deno-lint-ignore no-explicit-any
  return buildFormattingEdits(currentText, result.output) as any;
});

// ---------------------------------------------------------------------------
// Code lenses — "↑ N dependents" and "↓ Satisfies: ID — Title" per entry
// ---------------------------------------------------------------------------

connection.onCodeLens((params) => {
  tally("codeLens");
  const filePath = uriToPath(params.textDocument.uri);
  const ctx = projects.contextFor(filePath);
  if (!ctx) return [];
  if (!isMarkspecFile(filePath)) return [];
  const entries = ctx.index.getEntriesForFile(filePath);
  const allEntries = ctx.index.getAllEntries();
  // deno-lint-ignore no-explicit-any
  return buildCodeLenses(entries, allEntries, pathToUri) as any;
});

// ---------------------------------------------------------------------------
// Inlay hints — ": <type>" and "(N dependents)" per entry (spec §5.2)
// ---------------------------------------------------------------------------

connection.languages.inlayHint.on((params) => {
  tally("inlayHint");
  const filePath = uriToPath(params.textDocument.uri);
  const ctx = projects.contextFor(filePath);
  if (!ctx) return [];
  if (!isMarkspecFile(filePath)) return [];
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  const entries = ctx.index.getEntriesForFile(filePath);
  const allEntries = ctx.index.getAllEntries();
  const lines = document.getText().split("\n");
  const lineLength = (line: number): number => lines[line - 1]?.length ?? 0;
  // deno-lint-ignore no-explicit-any
  return buildInlayHints(entries, allEntries, lineLength) as any;
});

// ---------------------------------------------------------------------------
// Document highlights (mark every occurrence in the current file)
// ---------------------------------------------------------------------------

connection.onDocumentHighlight((params) => {
  tally("documentHighlight");
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const filePath = uriToPath(params.textDocument.uri);
  if (isSourceFile(filePath)) {
    const lines = document.getText().split("\n");
    if (!isDocCommentContext(lines, params.position.line)) {
      return null;
    }
  }
  // A token inside a fenced illustrative example is not a live reference
  // (#680) — findOccurrencesInFile would exclude it from the results
  // anyway, which would otherwise light up unrelated real occurrences
  // elsewhere while leaving the cursor's own token dark.
  if (isLineFenced(document.getText(), params.position.line)) return null;

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
  tally("foldingRanges");
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const filePath = uriToPath(params.textDocument.uri);
  const ctx = projects.contextFor(filePath);
  if (!ctx) return null;
  if (!isMarkspecFile(filePath)) return null;
  const entries = ctx.index.getEntriesForFile(filePath);
  const totalLines = document.getText().split("\n").length;
  // deno-lint-ignore no-explicit-any
  return entriesToFoldingRanges(entries, totalLines) as any;
});

// ---------------------------------------------------------------------------
// Semantic tokens
// ---------------------------------------------------------------------------

connection.languages.semanticTokens.on((params) => {
  tally("semanticTokens");
  const document = documents.get(params.textDocument.uri);
  if (!document) return { data: [] };
  const filePath = uriToPath(params.textDocument.uri);
  const ctx = projects.contextFor(filePath);
  if (!ctx) return { data: [] };
  if (!isMarkspecFile(filePath)) return { data: [] };
  const entries = ctx.index.getEntriesForFile(filePath);
  const lines = document.getText().split("\n");
  const tokens = buildSemanticTokens(entries, ctx.profile, lines);
  return { data: encodeSemanticTokens(tokens) };
});

// ---------------------------------------------------------------------------
// markspec/profile — custom request: active profile metadata for client coloring
// ---------------------------------------------------------------------------

connection.onRequest(
  "markspec/profile",
  (params: { uri?: string } | null): MarkspecProfileResponse => {
    tally("markspecProfile");
    // Answer for the project that owns `params.uri`; without a URI, answer
    // for the primary project (#840). See design doc §3.1.
    const ctx = resolveContextForUri(params?.uri);
    return ctx?.profileResponse ?? EMPTY_PROFILE_RESPONSE;
  },
);

// ---------------------------------------------------------------------------
// markspec/entryRanges — custom request driving VS Code decorations
// ---------------------------------------------------------------------------

connection.onRequest(
  "markspec/entryRanges",
  (params: { uri: string }): EntryRangesResponse => {
    tally("markspecEntryRanges");
    const document = documents.get(params.uri);
    if (!document) return { entries: [] };
    const filePath = uriToPath(params.uri);
    const ctx = projects.contextFor(filePath);
    if (!ctx) return { entries: [] };
    if (!isMarkspecFile(filePath)) return { entries: [] };
    const entries = ctx.index.getEntriesForFile(filePath);
    // Reuse the cached cross-file validation result that
    // ProjectContext.publishAllDiagnostics maintains, so we don't re-run validateAll()
    // on every keystroke (the handler is invoked per-edit by the
    // VS Code DecorationManager).
    const diagnostics = ctx.lastDiagnostics;
    const lines = document.getText().split("\n");
    return buildEntryRanges(entries, ctx.profile, diagnostics, lines);
  },
);

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

connection.onShutdown(() => {
  logEvent("info", "lifecycle", { event: "onShutdown" });
  serverShuttingDown = true;
  projects.shutdown();
  debouncedReloadWatchedFiles.cancel();
  // Roll up per-method counters + session duration into one final
  // `kind=shutdown` event. Emitted from `onShutdown` (orderly exit)
  // rather than `onExit` (hard close) so the summary still lands in
  // the log when the client skips the exit notification.
  const durMs = Math.round(performance.now() - sessionStartedAt);
  const fields: Record<string, number> = { durMs };
  for (const [method, n] of methodCountsSnapshot()) {
    fields[`requests.${method}`] = n;
  }
  logEvent("info", "shutdown", fields);
  flushEventLog();
});

connection.onExit(() => {
  logEvent("info", "lifecycle", { event: "onExit" });
  flushEventLog();
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

documents.listen(connection);
connection.listen();
