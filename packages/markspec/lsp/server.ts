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
  type CompletionList,
  createConnection,
  type Diagnostic as LspDiagnosticType,
  DidChangeWatchedFilesNotification,
  type FileEvent,
  type InitializeParams,
  type InitializeResult,
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
  DEFAULT_PROJECT_CONFIG,
  type Diagnostic as CoreDiagnostic,
  discoverMarkspecRoot,
  discoverProjectRoot,
  type EffectiveProfile,
  filterEntriesByTraceTargets,
  format,
  loadConfig,
  loadProfileForCommand,
  type Lockfile,
  makeDisplayId,
  parseDisplayIdPattern,
  parseLockfile,
  type ProjectConfig,
  targetsForRelation,
  validateDisplayIdPattern,
  VERSION,
} from "../core/mod.ts";
import { extendsTransitively } from "../core/profile/discipline_mode.ts";
import { WorkspaceIndex } from "./workspace.ts";
import { buildCodeLenses } from "./code_lens.ts";
import { buildDocumentLinks } from "./document_links.ts";
import { buildFormattingEdits } from "./formatting.ts";
import { groupDiagnosticsByFile, toLspDiagnostic } from "./diagnostics.ts";
import { buildDiagnosticsHistogram } from "./diagnostics_histogram.ts";
import { buildCodeActions } from "./code_actions.ts";
import { entryToLspLocation } from "./definition.ts";
import { displayIdAtPosition, formatHoverContent } from "./hover.ts";
import { entriesToFoldingRanges } from "./folding.ts";
import { findOccurrencesInFile } from "./highlights.ts";
import { buildInlayHints } from "./inlay_hint.ts";
import {
  buildProfileResponse,
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
  type EntryTypeInfo,
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
import { mintReservedNumber, release } from "./id_reservations.ts";
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
import {
  flushSync as flushEventLog,
  logEvent,
  setProjectRoot as setEventLogProjectRoot,
} from "./event_log.ts";
import { snapshot as methodCountsSnapshot, tally } from "./method_counts.ts";
import { time, timeAsync } from "./timing.ts";
import {
  buildDollarNameCompletions,
  dollarNameAtPosition,
  formatTyplHoverContent,
  isDollarNameTrigger,
} from "./typl.ts";
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

let projectRoot: string | undefined;
let _config: ProjectConfig = DEFAULT_PROJECT_CONFIG;
let profile: EffectiveProfile | undefined;
let cachedProfileResponse: MarkspecProfileResponse = EMPTY_PROFILE_RESPONSE;
let lockfile: Lockfile | undefined;
const index = new WorkspaceIndex();
// Cached cross-file validation result. Updated by publishAllDiagnostics
// and read by request handlers (e.g. markspec/entryRanges) so they
// don't re-run validateAll() on every keystroke.
let lastDiagnostics: readonly CoreDiagnostic[] = [];

/**
 * Module-scoped reader for the loaded lockfile. The send-site for
 * `markspec/version` reads the module-scoped `lockfile` directly via
 * `buildVersionNotification`; this accessor is kept as a stable entry
 * point for future LSP handlers (federated-registry pinning, stale-pin
 * hover hint) so they don't need a second init pass.
 */
function _getLockfile(): Lockfile | undefined {
  return lockfile;
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

/**
 * Cap on the number of distinct MSL codes the `kind=diagnostics`
 * histogram surfaces by name. Anything past the cap is summed into a
 * synthetic `other` field — see {@linkcode buildDiagnosticsHistogram}.
 * 20 keeps the event-log line under a couple hundred bytes even when
 * the project fires every catalogue rule.
 */
const DIAGNOSTICS_HISTOGRAM_TOP_N = 20;

/** Run cross-file validation and publish diagnostics for all files. */
function publishAllDiagnostics(): void {
  const entryCount = index.getAllEntries().length;
  const allDiags = time(
    `validateAll/${entryCount}`,
    () => index.validateAll(profile ?? null),
  );
  lastDiagnostics = allDiags;

  // Emit a per-validateAll histogram of MSL codes that fired. Always
  // emitted (zero diagnostics is a valid analytics signal — "the
  // project validated cleanly"); the zero case carries just the
  // entry count.
  const histogram = buildDiagnosticsHistogram(
    allDiags,
    DIAGNOSTICS_HISTOGRAM_TOP_N,
  );
  logEvent("info", "diagnostics", { entries: entryCount, ...histogram });

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
  const mode = profile.disciplineMode.value;
  const types: EntryTypeInfo[] = [];
  for (const [name, typeDef] of profile.types) {
    const pattern = typeDef.value.displayIdPattern.value;
    if (!pattern) continue;

    // ADR-017 Slice 5: mark mode-relevant types as recommended. Shared by
    // both the numbered and named branches below.
    const isRequirementShaped = extendsTransitively(
      name,
      "Requirement",
      profile,
    );
    const hasDiscipline = typeDef.value.discipline.value !== undefined;
    const modeRecommended = (mode === "tiered" && hasDiscipline) ||
      (mode === "flat" && isRequirementShaped && !hasDiscipline) ||
      (mode === "none" && isRequirementShaped);

    // Numbered pattern: parse the `{n:Nd}` placeholder. Width and suffix flow
    // through the snippet so profiles using non-4-digit IDs (`{n:6d}`) or a
    // trailing literal don't produce mis-formatted scaffolds.
    const shape = parseDisplayIdPattern(pattern);
    if (shape) {
      const { prefix, width, suffix } = shape;
      const nextNumber = index.getNextDisplayIdNumber(prefix, suffix);
      types.push({ name, prefix, width, suffix, nextNumber, modeRecommended });
      continue;
    }

    // Named (counter-less) type (ADR-025, #598): not mintable, but still
    // offer a `${1:NAME}` scaffold. The literal anchor is everything before
    // the first placeholder. A malformed pattern is skipped — profile-load
    // (#597) already rejects those via PROFILE-TYPE-008.
    if (!validateDisplayIdPattern(pattern).ok) continue;
    const firstBrace = pattern.indexOf("{");
    const prefix = firstBrace >= 0 ? pattern.slice(0, firstBrace) : pattern;
    types.push({
      name,
      prefix,
      width: 0,
      suffix: "",
      nextNumber: 0,
      named: true,
      modeRecommended,
    });
  }
  return types;
}

/**
 * Lean `(prefix, suffix)` pairs for every profile type with a parseable
 * `display-id-pattern`. Unlike {@linkcode getEntryTypes} this skips the
 * per-type `getNextDisplayIdNumber` scan — {@linkcode releaseObservedReservations}
 * only needs the literal affixes to decompose a display ID, and it runs on
 * every debounced parse.
 */
function getScaffoldPatterns(): Array<{ prefix: string; suffix: string }> {
  if (!profile) return [];
  const out: Array<{ prefix: string; suffix: string }> = [];
  for (const [, typeDef] of profile.types) {
    const pattern = typeDef.value.displayIdPattern.value;
    if (!pattern) continue;
    const shape = parseDisplayIdPattern(pattern);
    if (!shape) continue;
    out.push({ prefix: shape.prefix, suffix: shape.suffix });
  }
  return out;
}

/**
 * Release any display-ID reservation now satisfied by a freshly-parsed
 * file. The resolve handler reserves a number the instant it hands one
 * out; once the inserted entry reaches the index (after the debounced
 * parse) the reservation is redundant and must be dropped so the number
 * is not blocked. Each entry's display ID is decomposed against the
 * active profile's type affixes to recover the `(prefix, suffix, number)`
 * triple. A no-op when no profile is loaded or nothing matches — cheap
 * because reservation buckets are typically empty.
 */
function releaseObservedReservations(filePath: string): void {
  const patterns = getScaffoldPatterns();
  if (patterns.length === 0) return;
  for (const entry of index.getEntriesForFile(filePath)) {
    const id = entry.displayId as string;
    for (const { prefix, suffix } of patterns) {
      if (!id.startsWith(prefix)) continue;
      if (suffix && !id.endsWith(suffix)) continue;
      const numberPart = id.slice(prefix.length, id.length - suffix.length);
      if (!/^\d+$/.test(numberPart)) continue;
      release(prefix, suffix, parseInt(numberPart, 10));
      break; // one pattern matched this entry; move on
    }
  }
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
    const rootUri = params.rootUri ?? params.rootPath;
    if (rootUri) {
      const rootPath = rootUri.startsWith("file://")
        ? uriToPath(rootUri)
        : rootUri;
      projectRoot = await discoverProjectRoot(rootPath, readFile) ?? rootPath;

      // Gate the event log on MarkSpec-project membership (#609). A project
      // is MarkSpec-activated only when a `.markspec.yaml` is discoverable
      // (ADR-008). In a plain Markdown or source repo with no activator the
      // server stays inert on disk — it never creates the `.markspec/`
      // runtime directory or its `lsp.log`, so a non-MarkSpec working tree is
      // never dirtied. In-memory indexing still runs (it writes nothing to
      // disk), and the broad `projectRoot` fallback above keeps config and
      // profile loading working for projects that carry only `project.yaml`.
      const markspecRoot = await discoverMarkspecRoot(rootPath, readFile);
      if (markspecRoot !== undefined) {
        setEventLogProjectRoot(markspecRoot);
      }

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
        cachedProfileResponse = buildProfileResponse(
          profileResult.chain,
          profile,
        );
      } catch {
        connection.console.warn("Failed to load profile");
      }

      // Load markspec.lock if present. Used by future federated-registry
      // pinning + stale-pin hints. The LSP never writes the lockfile;
      // drift detection stays in the CLI.
      try {
        const lockRaw = await readFile(`${projectRoot}/markspec.lock`);
        if (lockRaw !== undefined) {
          const parsed = parseLockfile(lockRaw);
          if (parsed.lockfile) {
            lockfile = parsed.lockfile;
            connection.console.log(
              `Loaded markspec.lock: ${lockfile.upstreams.length} upstreams, locked at ${lockfile.meta.lockedAt}`,
            );
          } else {
            for (const d of parsed.diagnostics) {
              connection.console.warn(
                `Lockfile parse: ${d.code}: ${d.message}`,
              );
            }
          }
        }
      } catch {
        /* no lockfile is fine */
      }
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
// Profile reload — fires `markspec/profileChanged` after watched profile files
// change. Debounced 500ms so rapid-fire saves coalesce into one reload.
// ---------------------------------------------------------------------------

async function reloadProfile(): Promise<void> {
  if (!projectRoot) return;
  try {
    const profileResult = await loadProfileForCommand(projectRoot, readFile);
    profile = profileResult.chain?.effective;
    cachedProfileResponse = buildProfileResponse(
      profileResult.chain,
      profile,
    );
    connection.sendNotification(
      "markspec/profileChanged",
      cachedProfileResponse,
    );
    // Profile changes can flip MSL-R010 suppression and other
    // attribute-validity decisions — republish cross-file diagnostics.
    publishAllDiagnostics();
  } catch (err) {
    connection.console.warn(`Failed to reload profile: ${err}`);
  }
}

const debouncedReloadProfile = debounce(reloadProfile, 500);

// ---------------------------------------------------------------------------
// Initialized — build the workspace index
// ---------------------------------------------------------------------------

connection.onInitialized(async () => {
  logEvent("info", "lifecycle", { event: "onInitialized.start" });
  if (!projectRoot) {
    connection.console.log("No project root found — running without index");
    logEvent("info", "lifecycle", {
      event: "onInitialized.end",
      reason: "no-project-root",
    });
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

    // Parse all files with bounded concurrency. The serial loop spent
    // most of its wall time waiting on file I/O while CPU was idle —
    // overlapping reads + parses cuts cold-start dramatically. Side
    // effect: when duplicate display IDs exist across files, the
    // "first entry wins" tiebreak now resolves to whichever parse
    // finishes first (previously: alphabetical file order). The
    // validator still flags the duplicate in either case; the
    // diagnostic location is the only thing that becomes
    // nondeterministic.
    const parseAllStart = performance.now();
    await timeAsync("onInitialized/parseAll", async () => {
      const CONCURRENCY = 8;
      let cursor = 0;
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          while (cursor < files.length) {
            const filePath = files[cursor++];
            try {
              const content = await readFileRequired(filePath);
              await timeAsync(
                "onInitialized/parseFile",
                () => index.parseAndUpdateFile(filePath, content),
              );
            } catch {
              connection.console.warn(`Failed to parse: ${filePath}`);
            }
          }
        }),
      );
    });
    const parseAllMs = Math.round(performance.now() - parseAllStart);

    connection.console.log(
      `Indexed ${files.length} files, ${index.getAllEntries().length} entries`,
    );
    logEvent("info", "lifecycle", {
      event: "onInitialized.indexed",
      files: files.length,
    });

    // Initial cross-file validation
    publishAllDiagnostics();

    connection.sendNotification("markspec/indexed", {
      files: files.length,
      entries: index.getAllEntries().length,
    });

    logEvent("info", "startup", {
      files: files.length,
      entries: index.getAllEntries().length,
      parseAllMs,
    });

    connection.sendNotification(
      "markspec/version",
      buildVersionNotification(VERSION, CORE_SCHEMA_VERSION, lockfile),
    );

    // Register the profile-file watcher. We do this even when no profile
    // is currently loaded so a later `.markspec.yaml` creation triggers
    // a reload. See design doc §4 step 2.
    if (projectRoot) {
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
            ],
          },
        );
      } catch (err) {
        connection.console.warn(
          `Failed to register profile-file watcher: ${err}`,
        );
      }
    }
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
  // We only watch `.markspec.yaml` + `project.yaml`, so any change here
  // affects the profile chain. Debounce 500ms — see design doc §4.1.
  if (params.changes.length === 0) return;
  debouncedReloadProfile();
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
      // The just-parsed entries now carry any display ID a scaffold accept
      // reserved — drop those reservations so the numbers aren't blocked.
      releaseObservedReservations(filePath);
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
  releaseObservedReservations(filePath);
  publishFileDiagnostics(filePath, parseDiags);
  debouncedValidateAll();
});

// ---------------------------------------------------------------------------
// Completions
// ---------------------------------------------------------------------------

connection.onCompletion((params): CompletionItem[] | CompletionList => {
  tally("completion");
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
        getEntryTypes(),
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
        } satisfies ScaffoldCompletionData,
      }));
    });
  }

  // Trigger 1: Block scaffold
  if (isBlockScaffoldTrigger(line)) {
    return time("onCompletion/scaffold", () => {
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
            ? {
              kind: SCAFFOLD_COMPLETION_KIND,
              typeName: type.name,
              prefix: type.prefix,
              width: type.width,
              suffix: type.suffix,
              named: type.named,
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
      const enclosing = profile
        ? findEnclosingEntry(
          index.getEntriesForFile(filePath),
          params.position.line + 1, // LSP is 0-based; Entry is 1-based.
        )
        : undefined;
      const relationName = profile ? extractRelationName(line) : undefined;
      const targets = profile && relationName
        ? targetsForRelation(profile, enclosing?.type, relationName)
        : undefined;
      let displayIds = profile && targets
        ? filterEntriesByTraceTargets(
          index.getAllEntries(),
          targets,
          profile,
        ).map((e) => ({ displayId: e.displayId, title: e.title }))
        : index.getAllDisplayIds();
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
      const profileTypeNames = profile ? [...profile.types.keys()] : [];
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
      const registry = index.getTypeRegistry();
      const items = buildDollarNameCompletions(registry);
      return items.map((item) => ({
        label: item.label,
        detail: item.detail,
        documentation: item.documentation,
        kind: CompletionItemKind.Variable,
      }));
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
    // Mint and reserve the number atomically. Reserving before the snippet
    // is built means a second resolve firing inside the parse-debounce
    // window — before this entry reaches the index — sees the number as
    // taken and picks the next one, closing the duplicate-ID race.
    const { prefix, suffix } = data;
    const nextNumber = mintReservedNumber(
      prefix,
      suffix,
      (reserved) => index.getNextDisplayIdNumber(prefix, suffix, reserved),
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
    const registry = index.getTypeRegistry();
    const hoverContent = formatTyplHoverContent(dollarName, registry);
    if (hoverContent) {
      return { contents: { kind: "markdown", value: hoverContent } };
    }
  }

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
  tally("definition");
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
  tally("references");
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
  tally("documentSymbol");
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
  tally("workspaceSymbol");
  // The result conforms to LSP `SymbolInformation[]`; cast to satisfy
  // the typed `SymbolKind` enum the d.ts expects.
  // deno-lint-ignore no-explicit-any
  return entriesToWorkspaceSymbols(index.getAllEntries(), params.query) as any;
});

// ---------------------------------------------------------------------------
// Rename (workspace-wide rename of a display ID)
// ---------------------------------------------------------------------------

connection.onPrepareRename((params) => {
  tally("prepareRename");
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
  tally("rename");
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
  if (!isMarkspecFile(filePath)) return [];
  if (!projectRoot) return [];

  const entries = index.getEntriesForFile(filePath);
  const root = projectRoot;
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

connection.onDocumentFormatting((params) => {
  tally("documentFormatting");
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const filePath = uriToPath(params.textDocument.uri);
  // Spec §3.4: non-MarkSpec files MUST return an empty TextEdit[], not null
  // (null would be interpreted as "no opinion" / fall through to other formatters).
  if (!isMarkspecFile(filePath)) return [];

  const currentText = document.getText();
  const result = format(currentText, { file: filePath });

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
  if (!isMarkspecFile(filePath)) return [];
  const entries = index.getEntriesForFile(filePath);
  const allEntries = index.getAllEntries();
  // deno-lint-ignore no-explicit-any
  return buildCodeLenses(entries, allEntries, pathToUri) as any;
});

// ---------------------------------------------------------------------------
// Inlay hints — ": <type>" and "(N dependents)" per entry (spec §5.2)
// ---------------------------------------------------------------------------

connection.languages.inlayHint.on((params) => {
  tally("inlayHint");
  const filePath = uriToPath(params.textDocument.uri);
  if (!isMarkspecFile(filePath)) return [];
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  const entries = index.getEntriesForFile(filePath);
  const allEntries = index.getAllEntries();
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
  tally("semanticTokens");
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
// markspec/profile — custom request: active profile metadata for client coloring
// ---------------------------------------------------------------------------

connection.onRequest(
  "markspec/profile",
  (_params: { uri?: string }): MarkspecProfileResponse => {
    tally("markspecProfile");
    // `_params.uri` is accepted for forward compatibility but ignored in v1;
    // the server uses its rootUri. See design doc §3.1.
    return cachedProfileResponse;
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
  logEvent("info", "lifecycle", { event: "onShutdown" });
  debouncedValidateAll.cancel();
  debouncedReloadProfile.cancel();
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
