# LSP Server — Design Specification

**Date**: 2026-04-23 **Scope**: `packages/markspec/lsp/` **References**:
[ADR-005](../../architecture/adr-005-cli-architecture.md), GitHub issues #55–#59

## 1. Overview

This spec defines the MarkSpec LSP server — a standalone binary (`markspec-lsp`)
that provides real-time diagnostics, completions, and context-aware editing
support for MarkSpec documents in any LSP-capable editor.

The server uses an in-process workspace index built from the core library
(`core/mod.ts`) to provide sub-second feedback on every edit. It covers all five
scoped issues:

| Issue | Feature                   | Summary                                                |
| ----- | ------------------------- | ------------------------------------------------------ |
| #55   | LSP module bootstrap      | Server lifecycle, initialize/shutdown, lazy loading    |
| #56   | Block completion          | Scaffold new entry blocks on `- [` trigger             |
| #57   | ID reference completion   | Suggest display IDs after trace attribute keywords     |
| #58   | Diagnostics               | Surface `validate` errors as editor diagnostics        |
| #59   | Doc comment context guard | Only activate in MarkSpec-relevant files and positions |

### Explicitly deferred

| Item                             | Reason                                             |
| -------------------------------- | -------------------------------------------------- |
| Go-to-definition                 | Useful but not in scoped issues; natural follow-up |
| Hover (entry preview)            | Same — follow-up                                   |
| Code actions (quick fixes)       | Requires formatter integration; follow-up          |
| Multi-root workspace             | Single project root is sufficient for v1           |
| Rename support                   | Complex (touches all references); follow-up        |
| `markspec-ide` extension changes | Separate repo, out of scope                        |

## 2. Architecture

### 2.1 Compile target

`lsp/server.ts` is one of three compile targets (per ADR-005):

```bash
deno compile packages/markspec/lsp/server.ts  # → markspec-lsp
```

The `markspec lsp` CLI subcommand dispatches to the `markspec-lsp` binary found
on PATH. The LSP server itself is a standalone process that communicates over
stdin/stdout JSON-RPC.

### 2.2 Module structure

```text
packages/markspec/lsp/
├── server.ts          ← entry point: create connection, register handlers, start
├── workspace.ts       ← WorkspaceIndex: file discovery, parse, incremental update
├── diagnostics.ts     ← diagnostic bridge: core Diagnostic → LSP Diagnostic
├── completions.ts     ← completion providers: block scaffold + ID reference
├── context.ts         ← context guard: is this file/position MarkSpec-relevant?
└── util.ts            ← shared helpers (debounce, URI/path conversion)
```

Six files, each with one responsibility. No barrel `mod.ts` — nothing outside
`lsp/` imports from these modules.

### 2.3 Dependency flow

```text
core/mod.ts ← workspace.ts ← diagnostics.ts
                            ← completions.ts
                            ← context.ts
                            ← server.ts (orchestrates all)

npm:vscode-languageserver              ← server.ts
npm:vscode-languageserver-textdocument ← server.ts, workspace.ts
```

The LSP imports exclusively from `core/mod.ts` — never from internal core paths.
Tree-sitter is used transitively through `parseFile()` / `parseSource()` when
handling source files.

## 3. Server Lifecycle (#55)

### 3.1 Initialize

Client sends `initialize` with `rootUri`. Server:

1. Resolves `rootUri` to a filesystem path.
2. Calls `discoverProjectRoot()` to find the nearest `project.yaml` or
   `.markspec.yaml`.
3. Calls `loadConfig()` to load project configuration.
4. Calls `loadProfileForCommand()` to load the active profile (if any).
5. Returns `InitializeResult` declaring capabilities:
   - `textDocumentSync: TextDocumentSyncKind.Full`
   - `completionProvider: { triggerCharacters: ["[", ":"] }`
   - `diagnosticProvider` not declared (push model via `publishDiagnostics`)

### 3.2 Index build

On `initialized` notification:

1. Glob `**/*.md` and supported source extensions (`.rs`, `.kt`, `.java`, `.c`,
   `.cpp`) under the project root.
2. Read and parse each file with `parseFile()`.
3. Populate the `WorkspaceIndex`.
4. Run initial `validate()` on all entries.
5. Push diagnostics for all files.
6. Send `window/logMessage` to indicate indexing progress and completion.

### 3.3 Steady state

Handle these notifications and requests:

| LSP method                | Handler                                        |
| ------------------------- | ---------------------------------------------- |
| `textDocument/didOpen`    | Parse file, add to index, push diagnostics     |
| `textDocument/didChange`  | Re-parse (debounced), update index, push diags |
| `textDocument/didClose`   | Remove from open document set (keep in index)  |
| `textDocument/didSave`    | Trigger cross-file validation                  |
| `textDocument/completion` | Dispatch to completion providers               |
| `shutdown`                | Clean up resources                             |
| `exit`                    | Process exit                                   |

### 3.4 Shutdown

On `shutdown`: stop debounce timers, clear the index, release tree-sitter
grammars. On `exit`: call `process.exit(0)`.

## 4. WorkspaceIndex

### 4.1 Data model

```typescript
class WorkspaceIndex {
  /** Per-file entry storage for incremental updates. */
  private fileEntries: Map<string, Entry[]>;

  /** Global lookup by display ID. */
  private byDisplayId: Map<DisplayId, Entry>;

  /** Entries grouped by display-ID prefix (e.g., "STK" → [...]) */
  private byPrefix: Map<string, Entry[]>;

  /** Project configuration. */
  private config: ProjectConfig;

  /** Active profile, if loaded. */
  private profile: EffectiveProfile | undefined;
}
```

### 4.2 Operations

| Method                            | Called by           | Purpose                                    |
| --------------------------------- | ------------------- | ------------------------------------------ |
| `buildFromFiles(paths, readFile)` | `initialized`       | Bulk-parse all files, populate all indexes |
| `updateFile(uri, content)`        | `didChange`         | Re-parse one file, swap in new entries     |
| `removeFile(uri)`                 | File deletion       | Remove file's entries from all maps        |
| `getAllEntries()`                 | Cross-file validate | Flat `Entry[]` from all files              |
| `getEntriesForFile(uri)`          | File-local diags    | Entries for one file                       |
| `getEntryByDisplayId(id)`         | Future go-to-def    | Single entry lookup                        |
| `getDisplayIdsByPrefix(prefix)`   | ID completion       | All IDs starting with a prefix             |
| `getAllDisplayIds()`              | Completion list     | Every known display ID + title             |
| `getNextDisplayIdNumber(prefix)`  | Block scaffold      | Max N among all IDs matching the profile's |
|                                   |                     | display-ID pattern for this type, + 1      |

### 4.3 Incremental update flow

```text
didChange
  → debounce 300ms → parseFile(content, {file})
                    → updateFile(uri, newEntries)
                    → rebuildGlobalIndexes()
                    → publishFileDiagnostics(uri)         ← file-local

  → debounce 1000ms → validate(getAllEntries())
                     → publishAllDiagnostics()            ← cross-file
```

Two independent debounce timers. The short timer (300ms) gives immediate
feedback on the file being edited — parse errors, malformed attributes, missing
`Id:`. The long timer (1000ms from last edit) runs full cross-file validation —
broken references, duplicate display IDs.

### 4.4 Profile integration

The index loads the project profile at startup via `loadProfileForCommand()`.
The profile provides:

- **Display-ID patterns** — `getNextDisplayIdNumber()` uses the pattern to
  determine the prefix format and compute the next sequential number.
- **Type definitions** — block scaffold completion offers one item per declared
  entry type.
- **Attribute declarations** — block scaffold includes the correct attribute
  skeleton for each type.
- **Trace rule target constraints** — ID reference completion pre-filters
  suggestions to valid target types for the relation.

If no profile is found, completions degrade gracefully: generic block scaffold
with `Id:` placeholder, all display IDs offered for any trace attribute.

## 5. Diagnostics (#58)

### 5.1 Core → LSP diagnostic bridge

The core `Diagnostic` has `code`, `severity`, `message`, and `location` (file,
line, column — 1-based). The LSP `Diagnostic` needs `range` (0-based start/end
positions), `severity` (numeric enum), `source`, `code`, and `message`.

Bridge logic in `diagnostics.ts`:

- **Line/column**: subtract 1 for 0-based LSP convention.
- **Range end**: use end-of-line (core doesn't track span length). Good enough
  for gutter markers and underline highlights.
- **Severity mapping**: `"error"` → `DiagnosticSeverity.Error` (1), `"warning"`
  → `DiagnosticSeverity.Warning` (2), `"info"` →
  `DiagnosticSeverity.Information` (3).
- **Source**: always `"markspec"`.
- **Code**: pass through the MSL rule code (e.g., `MSL-R003`).

### 5.2 Two diagnostic tiers

**Tier 1 — File-local (fast, ~300ms after edit):**

Re-parse the changed file. Emit diagnostics from:

- Parse-level errors (malformed entry blocks, bad front matter)
- `validateAttributesForEntry()` on each entry in the file

These diagnostics are scoped to the changed file only.

**Tier 2 — Cross-file (slower, ~1000ms after last edit):**

Run `validate()` on `getAllEntries()` from the full index. This catches:

- Duplicate display IDs across files
- Broken cross-references (`Satisfies: NONEXISTENT`)
- Missing `Id:` attributes

Diagnostics are dispatched to the correct file URIs based on each diagnostic's
`location.file`.

### 5.3 Delivery

Push model via `connection.sendDiagnostics({ uri, diagnostics })`. Each file
gets its own diagnostics array. When a file is updated, its diagnostics are
cleared and re-sent. When cross-file validation runs, all affected files are
updated.

When a file is closed (but still in the index), its diagnostics persist — they
are only cleared if the file is deleted or the project is re-indexed.

## 6. Completions (#56, #57)

### 6.1 Entry block scaffold (#56)

**Trigger:** User types `[` and the line matches `^\s*-\s*\[`.

**Behavior:** Offer completion items that expand to a full entry block snippet.

If the profile declares entry types, offer one completion item per type:

```text
Label:    "New STK entry (STK_AEB_0004)"
Detail:   "Stakeholder Requirement"
Kind:     Snippet
Insert:   - [STK_AEB_0004] ${1:Title}\n\n  ${2:Body.}\n\n  Id: \${ULID} \\\n  ${3:Satisfies: }
```

The display-ID number is computed from the index: find the maximum number for
the prefix and increment. The ULID `Id:` is a literal placeholder (`${ULID}`) —
`markspec format` stamps the real value.

If no profile is loaded, offer a single generic item:

```text
Label:    "New entry"
Kind:     Snippet
Insert:   - [${1:PREFIX_NNNN}] ${2:Title}\n\n  ${3:Body.}\n\n  Id: \${ULID}
```

### 6.2 ID reference completion (#57)

**Trigger:** User types `:` and the text before the cursor matches a trace
attribute keyword — `Satisfies`, `Derived-from`, `Verified-by`, `References`,
`Tests`, `Depends-on`, `Part-of`, `Allocated-to`, `Realizes`, `Generated-from`,
`Supersedes`.

**Behavior:** Offer all display IDs from the workspace index:

```text
Label:    "STK_AEB_0001"
Detail:   "Emergency braking activation"
Kind:     Reference
```

**Filtering:** If the profile declares target-type constraints for the relation
(e.g., `Satisfies:` can only target entries of type `stakeholder-requirement`),
pre-filter the completion list to matching types. The LSP's built-in fuzzy
matching further narrows results as the user types.

### 6.3 Completion dispatch

```typescript
function provideCompletions(
  params: CompletionParams,
  index: WorkspaceIndex,
  document: TextDocument,
): CompletionItem[] {
  const line = getLineText(document, params.position);
  const textBefore = line.slice(0, params.position.character);

  if (isBlockScaffoldTrigger(textBefore)) {
    return buildBlockScaffoldItems(index);
  }

  if (isTraceAttributeTrigger(textBefore)) {
    const relation = extractRelationName(textBefore);
    return buildIdReferenceItems(index, relation);
  }

  return [];
}
```

## 7. Context Guard (#59)

### 7.1 File-level guard

A file is MarkSpec-relevant if both conditions hold:

1. The file is inside the discovered project root (has `project.yaml` or
   `.markspec.yaml` in an ancestor directory).
2. The file extension is `.md` or a supported source extension (`.rs`, `.kt`,
   `.java`, `.c`, `.cpp`).

Files outside the project root or with unsupported extensions receive no
diagnostics and no completions.

### 7.2 Position-level guard (source files)

In source files, MarkSpec entries live inside doc comments. Completions should
only activate when the cursor is inside a doc comment context.

**v1 heuristic:** Scan nearby lines for entry markers — a `[TYPE_XXX_NNNN]`
pattern or trace attribute keywords (`Satisfies:`, `Id:`, etc.). If found within
a configurable line radius (default: 20 lines), the position is
MarkSpec-relevant.

This avoids exposing tree-sitter's AST structure through the index. A more
precise approach (checking tree-sitter node type at cursor position) is a
natural follow-up.

### 7.3 Document selector registration

Server capabilities declare document selectors for relevant file types:

```typescript
documentSelector: [
  { language: "markdown", scheme: "file" },
  { language: "rust", scheme: "file" },
  { language: "kotlin", scheme: "file" },
  { language: "java", scheme: "file" },
  { language: "c", scheme: "file" },
  { language: "cpp", scheme: "file" },
];
```

The client sends notifications only for these file types. The server further
filters by project root membership.

## 8. Testing Strategy

### 8.1 Unit tests (colocated)

Each `lsp/*.ts` module gets a colocated `*_test.ts`:

| Test file             | Coverage                                                         |
| --------------------- | ---------------------------------------------------------------- |
| `workspace_test.ts`   | Index build, incremental update, entry lookup, prefix queries,   |
|                       | next-ID computation                                              |
| `diagnostics_test.ts` | Core → LSP diagnostic mapping, severity conversion,              |
|                       | 1-based → 0-based line translation, range construction           |
| `completions_test.ts` | Block scaffold generation, ID reference list, trigger detection, |
|                       | profile-aware filtering, no-profile fallback                     |
| `context_test.ts`     | File-level guard (project root, extension check),                |
|                       | position-level guard (doc comment heuristic)                     |

These are pure unit tests — no LSP connection, no IPC. They test logic functions
directly with mock `WorkspaceIndex` instances and fixture entries.

### 8.2 E2E tests

Blackbox tests in `tests/e2e/` that launch the LSP and speak JSON-RPC:

| Test file                 | Coverage                                                  |
| ------------------------- | --------------------------------------------------------- |
| `lsp_lifecycle_test.ts`   | Initialize → initialized → shutdown → exit                |
| `lsp_diagnostics_test.ts` | Open file with errors → verify `publishDiagnostics` fires |
| `lsp_completions_test.ts` | Trigger completion at `- [` → verify scaffold items;      |
|                           | trigger at `Satisfies:` → verify ID list                  |

E2E tests use `Deno.Command` to spawn `deno run lsp/server.ts` and communicate
via stdin/stdout JSON-RPC. A small LSP test client helper wraps the protocol
handshake (initialize → initialized → test actions → shutdown → exit).

### 8.3 Out of scope for testing

- VS Code extension behavior (`markspec-ide` — separate repo)
- Client-side snippet expansion rendering
- Editor-specific diagnostic presentation
