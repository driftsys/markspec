# LSP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a fully functional MarkSpec LSP server providing real-time
diagnostics, entry block completions, ID reference completions, and doc comment
context guard — covering GitHub issues #55–#59.

**Architecture:** In-process workspace index built from core library functions.
The LSP parses all project files at startup, maintains an incremental per-file
index, and uses two debounce tiers (300ms file-local, 1000ms cross-file) for
diagnostics. Completions query the index directly.

**Tech Stack:** `npm:vscode-languageserver/node`,
`npm:vscode-languageserver-textdocument`, `@driftsys/markspec/core` (via
`core/mod.ts`), Deno/TypeScript.

**Spec:**
[`docs/superpowers/specs/2026-04-23-lsp-server-design.md`](../specs/2026-04-23-lsp-server-design.md)

**Worktree:** `/Users/sebastientasson/Workspace/driftsys/markspec-lsp` (branch
`feat/lsp-server`)

---

## File Map

| File                                        | Responsibility                                        |
| ------------------------------------------- | ----------------------------------------------------- |
| `packages/markspec/lsp/server.ts`           | Entry point: create LSP connection, register handlers |
| `packages/markspec/lsp/workspace.ts`        | WorkspaceIndex: file discovery, parsing, incremental  |
| `packages/markspec/lsp/diagnostics.ts`      | Core `Diagnostic` → LSP `Diagnostic` bridge           |
| `packages/markspec/lsp/completions.ts`      | Block scaffold + ID reference completion providers    |
| `packages/markspec/lsp/context.ts`          | File-level + position-level MarkSpec context guards   |
| `packages/markspec/lsp/util.ts`             | Debounce, URI↔path conversion helpers                 |
| `packages/markspec/lsp/util_test.ts`        | Unit tests for util                                   |
| `packages/markspec/lsp/diagnostics_test.ts` | Unit tests for diagnostic bridge                      |
| `packages/markspec/lsp/context_test.ts`     | Unit tests for context guards                         |
| `packages/markspec/lsp/workspace_test.ts`   | Unit tests for WorkspaceIndex                         |
| `packages/markspec/lsp/completions_test.ts` | Unit tests for completions                            |
| `packages/markspec/deno.json`               | Add `vscode-languageserver` dependencies              |
| `tests/e2e/lsp_helpers.ts`                  | LSP JSON-RPC test client helper                       |
| `tests/e2e/lsp_lifecycle_test.ts`           | E2E: initialize → shutdown → exit                     |
| `tests/e2e/lsp_diagnostics_test.ts`         | E2E: open file → receive publishDiagnostics           |
| `tests/e2e/lsp_completions_test.ts`         | E2E: trigger completion → receive items               |

---

## Task 1: Add dependencies and create util module

**Files:**

- Modify: `packages/markspec/deno.json` (add LSP deps)
- Create: `packages/markspec/lsp/util.ts`
- Create: `packages/markspec/lsp/util_test.ts`

- [ ] **Step 1: Add vscode-languageserver dependencies to package deno.json**

In `packages/markspec/deno.json`, add two imports:

```json
{
  "imports": {
    "vscode-languageserver/node": "npm:vscode-languageserver@^10/node",
    "vscode-languageserver-textdocument": "npm:vscode-languageserver-textdocument@^1"
  }
}
```

These are additive — keep all existing imports.

- [ ] **Step 2: Write failing tests for util functions**

Create `packages/markspec/lsp/util_test.ts`:

```typescript
/**
 * @module lsp/util_test
 *
 * Unit tests for LSP utility functions.
 */

import { assertEquals } from "@std/assert";
import { debounce, pathToUri, uriToPath } from "./util.ts";

Deno.test("uriToPath: converts file URI to path", () => {
  assertEquals(
    uriToPath("file:///Users/dev/project/foo.md"),
    "/Users/dev/project/foo.md",
  );
});

Deno.test("uriToPath: decodes percent-encoded characters", () => {
  assertEquals(
    uriToPath("file:///Users/dev/my%20project/foo.md"),
    "/Users/dev/my project/foo.md",
  );
});

Deno.test("pathToUri: converts path to file URI", () => {
  assertEquals(
    pathToUri("/Users/dev/project/foo.md"),
    "file:///Users/dev/project/foo.md",
  );
});

Deno.test("pathToUri: encodes spaces", () => {
  assertEquals(
    pathToUri("/Users/dev/my project/foo.md"),
    "file:///Users/dev/my%20project/foo.md",
  );
});

Deno.test("debounce: calls function after delay", async () => {
  let callCount = 0;
  const fn = debounce(() => {
    callCount++;
  }, 50);
  fn();
  fn();
  fn();
  assertEquals(callCount, 0);
  await new Promise((r) => setTimeout(r, 100));
  assertEquals(callCount, 1);
});

Deno.test("debounce: cancel prevents execution", async () => {
  let callCount = 0;
  const fn = debounce(() => {
    callCount++;
  }, 50);
  fn();
  fn.cancel();
  await new Promise((r) => setTimeout(r, 100));
  assertEquals(callCount, 0);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `deno test --allow-read packages/markspec/lsp/util_test.ts`

Expected: FAIL — module `./util.ts` not found or exports not found.

- [ ] **Step 4: Implement util.ts**

Create `packages/markspec/lsp/util.ts`:

```typescript
/**
 * @module lsp/util
 *
 * Shared utilities for the LSP server: URI/path conversion and debounce.
 */

/**
 * Convert a `file://` URI to a filesystem path.
 * Strips the `file://` scheme and decodes percent-encoding.
 */
export function uriToPath(uri: string): string {
  const url = new URL(uri);
  return decodeURIComponent(url.pathname);
}

/**
 * Convert a filesystem path to a `file://` URI.
 * Encodes special characters for URI safety.
 */
export function pathToUri(path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `file://${encoded}`;
}

/** A debounced function with a `cancel()` method. */
export interface DebouncedFunction<T extends (...args: never[]) => void> {
  (...args: Parameters<T>): void;
  cancel(): void;
}

/**
 * Create a debounced version of a function.
 * The function is called after `delayMs` milliseconds of inactivity.
 */
export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  delayMs: number,
): DebouncedFunction<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = ((...args: Parameters<T>) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, delayMs);
  }) as DebouncedFunction<T>;
  debounced.cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return debounced;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test --allow-read packages/markspec/lsp/util_test.ts`

Expected: 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/deno.json packages/markspec/lsp/util.ts packages/markspec/lsp/util_test.ts
git commit -m "feat(lsp): add LSP dependencies and utility module

Add vscode-languageserver and vscode-languageserver-textdocument deps.
Implement URI/path conversion and debounce helpers with tests."
```

---

## Task 2: Diagnostic bridge

**Files:**

- Create: `packages/markspec/lsp/diagnostics.ts`
- Create: `packages/markspec/lsp/diagnostics_test.ts`

- [ ] **Step 1: Write failing tests for diagnostic bridge**

Create `packages/markspec/lsp/diagnostics_test.ts`:

```typescript
/**
 * @module lsp/diagnostics_test
 *
 * Unit tests for the core Diagnostic → LSP Diagnostic bridge.
 */

import { assertEquals } from "@std/assert";
import {
  groupDiagnosticsByFile,
  toLspDiagnostic,
  toLspSeverity,
} from "./diagnostics.ts";
import type { Diagnostic as CoreDiagnostic } from "../core/mod.ts";

Deno.test("toLspSeverity: maps error to 1", () => {
  assertEquals(toLspSeverity("error"), 1);
});

Deno.test("toLspSeverity: maps warning to 2", () => {
  assertEquals(toLspSeverity("warning"), 2);
});

Deno.test("toLspSeverity: maps info to 3", () => {
  assertEquals(toLspSeverity("info"), 3);
});

Deno.test("toLspDiagnostic: converts core diagnostic to LSP diagnostic", () => {
  const core: CoreDiagnostic = {
    code: "MSL-R003",
    severity: "error",
    message: "STK_001: missing Id: attribute",
    location: { file: "reqs.md", line: 10, column: 3 },
  };
  const lsp = toLspDiagnostic(core);
  assertEquals(lsp.range.start.line, 9); // 0-based
  assertEquals(lsp.range.start.character, 2); // 0-based
  assertEquals(lsp.range.end.line, 9);
  assertEquals(lsp.severity, 1); // Error
  assertEquals(lsp.source, "markspec");
  assertEquals(lsp.code, "MSL-R003");
  assertEquals(lsp.message, "STK_001: missing Id: attribute");
});

Deno.test("toLspDiagnostic: handles undefined location", () => {
  const core: CoreDiagnostic = {
    code: "MSL-E000",
    severity: "error",
    message: "failed to read file",
    location: undefined,
  };
  const lsp = toLspDiagnostic(core);
  assertEquals(lsp.range.start.line, 0);
  assertEquals(lsp.range.start.character, 0);
});

Deno.test("groupDiagnosticsByFile: groups diagnostics by file path", () => {
  const diagnostics: CoreDiagnostic[] = [
    {
      code: "MSL-R003",
      severity: "error",
      message: "a",
      location: { file: "a.md", line: 1, column: 1 },
    },
    {
      code: "MSL-R006",
      severity: "error",
      message: "b",
      location: { file: "b.md", line: 2, column: 1 },
    },
    {
      code: "MSL-R010",
      severity: "warning",
      message: "c",
      location: { file: "a.md", line: 5, column: 1 },
    },
    { code: "MSL-E000", severity: "error", message: "d", location: undefined },
  ];
  const grouped = groupDiagnosticsByFile(diagnostics);
  assertEquals(grouped.get("a.md")?.length, 2);
  assertEquals(grouped.get("b.md")?.length, 1);
  // Diagnostics with undefined location are not grouped
  assertEquals(grouped.size, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-read packages/markspec/lsp/diagnostics_test.ts`

Expected: FAIL — module `./diagnostics.ts` not found.

- [ ] **Step 3: Implement diagnostics.ts**

Create `packages/markspec/lsp/diagnostics.ts`:

```typescript
/**
 * @module lsp/diagnostics
 *
 * Bridge between MarkSpec core diagnostics and the LSP diagnostic protocol.
 * Converts severity, line/column (1-based → 0-based), and groups
 * diagnostics by file for per-document publishing.
 */

import type { Diagnostic as CoreDiagnostic, Severity } from "../core/mod.ts";

/**
 * LSP Diagnostic — a subset of the full LSP type.
 *
 * Defined locally so the bridge is testable without importing the full
 * vscode-languageserver package in unit tests.
 */
export interface LspDiagnostic {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  readonly severity: number;
  readonly source: string;
  readonly code: string;
  readonly message: string;
}

/** Map MarkSpec severity to LSP DiagnosticSeverity numeric values. */
export function toLspSeverity(severity: Severity): number {
  switch (severity) {
    case "error":
      return 1; // DiagnosticSeverity.Error
    case "warning":
      return 2; // DiagnosticSeverity.Warning
    case "info":
      return 3; // DiagnosticSeverity.Information
  }
}

/**
 * Convert a core Diagnostic to an LSP Diagnostic.
 *
 * Core uses 1-based line/column; LSP uses 0-based. For range end, we use
 * the same line with a large character value — the editor will clamp to
 * end-of-line, producing an underline from the start position to EOL.
 */
export function toLspDiagnostic(diagnostic: CoreDiagnostic): LspDiagnostic {
  const line = diagnostic.location ? diagnostic.location.line - 1 : 0;
  const character = diagnostic.location ? diagnostic.location.column - 1 : 0;
  return {
    range: {
      start: { line, character },
      end: { line, character: Number.MAX_SAFE_INTEGER },
    },
    severity: toLspSeverity(diagnostic.severity),
    source: "markspec",
    code: diagnostic.code,
    message: diagnostic.message,
  };
}

/**
 * Group core diagnostics by their source file path.
 *
 * Diagnostics with `undefined` location are dropped — they represent
 * file-level errors (e.g., "failed to read file") that have no
 * meaningful position.
 */
export function groupDiagnosticsByFile(
  diagnostics: readonly CoreDiagnostic[],
): Map<string, CoreDiagnostic[]> {
  const grouped = new Map<string, CoreDiagnostic[]>();
  for (const d of diagnostics) {
    if (!d.location) continue;
    const file = d.location.file;
    const list = grouped.get(file);
    if (list) {
      list.push(d);
    } else {
      grouped.set(file, [d]);
    }
  }
  return grouped;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-read packages/markspec/lsp/diagnostics_test.ts`

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/lsp/diagnostics.ts packages/markspec/lsp/diagnostics_test.ts
git commit -m "feat(lsp): add diagnostic bridge (core → LSP)

Convert MarkSpec Diagnostic to LSP Diagnostic with 1-based to 0-based
line/column translation, severity mapping, and per-file grouping."
```

---

## Task 3: Context guard

**Files:**

- Create: `packages/markspec/lsp/context.ts`
- Create: `packages/markspec/lsp/context_test.ts`

- [ ] **Step 1: Write failing tests for context guard**

Create `packages/markspec/lsp/context_test.ts`:

```typescript
/**
 * @module lsp/context_test
 *
 * Unit tests for MarkSpec context guard — file-level and position-level.
 */

import { assertEquals } from "@std/assert";
import {
  isDocCommentContext,
  isMarkspecFile,
  isSourceFile,
} from "./context.ts";

// --- File-level guard ---

Deno.test("isMarkspecFile: accepts .md files", () => {
  assertEquals(isMarkspecFile("docs/reqs.md"), true);
});

Deno.test("isMarkspecFile: accepts .rs files", () => {
  assertEquals(isMarkspecFile("src/lib.rs"), true);
});

Deno.test("isMarkspecFile: accepts .kt files", () => {
  assertEquals(isMarkspecFile("src/Main.kt"), true);
});

Deno.test("isMarkspecFile: accepts .java files", () => {
  assertEquals(isMarkspecFile("src/Main.java"), true);
});

Deno.test("isMarkspecFile: accepts .c files", () => {
  assertEquals(isMarkspecFile("src/main.c"), true);
});

Deno.test("isMarkspecFile: accepts .cpp files", () => {
  assertEquals(isMarkspecFile("src/main.cpp"), true);
});

Deno.test("isMarkspecFile: rejects .txt files", () => {
  assertEquals(isMarkspecFile("readme.txt"), false);
});

Deno.test("isMarkspecFile: rejects .py files", () => {
  assertEquals(isMarkspecFile("script.py"), false);
});

Deno.test("isSourceFile: true for source extensions", () => {
  assertEquals(isSourceFile("lib.rs"), true);
  assertEquals(isSourceFile("Main.kt"), true);
  assertEquals(isSourceFile("App.java"), true);
  assertEquals(isSourceFile("main.c"), true);
  assertEquals(isSourceFile("main.cpp"), true);
});

Deno.test("isSourceFile: false for markdown", () => {
  assertEquals(isSourceFile("reqs.md"), false);
});

// --- Position-level guard ---

Deno.test("isDocCommentContext: detects entry marker nearby", () => {
  const lines = [
    "/// [SRS_AEB_0030] Time-to-collision calculation",
    "///",
    "/// The decision module shall compute TTC.",
    "///",
    "/// Id: 01HGW3C4DEF6ABCDEFGHJKMNPQ \\",
    "/// Satisfies: SYS_AEB_0012",
  ];
  assertEquals(isDocCommentContext(lines, 3), true);
});

Deno.test("isDocCommentContext: detects trace attribute keyword nearby", () => {
  const lines = [
    "fn some_function() {",
    "    // some code",
    "    /// Satisfies: STK_001",
    "    // more code",
  ];
  assertEquals(isDocCommentContext(lines, 2), true);
});

Deno.test("isDocCommentContext: returns false for plain code", () => {
  const lines = [
    "fn main() {",
    '    println!("hello");',
    "    let x = 42;",
    "}",
  ];
  assertEquals(isDocCommentContext(lines, 1), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-read packages/markspec/lsp/context_test.ts`

Expected: FAIL — module `./context.ts` not found.

- [ ] **Step 3: Implement context.ts**

Create `packages/markspec/lsp/context.ts`:

```typescript
/**
 * @module lsp/context
 *
 * MarkSpec context guard. Determines whether a file or cursor position is
 * relevant to MarkSpec (entry blocks, trace attributes, doc comments).
 * Prevents the LSP from interfering with non-MarkSpec content.
 */

import { extname } from "@std/path";

/** Supported source file extensions (tree-sitter grammars available). */
const SOURCE_EXTENSIONS = new Set([
  ".rs",
  ".kt",
  ".kts",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".cc",
  ".cxx",
  ".hpp",
  ".hxx",
]);

/** Entry marker pattern: `[TYPE_XXX_NNNN]` in any context. */
const ENTRY_MARKER_RE = /\[[A-Z]{2,}_[A-Z0-9_]+\]/;

/** Trace attribute keywords that indicate a MarkSpec context. */
const TRACE_KEYWORDS_RE =
  /\b(Id|Satisfies|Derived-from|Verified-by|References|Tests|Depends-on|Part-of|Allocated-to|Realizes|Generated-from|Supersedes|Labels)\s*:/;

/**
 * Check whether a file path has a MarkSpec-relevant extension.
 * Markdown files and supported source files qualify.
 */
export function isMarkspecFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === ".md" || SOURCE_EXTENSIONS.has(ext);
}

/**
 * Check whether a file path is a source file (not Markdown).
 * Used to determine if position-level context guard is needed.
 */
export function isSourceFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return SOURCE_EXTENSIONS.has(ext);
}

/**
 * Position-level context guard for source files.
 *
 * Scans lines within a radius of the given line index for entry markers
 * (`[TYPE_XXX_NNNN]`) or trace attribute keywords (`Satisfies:`, `Id:`,
 * etc.). If found, the position is considered MarkSpec-relevant.
 *
 * @param lines All lines of the document as an array
 * @param lineIndex 0-based line index of the cursor position
 * @param radius Number of lines to scan in each direction (default: 20)
 */
export function isDocCommentContext(
  lines: readonly string[],
  lineIndex: number,
  radius = 20,
): boolean {
  const start = Math.max(0, lineIndex - radius);
  const end = Math.min(lines.length, lineIndex + radius + 1);
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (ENTRY_MARKER_RE.test(line) || TRACE_KEYWORDS_RE.test(line)) {
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-read packages/markspec/lsp/context_test.ts`

Expected: 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/lsp/context.ts packages/markspec/lsp/context_test.ts
git commit -m "feat(lsp): add context guard for MarkSpec-relevant files

File-level guard accepts .md and supported source extensions.
Position-level guard scans nearby lines for entry markers and
trace attribute keywords in source files."
```

---

## Task 4: WorkspaceIndex

**Files:**

- Create: `packages/markspec/lsp/workspace.ts`
- Create: `packages/markspec/lsp/workspace_test.ts`

- [ ] **Step 1: Write failing tests for WorkspaceIndex**

Create `packages/markspec/lsp/workspace_test.ts`:

```typescript
/**
 * @module lsp/workspace_test
 *
 * Unit tests for WorkspaceIndex — the in-memory entry index.
 */

import { assertEquals } from "@std/assert";
import { WorkspaceIndex } from "./workspace.ts";
import type { Entry, SourceLocation } from "../core/mod.ts";

/** Helper to create a minimal identified entry. */
function entry(
  displayId: string,
  opts: { file?: string; title?: string; id?: string } = {},
): Entry {
  const file = opts.file ?? "test.md";
  const location: SourceLocation = { file, line: 1, column: 1 };
  return {
    displayId,
    title: opts.title ?? displayId,
    body: "",
    attributes: opts.id ? [{ key: "Id", value: opts.id }] : [],
    id: opts.id,
    shape: "identified",
    location,
    source: "markdown",
  };
}

Deno.test("WorkspaceIndex: updateFile adds entries to index", () => {
  const index = new WorkspaceIndex();
  const entries = [
    entry("STK_AEB_0001", { file: "reqs.md", title: "Braking", id: "01AAA" }),
    entry("STK_AEB_0002", { file: "reqs.md", title: "Steering", id: "01BBB" }),
  ];
  index.updateFile("reqs.md", entries);

  assertEquals(index.getAllEntries().length, 2);
  assertEquals(index.getEntryByDisplayId("STK_AEB_0001")?.title, "Braking");
  assertEquals(index.getEntryByDisplayId("STK_AEB_0002")?.title, "Steering");
});

Deno.test("WorkspaceIndex: updateFile replaces entries for same file", () => {
  const index = new WorkspaceIndex();
  index.updateFile("reqs.md", [entry("STK_001", { file: "reqs.md" })]);
  assertEquals(index.getAllEntries().length, 1);

  index.updateFile("reqs.md", [
    entry("STK_002", { file: "reqs.md" }),
    entry("STK_003", { file: "reqs.md" }),
  ]);
  assertEquals(index.getAllEntries().length, 2);
  assertEquals(index.getEntryByDisplayId("STK_001"), undefined);
  assertEquals(index.getEntryByDisplayId("STK_002")?.displayId, "STK_002");
});

Deno.test("WorkspaceIndex: removeFile removes entries", () => {
  const index = new WorkspaceIndex();
  index.updateFile("a.md", [entry("STK_001", { file: "a.md" })]);
  index.updateFile("b.md", [entry("STK_002", { file: "b.md" })]);
  assertEquals(index.getAllEntries().length, 2);

  index.removeFile("a.md");
  assertEquals(index.getAllEntries().length, 1);
  assertEquals(index.getEntryByDisplayId("STK_001"), undefined);
  assertEquals(index.getEntryByDisplayId("STK_002")?.displayId, "STK_002");
});

Deno.test("WorkspaceIndex: getEntriesForFile returns file-scoped entries", () => {
  const index = new WorkspaceIndex();
  index.updateFile("a.md", [entry("STK_001", { file: "a.md" })]);
  index.updateFile("b.md", [entry("STK_002", { file: "b.md" })]);

  assertEquals(index.getEntriesForFile("a.md").length, 1);
  assertEquals(index.getEntriesForFile("a.md")[0].displayId, "STK_001");
  assertEquals(index.getEntriesForFile("c.md").length, 0);
});

Deno.test("WorkspaceIndex: getDisplayIdsByPrefix filters by prefix", () => {
  const index = new WorkspaceIndex();
  index.updateFile("reqs.md", [
    entry("STK_AEB_0001", { file: "reqs.md" }),
    entry("STK_AEB_0002", { file: "reqs.md" }),
    entry("SAD_AEB_0001", { file: "reqs.md" }),
  ]);

  const stkIds = index.getDisplayIdsByPrefix("STK");
  assertEquals(stkIds.length, 2);
  const sadIds = index.getDisplayIdsByPrefix("SAD");
  assertEquals(sadIds.length, 1);
  const sysIds = index.getDisplayIdsByPrefix("SYS");
  assertEquals(sysIds.length, 0);
});

Deno.test("WorkspaceIndex: getAllDisplayIds returns all IDs with titles", () => {
  const index = new WorkspaceIndex();
  index.updateFile("reqs.md", [
    entry("STK_001", { file: "reqs.md", title: "Braking" }),
    entry("SAD_001", { file: "reqs.md", title: "Architecture" }),
  ]);

  const all = index.getAllDisplayIds();
  assertEquals(all.length, 2);
  assertEquals(all.find((e) => e.displayId === "STK_001")?.title, "Braking");
});

Deno.test("WorkspaceIndex: getNextDisplayIdNumber computes next number", () => {
  const index = new WorkspaceIndex();
  index.updateFile("reqs.md", [
    entry("STK_AEB_0001", { file: "reqs.md" }),
    entry("STK_AEB_0003", { file: "reqs.md" }),
    entry("STK_AEB_0010", { file: "reqs.md" }),
  ]);

  assertEquals(index.getNextDisplayIdNumber("STK_AEB_"), 11);
});

Deno.test("WorkspaceIndex: getNextDisplayIdNumber returns 1 for empty prefix", () => {
  const index = new WorkspaceIndex();
  assertEquals(index.getNextDisplayIdNumber("STK_AEB_"), 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-read packages/markspec/lsp/workspace_test.ts`

Expected: FAIL — module `./workspace.ts` not found.

- [ ] **Step 3: Implement workspace.ts**

Create `packages/markspec/lsp/workspace.ts`:

```typescript
/**
 * @module lsp/workspace
 *
 * WorkspaceIndex — in-memory index of all MarkSpec entries in the project.
 * Supports incremental file-level updates and provides lookup queries for
 * diagnostics, completions, and future go-to-definition.
 */

import type { Diagnostic, DisplayId, Entry } from "../core/mod.ts";
import { parseFile, validate } from "../core/mod.ts";

/** A display ID paired with its entry title, for completion items. */
export interface DisplayIdEntry {
  readonly displayId: DisplayId;
  readonly title: string;
}

/**
 * In-memory index of all parsed entries, keyed by file path.
 *
 * Maintains both per-file storage (for incremental updates) and global
 * lookup indexes (rebuilt on every mutation). The index is the single
 * source of truth for the LSP's view of the project.
 */
export class WorkspaceIndex {
  /** Per-file entry storage. Key is the file path. */
  private fileEntries = new Map<string, Entry[]>();

  /** Global lookup by display ID. Rebuilt on mutation. */
  private byDisplayId = new Map<DisplayId, Entry>();

  // -----------------------------------------------------------------------
  // Mutation
  // -----------------------------------------------------------------------

  /**
   * Replace all entries for a file and rebuild global indexes.
   *
   * Call this after re-parsing a file. Pass an empty array to clear a
   * file's entries without removing it from tracking.
   */
  updateFile(filePath: string, entries: Entry[]): void {
    this.fileEntries.set(filePath, entries);
    this.rebuildGlobalIndexes();
  }

  /** Remove a file and its entries from the index entirely. */
  removeFile(filePath: string): void {
    this.fileEntries.delete(filePath);
    this.rebuildGlobalIndexes();
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /** Return a flat array of all entries across all files. */
  getAllEntries(): Entry[] {
    const all: Entry[] = [];
    for (const entries of this.fileEntries.values()) {
      all.push(...entries);
    }
    return all;
  }

  /** Return entries for a specific file, or an empty array. */
  getEntriesForFile(filePath: string): Entry[] {
    return this.fileEntries.get(filePath) ?? [];
  }

  /** Lookup a single entry by display ID. */
  getEntryByDisplayId(displayId: DisplayId): Entry | undefined {
    return this.byDisplayId.get(displayId);
  }

  /** Return all entries whose display ID starts with the given prefix. */
  getDisplayIdsByPrefix(prefix: string): Entry[] {
    const result: Entry[] = [];
    for (const [id, entry] of this.byDisplayId) {
      if (id.startsWith(prefix)) {
        result.push(entry);
      }
    }
    return result;
  }

  /** Return all display IDs with their titles — for completion lists. */
  getAllDisplayIds(): DisplayIdEntry[] {
    const result: DisplayIdEntry[] = [];
    for (const [displayId, entry] of this.byDisplayId) {
      result.push({ displayId, title: entry.title });
    }
    return result;
  }

  /**
   * Compute the next sequential number for a display-ID prefix.
   *
   * Scans all display IDs that start with `prefix`, extracts the trailing
   * numeric segment, and returns max + 1. Returns 1 if no matching IDs
   * exist.
   *
   * @param prefix - The prefix including the trailing separator,
   *   e.g., `"STK_AEB_"` for IDs like `STK_AEB_0001`.
   */
  getNextDisplayIdNumber(prefix: string): number {
    let max = 0;
    for (const id of this.byDisplayId.keys()) {
      if (id.startsWith(prefix)) {
        const suffix = id.slice(prefix.length);
        const num = parseInt(suffix, 10);
        if (!isNaN(num) && num > max) {
          max = num;
        }
      }
    }
    return max + 1;
  }

  /** Return all tracked file paths. */
  getFilePaths(): string[] {
    return [...this.fileEntries.keys()];
  }

  // -----------------------------------------------------------------------
  // Index parse + validate helpers
  // -----------------------------------------------------------------------

  /**
   * Parse a file's content and update the index.
   * Returns parse-level diagnostics for the file.
   */
  async parseAndUpdateFile(
    filePath: string,
    content: string,
  ): Promise<readonly Diagnostic[]> {
    const result = await parseFile(content, { file: filePath });
    this.updateFile(filePath, result.entries);
    return result.diagnostics;
  }

  /**
   * Run cross-file validation on all indexed entries.
   * Returns the full set of validation diagnostics.
   */
  validateAll(): readonly Diagnostic[] {
    const allEntries = this.getAllEntries();
    const result = validate(allEntries);
    return result.diagnostics;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /** Rebuild all global indexes from per-file storage. */
  private rebuildGlobalIndexes(): void {
    this.byDisplayId.clear();
    for (const entries of this.fileEntries.values()) {
      for (const entry of entries) {
        // First entry wins for duplicate display IDs — validator catches dupes
        if (!this.byDisplayId.has(entry.displayId)) {
          this.byDisplayId.set(entry.displayId, entry);
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-read packages/markspec/lsp/workspace_test.ts`

Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/lsp/workspace.ts packages/markspec/lsp/workspace_test.ts
git commit -m "feat(lsp): add WorkspaceIndex for in-memory entry tracking

Per-file entry storage with global display-ID lookup, prefix queries,
and next-ID computation. Supports incremental file-level updates."
```

---

## Task 5: Completion providers

**Files:**

- Create: `packages/markspec/lsp/completions.ts`
- Create: `packages/markspec/lsp/completions_test.ts`

- [ ] **Step 1: Write failing tests for completions**

Create `packages/markspec/lsp/completions_test.ts`:

```typescript
/**
 * @module lsp/completions_test
 *
 * Unit tests for entry block scaffold and ID reference completions.
 */

import { assertEquals } from "@std/assert";
import {
  buildBlockScaffoldItems,
  buildIdReferenceItems,
  extractRelationName,
  isBlockScaffoldTrigger,
  isTraceAttributeTrigger,
} from "./completions.ts";
import type { DisplayIdEntry } from "./workspace.ts";

// --- Trigger detection ---

Deno.test("isBlockScaffoldTrigger: matches '- ['", () => {
  assertEquals(isBlockScaffoldTrigger("- ["), true);
});

Deno.test("isBlockScaffoldTrigger: matches '  - ['", () => {
  assertEquals(isBlockScaffoldTrigger("  - ["), true);
});

Deno.test("isBlockScaffoldTrigger: rejects mid-line '['", () => {
  assertEquals(isBlockScaffoldTrigger("some text ["), false);
});

Deno.test("isBlockScaffoldTrigger: rejects standalone '['", () => {
  assertEquals(isBlockScaffoldTrigger("["), false);
});

Deno.test("isTraceAttributeTrigger: matches 'Satisfies:'", () => {
  assertEquals(isTraceAttributeTrigger("  Satisfies:"), true);
});

Deno.test("isTraceAttributeTrigger: matches 'Derived-from:'", () => {
  assertEquals(isTraceAttributeTrigger("  Derived-from:"), true);
});

Deno.test("isTraceAttributeTrigger: matches 'Satisfies: ' with trailing space", () => {
  assertEquals(isTraceAttributeTrigger("  Satisfies: "), true);
});

Deno.test("isTraceAttributeTrigger: matches 'Satisfies: STK' partial input", () => {
  assertEquals(isTraceAttributeTrigger("  Satisfies: STK"), true);
});

Deno.test("isTraceAttributeTrigger: rejects 'Id:'", () => {
  assertEquals(isTraceAttributeTrigger("  Id:"), false);
});

Deno.test("isTraceAttributeTrigger: rejects plain text with colon", () => {
  assertEquals(isTraceAttributeTrigger("Note: something"), false);
});

Deno.test("extractRelationName: extracts 'Satisfies' from line", () => {
  assertEquals(extractRelationName("  Satisfies: STK"), "Satisfies");
});

Deno.test("extractRelationName: extracts 'Derived-from'", () => {
  assertEquals(extractRelationName("  Derived-from: "), "Derived-from");
});

// --- Completion item building ---

Deno.test("buildIdReferenceItems: returns items for all display IDs", () => {
  const ids: DisplayIdEntry[] = [
    { displayId: "STK_AEB_0001", title: "Braking" },
    { displayId: "SAD_AEB_0001", title: "Architecture" },
  ];
  const items = buildIdReferenceItems(ids);
  assertEquals(items.length, 2);
  assertEquals(items[0].label, "STK_AEB_0001");
  assertEquals(items[0].detail, "Braking");
  assertEquals(items[1].label, "SAD_AEB_0001");
});

Deno.test("buildBlockScaffoldItems: returns generic item when no types", () => {
  const items = buildBlockScaffoldItems([]);
  assertEquals(items.length, 1);
  assertEquals(items[0].label, "New entry");
});

Deno.test("buildBlockScaffoldItems: returns one item per type", () => {
  const types = [
    { name: "stakeholder-requirement", prefix: "STK_AEB_", nextNumber: 4 },
    { name: "architecture", prefix: "SAD_AEB_", nextNumber: 2 },
  ];
  const items = buildBlockScaffoldItems(types);
  assertEquals(items.length, 2);
  assertEquals(items[0].label, "New stakeholder-requirement (STK_AEB_0004)");
  assertEquals(items[1].label, "New architecture (SAD_AEB_0002)");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-read packages/markspec/lsp/completions_test.ts`

Expected: FAIL — module `./completions.ts` not found.

- [ ] **Step 3: Implement completions.ts**

Create `packages/markspec/lsp/completions.ts`:

```typescript
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

import type { DisplayIdEntry } from "./workspace.ts";

/** Block scaffold trigger pattern: `- [` at the start of a list item. */
const BLOCK_SCAFFOLD_RE = /^\s*-\s*\[$/;

/** Pattern matching a trace attribute keyword at line start. */
const TRACE_ATTR_RE =
  /^\s*(Satisfies|Derived-from|Verified-by|References|Tests|Depends-on|Part-of|Allocated-to|Realizes|Generated-from|Supersedes)\s*:/;

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
export function buildBlockScaffoldItems(
  types: readonly EntryTypeInfo[],
): CompletionItemData[] {
  if (types.length === 0) {
    return [
      {
        label: "New entry",
        insertText:
          "${1:PREFIX_NNNN}] ${2:Title}\n\n  ${3:Body.}\n\n  Id: \\${ULID}",
        isSnippet: true,
        kind: KIND_SNIPPET,
      },
    ];
  }

  return types.map((type) => {
    const displayId = `${type.prefix}${padNumber(type.nextNumber)}`;
    return {
      label: `New ${type.name} (${displayId})`,
      detail: type.name,
      insertText:
        `${displayId}] \${1:Title}\n\n  \${2:Body.}\n\n  Id: \\$\{ULID} \\\\\n  \${3:Satisfies: }`,
      isSnippet: true,
      kind: KIND_SNIPPET,
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-read packages/markspec/lsp/completions_test.ts`

Expected: 14 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/lsp/completions.ts packages/markspec/lsp/completions_test.ts
git commit -m "feat(lsp): add completion providers for blocks and ID references

Block scaffold triggers on '- [' with profile-aware type suggestions.
ID reference triggers on trace attribute keywords with workspace-wide
display ID completion list."
```

---

## Task 6: Server entry point

**Files:**

- Modify: `packages/markspec/lsp/server.ts` (replace stub)

- [ ] **Step 1: Implement server.ts**

Replace the contents of `packages/markspec/lsp/server.ts` with the full LSP
server wiring. This file has no colocated unit test — it is integration-only
code that wires pure modules together. It is tested via E2E tests (Task 7).

```typescript
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
  type InitializeParams,
  type InitializeResult,
  InsertTextFormat,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
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
import {
  buildBlockScaffoldItems,
  buildIdReferenceItems,
  type EntryTypeInfo,
  isBlockScaffoldTrigger,
  isTraceAttributeTrigger,
} from "./completions.ts";
import {
  isDocCommentContext,
  isMarkspecFile,
  isSourceFile,
} from "./context.ts";
import { debounce, pathToUri, uriToPath } from "./util.ts";

export const VERSION = "0.0.1";

// ---------------------------------------------------------------------------
// Connection and document manager
// ---------------------------------------------------------------------------

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

let projectRoot: string | undefined;
let config: ProjectConfig = DEFAULT_PROJECT_CONFIG;
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
    .map(toLspDiagnostic);
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
      diagnostics: diags.map(toLspDiagnostic),
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
          config = configResult.config;
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

    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,
        completionProvider: {
          triggerCharacters: ["[", ":"],
        },
      },
    };
  },
);

// ---------------------------------------------------------------------------
// Initialized — build the workspace index
// ---------------------------------------------------------------------------

connection.onInitialized(async () => {
  if (!projectRoot) {
    connection.console.log("No project root found — running without index");
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

    // Initial cross-file validation
    publishAllDiagnostics();
  } catch (err) {
    connection.console.error(`Indexing failed: ${err}`);
  }
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

documents.onDidSave((change) => {
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

  return [];
});

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

connection.onShutdown(() => {
  debouncedValidateAll.cancel();
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
```

- [ ] **Step 2: Verify the server type-checks**

Run: `deno check packages/markspec/lsp/server.ts`

Expected: No errors. If there are import resolution issues with
`vscode-languageserver/node`, adjust the import map entry in `deno.json`.

- [ ] **Step 3: Commit**

```bash
git add packages/markspec/lsp/server.ts
git commit -m "feat(lsp): implement LSP server entry point (#55)

Wire up vscode-languageserver connection with workspace index,
diagnostics publishing, completion providers, and context guard.
Handles initialize, didChange, didSave, completion, and shutdown."
```

---

## Task 7: E2E test infrastructure and lifecycle test

**Files:**

- Create: `tests/e2e/lsp_helpers.ts`
- Create: `tests/e2e/lsp_lifecycle_test.ts`

- [ ] **Step 1: Create LSP test client helper**

Create `tests/e2e/lsp_helpers.ts`:

```typescript
/**
 * @module tests/e2e/lsp_helpers
 *
 * Minimal JSON-RPC client for E2E-testing the MarkSpec LSP server.
 * Spawns the server as a subprocess and communicates over stdin/stdout.
 */

const LSP_ENTRY = new URL(
  "../../packages/markspec/lsp/server.ts",
  import.meta.url,
).pathname;

/** A JSON-RPC message (request or notification). */
interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Encode a JSON-RPC message with Content-Length header. */
function encode(message: JsonRpcMessage): Uint8Array {
  const body = JSON.stringify(message);
  const header = `Content-Length: ${
    new TextEncoder().encode(body).length
  }\r\n\r\n`;
  return new TextEncoder().encode(header + body);
}

/**
 * Minimal LSP test client. Spawns the LSP server and provides
 * request/notification methods.
 */
export class LspTestClient {
  private process: Deno.ChildProcess;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffer = "";
  private nextId = 1;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }>();
  private notifications: JsonRpcMessage[] = [];

  private constructor(
    process: Deno.ChildProcess,
    writer: WritableStreamDefaultWriter<Uint8Array>,
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ) {
    this.process = process;
    this.writer = writer;
    this.reader = reader;
    this.startReading();
  }

  /** Spawn the LSP server in a temp directory with the given files. */
  static async create(
    files: Record<string, string> = {},
  ): Promise<LspTestClient> {
    const dir = await Deno.makeTempDir();
    for (const [name, content] of Object.entries(files)) {
      const parts = name.split("/");
      if (parts.length > 1) {
        await Deno.mkdir(`${dir}/${parts.slice(0, -1).join("/")}`, {
          recursive: true,
        }).catch(() => {});
      }
      await Deno.writeTextFile(`${dir}/${name}`, content);
    }

    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        LSP_ENTRY,
        "--stdio",
      ],
      cwd: dir,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    const process = cmd.spawn();
    const writer = process.stdin.getWriter();
    const reader = process.stdout.getReader();
    return new LspTestClient(process, writer, reader);
  }

  /** Send a JSON-RPC request and wait for the response. */
  async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const message: JsonRpcMessage = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    await this.writer.write(encode(message));
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });
  }

  /** Send a JSON-RPC notification (no response expected). */
  async notify(method: string, params?: unknown): Promise<void> {
    const message: JsonRpcMessage = {
      jsonrpc: "2.0",
      method,
      params,
    };
    await this.writer.write(encode(message));
  }

  /**
   * Wait for a notification with the given method to arrive.
   * Polls with timeout.
   */
  async waitForNotification(
    method: string,
    timeoutMs = 5000,
  ): Promise<JsonRpcMessage> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = this.notifications.find((n) => n.method === method);
      if (found) {
        this.notifications.splice(this.notifications.indexOf(found), 1);
        return found;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timeout waiting for notification: ${method}`);
  }

  /** Perform the initialize → initialized handshake. */
  async initialize(rootUri: string): Promise<unknown> {
    const result = await this.request("initialize", {
      processId: null,
      rootUri,
      capabilities: {},
    });
    await this.notify("initialized", {});
    // Give the server a moment to start indexing
    await new Promise((r) => setTimeout(r, 200));
    return result;
  }

  /** Perform shutdown → exit. */
  async shutdown(): Promise<void> {
    await this.request("shutdown", null);
    await this.notify("exit");
    await this.writer.close();
  }

  /** Read messages from stdout in a background loop. */
  private async startReading(): Promise<void> {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        this.processBuffer();
      }
    } catch {
      // Stream closed
    }
  }

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;

      const header = this.buffer.slice(0, headerEnd);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) return;

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (this.buffer.length < bodyEnd) return;

      const body = this.buffer.slice(bodyStart, bodyEnd);
      this.buffer = this.buffer.slice(bodyEnd);

      try {
        const message = JSON.parse(body) as JsonRpcMessage;
        this.handleMessage(message);
      } catch {
        // Malformed JSON — skip
      }
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (message.id !== undefined && !message.method) {
      // Response to a request
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(message.error);
        } else {
          pending.resolve(message.result);
        }
      }
    } else if (message.method) {
      // Server-initiated notification
      this.notifications.push(message);
    }
  }
}
```

- [ ] **Step 2: Write lifecycle E2E test**

Create `tests/e2e/lsp_lifecycle_test.ts`:

```typescript
/**
 * @module tests/e2e/lsp_lifecycle_test
 *
 * E2E test: LSP server initialize → shutdown → exit lifecycle.
 */

import { assertEquals, assertExists } from "@std/assert";
import { LspTestClient } from "./lsp_helpers.ts";

Deno.test("lsp lifecycle: initialize returns capabilities", async () => {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
  });
  try {
    const result = await client.initialize("file:///tmp/test") as Record<
      string,
      unknown
    >;
    assertExists(result);
    const capabilities = result.capabilities as Record<string, unknown>;
    assertExists(capabilities);
    // Verify text document sync
    assertEquals(capabilities.textDocumentSync, 1); // Full
    // Verify completion provider
    const completion = capabilities.completionProvider as Record<
      string,
      unknown
    >;
    assertExists(completion);
    assertEquals(completion.triggerCharacters, ["[", ":"]);
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp lifecycle: shutdown completes without error", async () => {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
  });
  const result = await client.initialize("file:///tmp/test");
  assertExists(result);
  // Shutdown should not throw
  await client.shutdown();
});
```

- [ ] **Step 3: Run E2E tests**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env tests/e2e/lsp_lifecycle_test.ts`

Expected: 2 tests PASS. If the server fails to start, check:

1. Import map resolution — `vscode-languageserver/node` must resolve.
2. The `--stdio` flag — vscode-languageserver defaults to stdio, so this may not
   be needed. Adjust the spawn args if necessary.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/lsp_helpers.ts tests/e2e/lsp_lifecycle_test.ts
git commit -m "test(lsp): add E2E test infrastructure and lifecycle test

JSON-RPC test client for spawning the LSP server and speaking the
protocol. Lifecycle test verifies initialize → shutdown → exit."
```

---

## Task 8: E2E diagnostics and completions tests

**Files:**

- Create: `tests/e2e/lsp_diagnostics_test.ts`
- Create: `tests/e2e/lsp_completions_test.ts`

- [ ] **Step 1: Write E2E diagnostics test**

Create `tests/e2e/lsp_diagnostics_test.ts`:

```typescript
/**
 * @module tests/e2e/lsp_diagnostics_test
 *
 * E2E test: open a file with validation errors → receive publishDiagnostics.
 */

import { assertEquals, assertExists } from "@std/assert";
import { LspTestClient } from "./lsp_helpers.ts";

Deno.test("lsp diagnostics: missing Id attribute reported", async () => {
  const md = `- [STK_AEB_0001] Test requirement

  This is a test.
`;
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
    "reqs.md": md,
  });
  try {
    await client.initialize("file:///tmp/test");

    // Open the document
    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri: "file:///tmp/test/reqs.md",
        languageId: "markdown",
        version: 1,
        text: md,
      },
    });

    // Wait for diagnostics
    const notification = await client.waitForNotification(
      "textDocument/publishDiagnostics",
      10000,
    );
    assertExists(notification.params);
    const params = notification.params as {
      uri: string;
      diagnostics: Array<{ code: string; message: string }>;
    };

    // Should report missing Id (MSL-R003)
    const hasR003 = params.diagnostics.some((d) => d.code === "MSL-R003");
    assertEquals(
      hasR003,
      true,
      `Expected MSL-R003, got: ${JSON.stringify(params.diagnostics)}`,
    );
  } finally {
    await client.shutdown();
  }
});
```

- [ ] **Step 2: Write E2E completions test**

Create `tests/e2e/lsp_completions_test.ts`:

```typescript
/**
 * @module tests/e2e/lsp_completions_test
 *
 * E2E test: trigger completion at `- [` and `Satisfies:` positions.
 */

import { assert, assertExists } from "@std/assert";
import { LspTestClient } from "./lsp_helpers.ts";

Deno.test("lsp completions: block scaffold on '- ['", async () => {
  const md = `# Requirements

- [
`;
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
    "reqs.md": md,
  });
  try {
    await client.initialize("file:///tmp/test");

    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri: "file:///tmp/test/reqs.md",
        languageId: "markdown",
        version: 1,
        text: md,
      },
    });

    // Request completion at the `[` position (line 2, char 3)
    const result = await client.request("textDocument/completion", {
      textDocument: { uri: "file:///tmp/test/reqs.md" },
      position: { line: 2, character: 3 },
    }) as Array<{ label: string }>;

    assertExists(result);
    assert(result.length > 0, "Expected at least one completion item");
    // Without a profile, should get generic "New entry"
    assert(
      result.some((item) => item.label === "New entry"),
      `Expected "New entry" item, got: ${
        JSON.stringify(result.map((i) => i.label))
      }`,
    );
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp completions: ID reference on 'Satisfies:'", async () => {
  const md = `- [STK_AEB_0001] First requirement

  Body text.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [SAD_AEB_0001] Architecture item

  Body text.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEG \\
  Satisfies: 
`;
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
    "reqs.md": md,
  });
  try {
    await client.initialize("file:///tmp/test");

    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri: "file:///tmp/test/reqs.md",
        languageId: "markdown",
        version: 1,
        text: md,
      },
    });

    // Give server time to parse and index
    await new Promise((r) => setTimeout(r, 500));

    // Request completion after "Satisfies: " (line 11, char 14)
    const result = await client.request("textDocument/completion", {
      textDocument: { uri: "file:///tmp/test/reqs.md" },
      position: { line: 11, character: 14 },
    }) as Array<{ label: string }>;

    assertExists(result);
    assert(result.length > 0, "Expected at least one completion item");
    assert(
      result.some((item) => item.label === "STK_AEB_0001"),
      `Expected STK_AEB_0001 in completions, got: ${
        JSON.stringify(result.map((i) => i.label))
      }`,
    );
  } finally {
    await client.shutdown();
  }
});
```

- [ ] **Step 3: Run all E2E tests**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env tests/e2e/lsp_*`

Expected: 4 tests PASS (2 lifecycle + 1 diagnostics + 1 completions that has 2
sub-tests).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/lsp_diagnostics_test.ts tests/e2e/lsp_completions_test.ts
git commit -m "test(lsp): add E2E tests for diagnostics and completions

Diagnostics test verifies MSL-R003 is reported for missing Id.
Completions test verifies block scaffold and ID reference triggers."
```

---

## Task 9: Integration — type-check, lint, format, full test run

**Files:**

- Possibly fix: any files with lint/format/type-check issues

- [ ] **Step 1: Format all new files**

Run: `deno fmt packages/markspec/lsp/ tests/e2e/lsp_*`

- [ ] **Step 2: Lint all new files**

Run: `deno lint packages/markspec/lsp/ tests/e2e/`

Fix any lint issues.

- [ ] **Step 3: Type-check**

Run:
`deno check packages/markspec/lsp/server.ts packages/markspec/main.ts packages/markspec/core/mod.ts`

Fix any type errors.

- [ ] **Step 4: Run full unit test suite**

Run: `deno test --allow-read packages/markspec/lsp/`

Expected: All unit tests pass (util, diagnostics, context, workspace,
completions).

- [ ] **Step 5: Run full E2E LSP test suite**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env tests/e2e/lsp_*`

Expected: All E2E tests pass.

- [ ] **Step 6: Run existing tests to check for regressions**

Run: `deno test --allow-read packages/markspec/core/`

Expected: Same pass/fail count as baseline (410 pass, 2 pre-existing failures).

- [ ] **Step 7: Squash into single commit for PR**

Per AGENTS.md: "One commit per PR." Soft-reset to squash all task commits into
one (AGENTS.md forbids interactive git commands like `git rebase -i`):

```bash
git reset --soft origin/main
git commit -m '<message below>'
```

Commit message:

```text
feat(lsp): implement LSP server with diagnostics and completions (#55-#59)

Add a fully functional MarkSpec LSP server providing:
- Server lifecycle: initialize, index build, shutdown (#55)
- Entry block scaffold completion on `- [` trigger (#56)
- ID reference completion on trace attribute keywords (#57)
- Real-time diagnostics with two-tier debounce (#58)
- Context guard for Markdown and source doc comments (#59)

Includes WorkspaceIndex for in-memory entry tracking, diagnostic bridge
(core → LSP), and both unit and E2E tests.
```

- [ ] **Step 8: Verify final state**

Run: `just build` (or the equivalent check + test + lint sequence)

Expected: All checks pass (modulo pre-existing book test failures and WASM
type-check issue on main).
