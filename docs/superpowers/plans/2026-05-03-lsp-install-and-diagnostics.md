# LSP install, spawn, and diagnostics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the brittle `deno run`-with-hand-tuned-permissions spawn path
with a bundled-binary architecture, add three diagnostic layers, and add three
test layers — eliminating the five bugs from 2026-05-02 and catching their
regressions.

**Architecture:** The extension spawns the deno-compiled `markspec` binary
(which embeds runtime permissions at compile time). A `markspec.server.path`
setting overrides for dev mode. The extension performs `${workspaceFolder}`
substitution itself. CI cross-compiles per-platform binaries and produces
per-platform VSIX files for GitHub release assets. Tests exercise the spawn
contract from both ends: extension-side (spawn args correctness) and server-side
(lifecycle under restricted permissions with a real processId).

**Tech Stack:** Deno + TypeScript (server, tests), Node + TypeScript +
`vscode-languageclient` (extension), `vsce` (packaging), GitHub Actions (CI),
`node:test` (extension unit tests).

**Spec:**
[docs/superpowers/specs/2026-05-03-lsp-install-and-diagnostics-design.md](../specs/2026-05-03-lsp-install-and-diagnostics-design.md)

---

## File Structure

### New files

- `editors/vscode/src/serverOptions.ts` — pure functions for resolving spawn
  args (server path, expanded args, env). Extracted from `extension.ts` so it's
  unit-testable.
- `editors/vscode/src/serverOptions.test.ts` — `node:test` unit tests for the
  resolver.
- `editors/vscode/src/statusBar.ts` — status bar item lifecycle, driven by
  `LanguageClient` state events.
- `editors/vscode/scripts/bundleBinary.ts` — Deno script that
  copies/cross-compiles the markspec binary into `editors/vscode/bin/` for VSIX
  packaging.
- `editors/vscode/.gitignore` — ignore `bin/` and `*.vsix` (build artifacts,
  never committed).
- `packages/markspec/lsp/debug_log.ts` — `MARKSPEC_LSP_DEBUG_LOG` writer module.
  Pure, no LSP-framework imports.
- `packages/markspec/lsp/debug_log_test.ts` — colocated unit test.
- `tests/e2e/lsp_compiled_test.ts` — smoke test against the compiled
  `dist/markspec` binary.

### Modified files

- `.vscode/settings.json` — replace hardcoded absolute path with
  `${workspaceFolder}`.
- `editors/vscode/src/extension.ts` — strip inline serverOptions construction
  (now in serverOptions.ts), wire status bar, forward server stderr to output
  channel.
- `editors/vscode/package.json` — add `test` and `bundle` scripts; ensure
  `package` doesn't use `--no-dependencies`.
- `editors/vscode/tsconfig.json` — include test files; add `node:test` types if
  needed.
- `packages/markspec/lsp/server.ts` — wire `debug_log` lifecycle hooks; forward
  `unhandledrejection` and `error` to `connection.console.error` and the debug
  log; emit `markspec/indexed` custom notification after first
  `publishAllDiagnostics`.
- `tests/e2e/lsp_helpers.ts` — accept optional `processId` (default `Deno.pid`);
  accept optional `extraPermissions`; pass `--allow-run` to spawn args by
  default.
- `tests/e2e/lsp_lifecycle_test.ts` — add "watchdog with real processId stays
  alive past 5s" test.
- `.github/workflows/release.yaml` — add `windows-latest` target; add VSIX
  packaging step that produces per-platform `.vsix` files; upload them as
  release assets.
- `CONTRIBUTING.md` — document the dev-mode workflow.

---

## Phase 1 — Stop the bleeding (bundled binary path)

This phase eliminates bugs 4 and 5 by construction: the extension stops invoking
`deno run` and instead spawns the compiled binary that bakes permissions in at
compile time. End of phase: the extension works on a fresh clone with no
per-machine config.

### Task 1: Carve `serverOptions.ts` out of `extension.ts`

**Files:**

- Create: `editors/vscode/src/serverOptions.ts`
- Modify: `editors/vscode/src/extension.ts`

**Goal:** Move `ServerOptions` construction out of the extension's `activate()`
so it's unit-testable in isolation.

- [ ] **Step 1: Create `editors/vscode/src/serverOptions.ts`**

```typescript
/**
 * @module serverOptions
 *
 * Builds the spawn arguments for the MarkSpec LSP server. Pure functions —
 * no `vscode` API access — so this module is unit-testable.
 *
 * The extension calls `resolveServerOptions` during activation and passes the
 * result to `LanguageClient`.
 */

import * as path from "node:path";
import { TransportKind } from "vscode-languageclient/node";
import type { ServerOptions } from "vscode-languageclient/node";

export interface ResolveInput {
  /** Absolute path to the unpacked extension directory. */
  readonly extensionPath: string;
  /** Absolute path to the active VS Code workspace folder, if any. */
  readonly workspaceFolder: string | undefined;
  /** Value of `markspec.server.path` setting, or undefined. */
  readonly configuredServerPath: string | undefined;
  /** Value of `markspec.server.args` setting, or undefined. */
  readonly configuredServerArgs: readonly string[] | undefined;
  /** Value of `markspec.trace.debugLog` setting, or undefined. */
  readonly debugLogPath: string | undefined;
  /** Platform identifier for naming the bundled binary. */
  readonly platform: NodeJS.Platform;
}

/**
 * Compute the spawn `command` and `args` for the LSP server.
 *
 * If `configuredServerPath` is set, use it (developer mode). Otherwise fall
 * back to the bundled binary at `<extensionPath>/bin/markspec(.exe)`.
 *
 * `${workspaceFolder}` is substituted in `configuredServerArgs`.
 */
export function resolveServerOptions(input: ResolveInput): ServerOptions {
  const { command, args } = resolveCommand(input);
  const env = { ...process.env };
  if (input.debugLogPath) {
    env.MARKSPEC_LSP_DEBUG_LOG = input.debugLogPath;
  }
  return {
    command,
    args,
    transport: TransportKind.stdio,
    options: { env },
  };
}

function resolveCommand(
  input: ResolveInput,
): { command: string; args: string[] } {
  if (input.configuredServerPath) {
    return {
      command: input.configuredServerPath,
      args: expandVariables(
        input.configuredServerArgs ?? ["lsp"],
        input.workspaceFolder,
      ),
    };
  }
  const binaryName = input.platform === "win32" ? "markspec.exe" : "markspec";
  return {
    command: path.join(input.extensionPath, "bin", binaryName),
    args: ["lsp"],
  };
}

/** Expand `${workspaceFolder}` in each arg. Other `${...}` left untouched. */
export function expandVariables(
  args: readonly string[],
  workspaceFolder: string | undefined,
): string[] {
  return args.map((arg) => {
    if (workspaceFolder === undefined) return arg;
    return arg.replaceAll("${workspaceFolder}", workspaceFolder);
  });
}
```

- [ ] **Step 2: Update `editors/vscode/src/extension.ts` to use
      `resolveServerOptions`**

```typescript
/**
 * MarkSpec VSCode Extension
 *
 * Thin LSP client. Spawns the markspec LSP server (bundled binary by default,
 * or a configured deno + source path for dev mode) and connects it to VS Code.
 */

import { type ExtensionContext, window, workspace } from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
} from "vscode-languageclient/node";
import { resolveServerOptions } from "./serverOptions";

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const config = workspace.getConfiguration("markspec");
  const traceLevel = config.get<string>("trace.server", "off");

  const workspaceFolder = workspace.workspaceFolders?.[0]?.uri.fsPath;

  const serverOptions = resolveServerOptions({
    extensionPath: context.extensionPath,
    workspaceFolder,
    configuredServerPath: config.get<string>("server.path") || undefined,
    configuredServerArgs: config.get<string[]>("server.args"),
    debugLogPath: config.get<string>("trace.debugLog") || undefined,
    platform: process.platform,
  });

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "markdown" },
      { scheme: "file", language: "rust" },
      { scheme: "file", language: "kotlin" },
      { scheme: "file", language: "java" },
      { scheme: "file", language: "c" },
      { scheme: "file", language: "cpp" },
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/*.md"),
    },
    traceOutputChannel: traceLevel !== "off"
      ? window.createOutputChannel("MarkSpec LSP")
      : undefined,
  };

  client = new LanguageClient(
    "markspec",
    "MarkSpec",
    serverOptions,
    clientOptions,
  );

  client.start();

  context.subscriptions.push({
    dispose: () => {
      client?.stop();
    },
  });
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
```

- [ ] **Step 3: Compile to verify no regression**

Run: `cd editors/vscode && npm run compile` Expected: Exits 0, no TypeScript
errors.

- [ ] **Step 4: Commit**

```bash
git add editors/vscode/src/serverOptions.ts editors/vscode/src/extension.ts
git commit -m "refactor(vscode): extract serverOptions resolver into testable module"
```

### Task 2: Add `node:test` unit tests for `serverOptions`

**Files:**

- Create: `editors/vscode/src/serverOptions.test.ts`
- Modify: `editors/vscode/package.json`
- Modify: `editors/vscode/tsconfig.json`

- [ ] **Step 1: Add `test` script to `editors/vscode/package.json`**

Locate the `"scripts"` block and replace it with:

```json
"scripts": {
  "compile": "tsc -p tsconfig.json",
  "watch": "tsc -watch -p tsconfig.json",
  "package": "vsce package",
  "lint": "eslint src",
  "test": "tsc -p tsconfig.json && node --test out/serverOptions.test.js"
}
```

- [ ] **Step 2: Update `editors/vscode/tsconfig.json` to compile test files**

Read the current file. Locate `"include"` (or add it). Ensure the value is:

```json
"include": ["src/**/*.ts"]
```

(Test files end in `.test.ts` so the existing glob already covers them. No
change needed unless the glob is narrower.)

- [ ] **Step 3: Write `editors/vscode/src/serverOptions.test.ts`**

```typescript
import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as path from "node:path";
import { expandVariables, resolveServerOptions } from "./serverOptions";

const EXT_PATH = "/fake/extensions/driftsys.markspec-ide-0.0.1";
const WORKSPACE = "/fake/workspace/markspec";

test("resolveServerOptions: bundled binary by default (linux)", () => {
  const opts = resolveServerOptions({
    extensionPath: EXT_PATH,
    workspaceFolder: WORKSPACE,
    configuredServerPath: undefined,
    configuredServerArgs: undefined,
    debugLogPath: undefined,
    platform: "linux",
  }) as { command: string; args: string[] };
  assert.equal(opts.command, path.join(EXT_PATH, "bin", "markspec"));
  assert.deepEqual(opts.args, ["lsp"]);
});

test("resolveServerOptions: bundled binary uses .exe on win32", () => {
  const opts = resolveServerOptions({
    extensionPath: EXT_PATH,
    workspaceFolder: WORKSPACE,
    configuredServerPath: undefined,
    configuredServerArgs: undefined,
    debugLogPath: undefined,
    platform: "win32",
  }) as { command: string };
  assert.equal(opts.command, path.join(EXT_PATH, "bin", "markspec.exe"));
});

test("resolveServerOptions: configured path overrides bundled binary", () => {
  const opts = resolveServerOptions({
    extensionPath: EXT_PATH,
    workspaceFolder: WORKSPACE,
    configuredServerPath: "deno",
    configuredServerArgs: ["run", "--allow-read", "main.ts", "lsp"],
    debugLogPath: undefined,
    platform: "linux",
  }) as { command: string; args: string[] };
  assert.equal(opts.command, "deno");
  assert.deepEqual(opts.args, ["run", "--allow-read", "main.ts", "lsp"]);
});

test("resolveServerOptions: ${workspaceFolder} is expanded in args", () => {
  const opts = resolveServerOptions({
    extensionPath: EXT_PATH,
    workspaceFolder: WORKSPACE,
    configuredServerPath: "deno",
    configuredServerArgs: [
      "run",
      "${workspaceFolder}/packages/markspec/main.ts",
      "lsp",
    ],
    debugLogPath: undefined,
    platform: "linux",
  }) as { args: string[] };
  assert.deepEqual(opts.args, [
    "run",
    `${WORKSPACE}/packages/markspec/main.ts`,
    "lsp",
  ]);
});

test("resolveServerOptions: configured path with empty args defaults to ['lsp']", () => {
  const opts = resolveServerOptions({
    extensionPath: EXT_PATH,
    workspaceFolder: WORKSPACE,
    configuredServerPath: "/usr/local/bin/markspec",
    configuredServerArgs: undefined,
    debugLogPath: undefined,
    platform: "linux",
  }) as { args: string[] };
  assert.deepEqual(opts.args, ["lsp"]);
});

test("resolveServerOptions: debugLogPath sets MARKSPEC_LSP_DEBUG_LOG env", () => {
  const opts = resolveServerOptions({
    extensionPath: EXT_PATH,
    workspaceFolder: WORKSPACE,
    configuredServerPath: undefined,
    configuredServerArgs: undefined,
    debugLogPath: "/tmp/markspec-lsp.log",
    platform: "linux",
  }) as { options: { env: Record<string, string | undefined> } };
  assert.equal(
    opts.options.env.MARKSPEC_LSP_DEBUG_LOG,
    "/tmp/markspec-lsp.log",
  );
});

test("expandVariables: leaves args untouched when workspaceFolder is undefined", () => {
  const result = expandVariables(
    ["${workspaceFolder}/main.ts"],
    undefined,
  );
  assert.deepEqual(result, ["${workspaceFolder}/main.ts"]);
});

test("expandVariables: expands multiple occurrences in one arg", () => {
  const result = expandVariables(
    ["${workspaceFolder}/a:${workspaceFolder}/b"],
    "/ws",
  );
  assert.deepEqual(result, ["/ws/a:/ws/b"]);
});
```

- [ ] **Step 4: Run the tests**

Run: `cd editors/vscode && npm test` Expected: 8 tests pass. Output ends with
`# pass 8`.

- [ ] **Step 5: Commit**

```bash
git add editors/vscode/src/serverOptions.test.ts editors/vscode/package.json editors/vscode/tsconfig.json
git commit -m "test(vscode): unit-test serverOptions resolver covering bundled and dev mode"
```

### Task 3: Add `markspec.trace.debugLog` to extension contributes

**Files:**

- Modify: `editors/vscode/package.json`

- [ ] **Step 1: Add the configuration entry**

In `editors/vscode/package.json`, locate
`"contributes": { "configuration": { "properties": { ... } } }`. Add a new
property after `markspec.trace.server`:

```json
"markspec.trace.debugLog": {
  "type": "string",
  "default": "",
  "description": "Path to a writable file for LSP server lifecycle and crash logging. Empty means disabled. Equivalent to setting MARKSPEC_LSP_DEBUG_LOG when spawning the server manually."
}
```

- [ ] **Step 2: Compile to verify the package.json is still valid**

Run: `cd editors/vscode && npm run compile` Expected: Exits 0.

- [ ] **Step 3: Commit**

```bash
git add editors/vscode/package.json
git commit -m "feat(vscode): add markspec.trace.debugLog setting"
```

### Task 4: Add `editors/vscode/.gitignore`

**Files:**

- Create: `editors/vscode/.gitignore`

- [ ] **Step 1: Write the gitignore**

```text
# Build artifacts — never committed. The bundled binary is dropped into bin/
# at packaging time by scripts/bundleBinary.ts and shipped in the .vsix.
bin/
*.vsix

# TypeScript build output
out/

# Node deps
node_modules/
```

- [ ] **Step 2: Verify no currently-tracked files are now ignored**

Run:
`git -C /Users/sebastientasson/Workspace/driftsys/markspec ls-files editors/vscode/bin editors/vscode/out 2>&1 | head`
Expected: empty output (no tracked files in those directories).

- [ ] **Step 3: Commit**

```bash
git add editors/vscode/.gitignore
git commit -m "chore(vscode): gitignore build artifacts"
```

### Task 5: Bundle-binary script

**Files:**

- Create: `editors/vscode/scripts/bundleBinary.ts`

This Deno script copies the host-platform binary into
`editors/vscode/bin/markspec` so the next `vsce package` includes it in the
VSIX. Used by both the local dev workflow (`just bundle-extension`) and CI.

- [ ] **Step 1: Write `editors/vscode/scripts/bundleBinary.ts`**

```typescript
/**
 * @module bundleBinary
 *
 * Copies a markspec binary into `editors/vscode/bin/<name>` so it gets
 * packaged into the next VSIX. Defaults to the host-platform binary at
 * `dist/markspec`. Pass `--source <path>` to override.
 *
 * Usage:
 *   deno run --allow-read --allow-write \
 *     editors/vscode/scripts/bundleBinary.ts \
 *     [--source dist/markspec] [--name markspec]
 */

import { parseArgs } from "@std/cli/parse-args";
import { dirname, fromFileUrl, join } from "@std/path";

const HERE = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const BIN_DIR = join(HERE, "..", "bin");

const args = parseArgs(Deno.args, {
  string: ["source", "name"],
  default: {
    source: join(REPO_ROOT, "dist", "markspec"),
    name: "markspec",
  },
});

const source = args.source as string;
const targetName = args.name as string;

try {
  const stat = await Deno.stat(source);
  if (!stat.isFile) {
    console.error(`error: ${source} is not a regular file`);
    Deno.exit(1);
  }
} catch {
  console.error(
    `error: ${source} not found. Run 'just compile' (or 'deno compile') first.`,
  );
  Deno.exit(1);
}

await Deno.mkdir(BIN_DIR, { recursive: true });
const target = join(BIN_DIR, targetName);
await Deno.copyFile(source, target);
await Deno.chmod(target, 0o755).catch(() => {/* windows */});
console.error(`bundled ${source} -> ${target}`);
```

- [ ] **Step 2: Verify the script runs against the existing dist/markspec**

Run from repo root:

```bash
deno run --allow-read --allow-write editors/vscode/scripts/bundleBinary.ts
```

Expected: prints `bundled .../dist/markspec -> .../editors/vscode/bin/markspec`.
Verify with `ls -la editors/vscode/bin/markspec`.

- [ ] **Step 3: Add a `bundle` npm script**

In `editors/vscode/package.json`, update the `scripts` block:

```json
"scripts": {
  "compile": "tsc -p tsconfig.json",
  "watch": "tsc -watch -p tsconfig.json",
  "bundle": "deno run --allow-read --allow-write scripts/bundleBinary.ts",
  "package": "npm run bundle && vsce package",
  "lint": "eslint src",
  "test": "tsc -p tsconfig.json && node --test out/serverOptions.test.js"
}
```

- [ ] **Step 4: Commit**

```bash
git add editors/vscode/scripts/bundleBinary.ts editors/vscode/package.json
git commit -m "build(vscode): add bundleBinary script and wire into npm package"
```

### Task 6: Update `.vscode/settings.json` to portable `${workspaceFolder}`

**Files:**

- Modify: `.vscode/settings.json`

- [ ] **Step 1: Replace the absolute path with `${workspaceFolder}`**

Read `.vscode/settings.json`. Replace the value of `markspec.server.args[3]`
(the absolute path to `main.ts`) with
`"${workspaceFolder}/packages/markspec/main.ts"`. Replace `markspec.server.path`
value `"/Users/sebastientasson/.deno/bin/deno"` with `"deno"` (rely on PATH; the
extension-side substitution code path is the path being tested here).

End state of the markspec section of `.vscode/settings.json`:

```json
"markspec.server.path": "deno",
"markspec.server.args": [
  "run",
  "--allow-read",
  "--allow-env",
  "--allow-run",
  "${workspaceFolder}/packages/markspec/main.ts",
  "lsp"
],
"markspec.trace.server": "verbose"
```

- [ ] **Step 2: Reload VS Code window and verify the LSP runs**

Cmd+Shift+P → "Developer: Reload Window". Open
`tests/fixtures/requirement-block.md`. Run from a terminal:

```bash
ps aux | grep main.ts | grep -v grep
```

Expected: a `deno run ... main.ts lsp --stdio` process is alive (PID stable for

> 5 seconds).

- [ ] **Step 3: Commit**

```bash
git add .vscode/settings.json
git commit -m "chore(repo): use \${workspaceFolder} in dev-mode LSP settings for portability"
```

---

## Phase 2 — Test layers

This phase adds the three test layers from the spec, in order of bug-catching
value. The lifecycle test (Task 7) is the highest priority — it would have
caught the watchdog bug.

### Task 7: Update `lsp_helpers.ts` to grant `--allow-run` and pass real `processId`

**Files:**

- Modify: `tests/e2e/lsp_helpers.ts`

This change is the precondition for Task 8: the lifecycle test that catches bug
5 needs both a real processId AND restricted-but-correct permissions. Add
`--allow-run` to the default spawn (matching what the dev-mode
`.vscode/settings.json` does) and use `Deno.pid` as `processId` by default.

- [ ] **Step 1: Add `--allow-run` to spawn args**

Locate the `Deno.Command` invocation in `LspTestClient.create`. Update the args
array:

```typescript
const cmd = new Deno.Command("deno", {
  args: [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "--allow-run",
    LSP_ENTRY,
    "--stdio",
  ],
  cwd: WORKSPACE_ROOT,
  stdin: "piped",
  stdout: "piped",
  stderr: "piped",
});
```

- [ ] **Step 2: Add `processId` parameter to `initialize`**

Replace the `initialize` method body:

```typescript
/** Perform the initialize → initialized handshake. */
async initialize(options: { processId?: number | null } = {}): Promise<unknown> {
  const rootUri = `file://${this.workDir}`;
  const result = await this.request("initialize", {
    processId: options.processId === undefined ? Deno.pid : options.processId,
    rootUri,
    capabilities: {},
  });
  await this.notify("initialized", {});
  // Give the server a moment to start indexing
  await new Promise((r) => setTimeout(r, 200));
  return result;
}
```

- [ ] **Step 3: Run the existing LSP test suite to confirm nothing regressed**

Run:
`deno test --allow-run --allow-read --allow-write --allow-env tests/e2e/lsp_lifecycle_test.ts tests/e2e/lsp_completions_test.ts tests/e2e/lsp_diagnostics_test.ts`
Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/lsp_helpers.ts
git commit -m "test(e2e): grant --allow-run and pass real processId in LSP test client"
```

### Task 8: Add the watchdog regression test

**Files:**

- Modify: `tests/e2e/lsp_lifecycle_test.ts`

The test that would have caught bug 5: spawn the LSP with restricted permissions
and a real processId, then wait past the 3-second watchdog interval before
sending shutdown. If the watchdog kills the process due to `--allow-run` or any
other missing permission, the next request times out.

- [ ] **Step 1: Add the test**

Append to `tests/e2e/lsp_lifecycle_test.ts`:

```typescript
Deno.test("lsp lifecycle: server stays alive past watchdog interval (regression for 2026-05-02 bug)", async () => {
  // The vscode-languageserver framework runs a parent-process watchdog every
  // 3 seconds. It calls process.kill(parentPid, 0) — which requires
  // --allow-run in Deno. If --allow-run is missing OR processId is null, the
  // test won't catch the bug. Both conditions matter.
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
  });
  try {
    await client.initialize({ processId: Deno.pid });
    // Wait past the 3-second watchdog window.
    await new Promise((r) => setTimeout(r, 5000));
    // Server should still be responsive — issue an arbitrary request.
    const result = await client.request("shutdown", null);
    assertEquals(result, null);
  } finally {
    await client.shutdown();
  }
});
```

- [ ] **Step 2: Run the new test against the current code**

Run:
`deno test --allow-run --allow-read --allow-write --allow-env tests/e2e/lsp_lifecycle_test.ts -- --filter "watchdog interval"`
Expected: PASS. The current server code (with `--allow-run` and
`process.stdin/stdout` reader/writer) supports this.

- [ ] **Step 3: Verify the test would have caught bug 5**

To prove the test catches the regression, temporarily strip `--allow-run` from
`tests/e2e/lsp_helpers.ts` and rerun. You should see the test fail (request
times out at the 10-second mark). Then revert the change.

```bash
# Temporarily strip --allow-run
sed -i.bak 's/"--allow-run",//' tests/e2e/lsp_helpers.ts
deno test --allow-run --allow-read --allow-write --allow-env \
  tests/e2e/lsp_lifecycle_test.ts -- --filter "watchdog interval"
# Restore
mv tests/e2e/lsp_helpers.ts.bak tests/e2e/lsp_helpers.ts
```

Expected: with --allow-run stripped, the test fails (timeout). After restore, it
passes again.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/lsp_lifecycle_test.ts
git commit -m "test(e2e): regression test for watchdog killing LSP without --allow-run"
```

### Task 9: Compiled-binary smoke test

**Files:**

- Create: `tests/e2e/lsp_compiled_test.ts`

The smoke test the existing suite is missing: prove the compiled binary's `lsp`
subcommand actually starts and accepts an `initialize` request. Skipped if
`dist/markspec` doesn't exist locally; CI ensures it does.

- [ ] **Step 1: Write `tests/e2e/lsp_compiled_test.ts`**

```typescript
/**
 * Smoke test for the compiled markspec binary's `lsp` subcommand.
 *
 * Exercises the spawn path that ships in the VSIX. Catches regressions where
 * `deno compile` output diverges from `deno run` (missing --include for
 * embedded assets, transport flag handling, etc).
 */

import { assertEquals } from "@std/assert";

const COMPILED_BINARY = new URL(
  "../../dist/markspec",
  import.meta.url,
).pathname;

const compiledExists = await Deno.stat(COMPILED_BINARY)
  .then(() => true)
  .catch(() => false);

Deno.test({
  name: "compiled lsp: responds to initialize",
  ignore: !compiledExists,
  async fn() {
    const cmd = new Deno.Command(COMPILED_BINARY, {
      args: ["lsp", "--stdio"],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    const child = cmd.spawn();
    try {
      const writer = child.stdin.getWriter();
      const initBody = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { processId: Deno.pid, rootUri: null, capabilities: {} },
      });
      const init = `Content-Length: ${initBody.length}\r\n\r\n${initBody}`;
      await writer.write(new TextEncoder().encode(init));

      // Read the initialize response.
      const reader = child.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!buffer.includes("\r\n\r\n")) {
        const { value, done } = await reader.read();
        if (done) throw new Error("server closed before responding");
        buffer += decoder.decode(value, { stream: true });
      }
      const headerEnd = buffer.indexOf("\r\n\r\n");
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(
        buffer.slice(0, headerEnd),
      );
      if (!lengthMatch) throw new Error("no content-length header");
      const contentLength = parseInt(lengthMatch[1], 10);
      while (buffer.length < headerEnd + 4 + contentLength) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      const body = buffer.slice(headerEnd + 4, headerEnd + 4 + contentLength);
      const response = JSON.parse(body);
      assertEquals(response.id, 1);
      assertEquals(typeof response.result, "object");
      // Capabilities object should include textDocumentSync
      const caps = response.result.capabilities as Record<string, unknown>;
      assertEquals(caps.textDocumentSync, 1);

      // Send shutdown + exit so the server exits cleanly.
      const shutdownBody = JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "shutdown",
        params: null,
      });
      await writer.write(
        new TextEncoder().encode(
          `Content-Length: ${shutdownBody.length}\r\n\r\n${shutdownBody}`,
        ),
      );
      const exitBody = JSON.stringify({
        jsonrpc: "2.0",
        method: "exit",
        params: null,
      });
      await writer.write(
        new TextEncoder().encode(
          `Content-Length: ${exitBody.length}\r\n\r\n${exitBody}`,
        ),
      );
      await writer.close();
      reader.releaseLock();
    } finally {
      try {
        child.kill();
      } catch { /* already exited */ }
      await child.status;
    }
  },
});
```

- [ ] **Step 2: Run the test (requires dist/markspec to exist)**

Run from repo root:
`just compile && deno test --allow-run --allow-read tests/e2e/lsp_compiled_test.ts`
Expected: 1 test passes. If `dist/markspec` doesn't exist, the test is skipped.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/lsp_compiled_test.ts
git commit -m "test(e2e): smoke test the compiled markspec binary's lsp subcommand"
```

---

## Phase 3 — Diagnostic layers

This phase adds the three diagnostic layers from the spec: env-var debug log,
output-channel error forwarding, and status bar item.

### Task 10: `debug_log.ts` module

**Files:**

- Create: `packages/markspec/lsp/debug_log.ts`
- Create: `packages/markspec/lsp/debug_log_test.ts`

- [ ] **Step 1: Write `packages/markspec/lsp/debug_log.ts`**

```typescript
/**
 * @module lsp/debug_log
 *
 * Append-only debug log for LSP lifecycle events. Activated by the
 * MARKSPEC_LSP_DEBUG_LOG environment variable; otherwise a no-op.
 *
 * Stderr is intercepted by the LSP framework, and the framework's own error
 * handlers swallow exceptions silently. This module lets us recover crash
 * information after the fact by writing to a file we control.
 */

const ENV_KEY = "MARKSPEC_LSP_DEBUG_LOG";

let logPath: string | undefined;
let initialized = false;

function lazyInit(): void {
  if (initialized) return;
  initialized = true;
  const value = Deno.env.get(ENV_KEY);
  if (value && value.length > 0) {
    logPath = value;
  }
}

/** Append a timestamped event to the debug log. No-op if env var is unset. */
export function debugLog(event: string): void {
  lazyInit();
  if (!logPath) return;
  try {
    Deno.writeTextFileSync(
      logPath,
      `[${new Date().toISOString()}] ${event}\n`,
      { append: true },
    );
  } catch {
    // Cannot write the log — there's no fallback (stderr is intercepted).
    // Drop the event silently rather than crash the server.
  }
}

/** Returns the configured log path, or undefined. For testing. */
export function getDebugLogPath(): string | undefined {
  lazyInit();
  return logPath;
}

/** Reset the cached env-var read. Test-only. */
export function _resetDebugLog(): void {
  initialized = false;
  logPath = undefined;
}
```

- [ ] **Step 2: Write `packages/markspec/lsp/debug_log_test.ts`**

```typescript
import { assertEquals, assertStringIncludes } from "@std/assert";
import { _resetDebugLog, debugLog, getDebugLogPath } from "./debug_log.ts";

Deno.test("debug_log: no-op when env var is unset", () => {
  Deno.env.delete("MARKSPEC_LSP_DEBUG_LOG");
  _resetDebugLog();
  assertEquals(getDebugLogPath(), undefined);
  // Does not throw.
  debugLog("noop");
});

Deno.test("debug_log: writes timestamped lines when env var is set", async () => {
  const path = await Deno.makeTempFile({ suffix: ".log" });
  try {
    Deno.env.set("MARKSPEC_LSP_DEBUG_LOG", path);
    _resetDebugLog();
    debugLog("first event");
    debugLog("second event");
    const content = await Deno.readTextFile(path);
    const lines = content.trim().split("\n");
    assertEquals(lines.length, 2);
    assertStringIncludes(lines[0], "first event");
    assertStringIncludes(lines[1], "second event");
    // ISO-8601 prefix
    const isoMatch = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/.test(
      lines[0],
    );
    assertEquals(isoMatch, true);
  } finally {
    Deno.env.delete("MARKSPEC_LSP_DEBUG_LOG");
    _resetDebugLog();
    await Deno.remove(path);
  }
});

Deno.test("debug_log: empty env var value is treated as unset", () => {
  Deno.env.set("MARKSPEC_LSP_DEBUG_LOG", "");
  _resetDebugLog();
  assertEquals(getDebugLogPath(), undefined);
  Deno.env.delete("MARKSPEC_LSP_DEBUG_LOG");
});
```

- [ ] **Step 3: Run the tests**

Run:
`deno test --allow-read --allow-write --allow-env packages/markspec/lsp/debug_log_test.ts`
Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/markspec/lsp/debug_log.ts packages/markspec/lsp/debug_log_test.ts
git commit -m "feat(lsp): MARKSPEC_LSP_DEBUG_LOG env-var-gated lifecycle logging"
```

### Task 11: Wire `debug_log` into `server.ts` lifecycle hooks

**Files:**

- Modify: `packages/markspec/lsp/server.ts`

- [ ] **Step 1: Import and instrument key lifecycle points**

Add the import near the other local imports:

```typescript
import { debugLog } from "./debug_log.ts";
```

Then add lifecycle hooks. The block references `connection`, so it must be
placed **after** the existing
`const documents = new TextDocuments(TextDocument);` line. Insert this block
immediately after that line:

```typescript
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
```

In `connection.onInitialize`, add `debugLog("onInitialize: start")` at the top
of the handler and `debugLog("onInitialize: end")` immediately before `return`.

In `connection.onInitialized`, add `debugLog("onInitialized: start")` at the
top, `debugLog(\`onInitialized: indexed \${files.length}
files\`)`after the indexing log, and`debugLog("onInitialized: end")` before the
function exits.

In `connection.onShutdown`, add `debugLog("onShutdown")` at the top.

Add a new `connection.onExit` handler if one doesn't exist:

```typescript
connection.onExit(() => {
  debugLog("onExit");
});
```

- [ ] **Step 2: Type-check**

Run: `deno check packages/markspec/lsp/server.ts` Expected: no errors.

- [ ] **Step 3: Smoke-test by spawning with debug log enabled**

```bash
rm -f /tmp/markspec-test-log
MARKSPEC_LSP_DEBUG_LOG=/tmp/markspec-test-log /Users/sebastientasson/.deno/bin/deno run \
  --allow-read --allow-write --allow-env --allow-run \
  packages/markspec/main.ts lsp --stdio < /dev/null
cat /tmp/markspec-test-log
```

Expected: log file contains `server starting`, `onInitialize: start`/`end` (only
if initialize was sent — won't be in this test), and the timestamps are valid
ISO-8601.

- [ ] **Step 4: Commit**

```bash
git add packages/markspec/lsp/server.ts
git commit -m "feat(lsp): wire debug log into server lifecycle and uncaught error handlers"
```

### Task 12: Server emits `markspec/indexed` notification

**Files:**

- Modify: `packages/markspec/lsp/server.ts`

The status bar item (Task 14) needs a signal that initial indexing is complete.
The vscode-languageclient state events tell us "running" but not "ready." A
custom `markspec/indexed` notification fills the gap.

- [ ] **Step 1: Send the notification after the first `publishAllDiagnostics` in
      `onInitialized`**

In `connection.onInitialized`, after the existing `publishAllDiagnostics()`
call, add:

```typescript
connection.sendNotification("markspec/indexed", {
  files: files.length,
  entries: index.getAllEntries().length,
});
```

- [ ] **Step 2: Type-check and run existing LSP tests**

```bash
deno check packages/markspec/lsp/server.ts
deno test --allow-run --allow-read --allow-write --allow-env tests/e2e/lsp_lifecycle_test.ts
```

Expected: type check clean, existing tests pass (the new notification is
additive).

- [ ] **Step 3: Commit**

```bash
git add packages/markspec/lsp/server.ts
git commit -m "feat(lsp): emit markspec/indexed notification after initial diagnostics pass"
```

### Task 13: Status bar item module (extension)

**Files:**

- Create: `editors/vscode/src/statusBar.ts`

- [ ] **Step 1: Write `editors/vscode/src/statusBar.ts`**

```typescript
/**
 * @module statusBar
 *
 * Status bar item showing the LSP health. Driven by LanguageClient state
 * transitions plus the server's custom `markspec/indexed` notification.
 *
 *   ⟳  starting / restarting / indexing
 *   ✓  ready (initial indexing complete)
 *   ✗  failed / stopped unexpectedly
 *
 * Click action opens the MarkSpec output channel.
 */

import {
  type ExtensionContext,
  MarkdownString,
  StatusBarAlignment,
  type StatusBarItem,
  ThemeColor,
  window,
} from "vscode";
import { type LanguageClient, State } from "vscode-languageclient/node";

const COMMAND_SHOW_OUTPUT = "markspec.showOutput";

export function createStatusBar(
  context: ExtensionContext,
  client: LanguageClient,
): StatusBarItem {
  const item = window.createStatusBarItem(StatusBarAlignment.Right, 100);
  item.command = COMMAND_SHOW_OUTPUT;

  setStarting(item);
  item.show();

  client.onDidChangeState((event) => {
    if (event.newState === State.Starting) setStarting(item);
    else if (event.newState === State.Stopped) setFailed(item);
    // State.Running alone doesn't mean indexing complete — wait for
    // markspec/indexed notification.
  });

  client.onNotification("markspec/indexed", (params) => {
    setReady(
      item,
      (params as { files: number; entries: number } | undefined) ??
        { files: 0, entries: 0 },
    );
  });

  context.subscriptions.push(
    item,
    {
      dispose: () => item.dispose(),
    },
  );

  return item;
}

function setStarting(item: StatusBarItem): void {
  item.text = "$(sync~spin) MarkSpec";
  item.tooltip = "MarkSpec LSP starting…";
  item.backgroundColor = undefined;
}

function setReady(
  item: StatusBarItem,
  params: { files: number; entries: number },
): void {
  item.text = "$(check) MarkSpec";
  const tooltip = new MarkdownString();
  tooltip.appendMarkdown("**MarkSpec LSP** ready\n\n");
  tooltip.appendMarkdown(
    `Indexed ${params.files} files, ${params.entries} entries.`,
  );
  item.tooltip = tooltip;
  item.backgroundColor = undefined;
}

function setFailed(item: StatusBarItem): void {
  item.text = "$(error) MarkSpec";
  item.tooltip = "MarkSpec LSP not running. Click to view output.";
  item.backgroundColor = new ThemeColor("statusBarItem.errorBackground");
}
```

- [ ] **Step 2: Compile**

Run: `cd editors/vscode && npm run compile` Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add editors/vscode/src/statusBar.ts
git commit -m "feat(vscode): status bar item module showing LSP health"
```

### Task 14: Wire status bar into `extension.ts` and register the command

**Files:**

- Modify: `editors/vscode/src/extension.ts`
- Modify: `editors/vscode/package.json`

- [ ] **Step 1: Register the command in `package.json`**

In `editors/vscode/package.json`, add to `contributes`:

```json
"commands": [
  {
    "command": "markspec.showOutput",
    "title": "MarkSpec: Show Output",
    "category": "MarkSpec"
  }
]
```

(If `commands` already exists, append to the array; otherwise add it next to
`configuration`.)

- [ ] **Step 2: Update `extension.ts` to create the output channel, register the
      command, and wire the status bar**

Replace the `activate` function body. The full updated file:

```typescript
import {
  commands,
  type ExtensionContext,
  type OutputChannel,
  window,
  workspace,
} from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
} from "vscode-languageclient/node";
import { resolveServerOptions } from "./serverOptions";
import { createStatusBar } from "./statusBar";

let client: LanguageClient | undefined;
let outputChannel: OutputChannel | undefined;

export function activate(context: ExtensionContext): void {
  const config = workspace.getConfiguration("markspec");
  const traceLevel = config.get<string>("trace.server", "off");

  outputChannel = window.createOutputChannel("MarkSpec");
  context.subscriptions.push(outputChannel);

  const workspaceFolder = workspace.workspaceFolders?.[0]?.uri.fsPath;

  const serverOptions = resolveServerOptions({
    extensionPath: context.extensionPath,
    workspaceFolder,
    configuredServerPath: config.get<string>("server.path") || undefined,
    configuredServerArgs: config.get<string[]>("server.args"),
    debugLogPath: config.get<string>("trace.debugLog") || undefined,
    platform: process.platform,
  });

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "markdown" },
      { scheme: "file", language: "rust" },
      { scheme: "file", language: "kotlin" },
      { scheme: "file", language: "java" },
      { scheme: "file", language: "c" },
      { scheme: "file", language: "cpp" },
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/*.md"),
    },
    outputChannel,
    traceOutputChannel: traceLevel !== "off"
      ? window.createOutputChannel("MarkSpec LSP")
      : undefined,
  };

  client = new LanguageClient(
    "markspec",
    "MarkSpec",
    serverOptions,
    clientOptions,
  );

  context.subscriptions.push(
    commands.registerCommand("markspec.showOutput", () => {
      outputChannel?.show();
    }),
  );

  client.start();

  createStatusBar(context, client);

  context.subscriptions.push({
    dispose: () => {
      client?.stop();
    },
  });
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
```

- [ ] **Step 3: Compile and run unit tests**

```bash
cd editors/vscode && npm run compile && npm test
```

Expected: compile clean, all 8 unit tests pass.

- [ ] **Step 4: Reload VS Code window and verify the status bar appears**

Cmd+Shift+P → "Developer: Reload Window". Check the status bar (right-hand
side). You should see:

- briefly: `⟳ MarkSpec`
- then (after indexing): `✓ MarkSpec`
- click it → "MarkSpec" output channel opens.

- [ ] **Step 5: Commit**

```bash
git add editors/vscode/src/extension.ts editors/vscode/package.json
git commit -m "feat(vscode): wire LSP status bar item and showOutput command"
```

---

## Phase 4 — CI: per-platform binaries and VSIX assets

This phase extends the existing release workflow to cross-compile per-platform
binaries, bundle them into per-platform VSIX files, and attach the VSIX files to
the GitHub release.

### Task 15: Add `windows-latest` to release workflow

**Files:**

- Modify: `.github/workflows/release.yaml`

- [ ] **Step 1: Add the windows entry to the build matrix**

In `.github/workflows/release.yaml`, locate the `build.strategy.matrix.include`
array. Add:

```yaml
- target: x86_64-pc-windows-msvc
  os: windows-latest
  binary: markspec.exe
```

- [ ] **Step 2: Verify the package step handles `.exe`**

The existing step uses
`tar czf markspec-${{ matrix.target }}.tar.gz ${{ matrix.binary }}` — this works
on Windows runners as long as `tar` is available (Windows runners have `bsdtar`
available as `tar` since 2018). Test by triggering a manual workflow run on a
feature branch (you can do this once Task 19 is committed; for now, just commit
the matrix addition).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yaml
git commit -m "ci(release): add windows-latest to per-platform binary build matrix"
```

### Task 16: New CI job — package per-platform VSIX

**Files:**

- Modify: `.github/workflows/release.yaml`

This adds a job that runs after the per-platform binary build. For each
platform, it downloads the binary artifact, drops it into `editors/vscode/bin/`,
runs `vsce package --target <vscode-target>`, and uploads the resulting `.vsix`
as a release-job artifact.

- [ ] **Step 1: Add the `package-vsix` job between `build` and `release`**

Insert after the `build` job (before `release`):

```yaml
package-vsix:
  name: Package VSIX (${{ matrix.target }})
  needs: build
  runs-on: ubuntu-latest
  strategy:
    matrix:
      include:
        - target: x86_64-unknown-linux-gnu
          vsce-target: linux-x64
          binary: markspec
        - target: x86_64-apple-darwin
          vsce-target: darwin-x64
          binary: markspec
        - target: aarch64-apple-darwin
          vsce-target: darwin-arm64
          binary: markspec
        - target: x86_64-pc-windows-msvc
          vsce-target: win32-x64
          binary: markspec.exe
  steps:
    - uses: actions/checkout@v4

    - uses: denoland/setup-deno@v2
      with:
        deno-version: v2.x

    - uses: actions/setup-node@v6
      with:
        node-version: lts/*

    - name: Download binary artifact
      uses: actions/download-artifact@v4
      with:
        name: markspec-${{ matrix.target }}
        path: artifacts

    - name: Extract binary
      run: |
        cd artifacts
        tar xzf markspec-${{ matrix.target }}.tar.gz

    - name: Bundle binary into extension
      run: |
        deno run --allow-read --allow-write \
          editors/vscode/scripts/bundleBinary.ts \
          --source artifacts/${{ matrix.binary }} \
          --name ${{ matrix.binary }}

    - name: Install extension deps
      run: cd editors/vscode && npm ci

    - name: Compile extension
      run: cd editors/vscode && npm run compile

    - name: Package VSIX
      run: |
        cd editors/vscode
        npx vsce package --target ${{ matrix.vsce-target }} \
          --out markspec-ide-${{ matrix.vsce-target }}.vsix

    - name: Upload VSIX
      uses: actions/upload-artifact@v7
      with:
        name: markspec-ide-${{ matrix.vsce-target }}-vsix
        path: editors/vscode/markspec-ide-${{ matrix.vsce-target }}.vsix
```

- [ ] **Step 2: Update the `release` job to depend on `package-vsix` and include
      VSIX assets**

In the existing `release` job, change `needs: build` to
`needs: [build, package-vsix]`. Update the `softprops/action-gh-release@v2`
step's `files` to include `*.vsix`:

```yaml
files: |
  artifacts/*.tar.gz
  artifacts/*.sha256
  artifacts/*.vsix
```

- [ ] **Step 3: Verify the YAML is syntactically valid**

Run: `deno run -A npm:js-yaml .github/workflows/release.yaml > /dev/null`
Expected: exits 0 (no parse errors). If the `js-yaml` import fails, install with
`npm install -g js-yaml` or use `yamllint` if available.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yaml
git commit -m "ci(release): build per-platform VSIX files and attach to release"
```

### Task 17: Update CONTRIBUTING.md with dev-mode workflow

**Files:**

- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Locate the existing "Setup" or equivalent section**

Read `CONTRIBUTING.md`. Find the section that documents the local dev setup.

- [ ] **Step 2: Add a "VS Code extension development" subsection**

Append (or insert into an appropriate parent section):

````markdown
## VS Code extension development

The repo is configured for dev-mode LSP. The committed `.vscode/settings.json`
points the extension at `deno run packages/markspec/main.ts lsp` so changes to
the LSP source take effect on every VS Code reload — no rebuild required.

First-time setup:

```bash
cd editors/vscode
npm install
npm run compile
code --install-extension <path-to-built-vsix>  # or use F5 from editors/vscode
```
````

To work on the _extension itself_ (not the LSP server):

1. Open `editors/vscode/` in VS Code.
2. Press F5 — opens an Extension Development Host window with the extension
   loaded.
3. In the host window, open the markspec repo. The dev-mode LSP runs against
   live source.

To debug LSP crashes, set `markspec.trace.debugLog` to a writable file path in
your workspace settings. Lifecycle events and uncaught errors land there.

````
- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs(contributing): document VS Code dev-mode LSP workflow"
````

---

## Phase 5 — Cleanup and verification

### Task 18: Remove `--no-dependencies` from package script (defensive)

**Files:**

- Modify: `editors/vscode/package.json`

The `npm run package` script was already updated in Task 5
(`"package": "npm run bundle && vsce package"`). Verify there's no remaining
`--no-dependencies`.

- [ ] **Step 1: Grep for stragglers**

Run: `grep -n "no-dependencies" editors/vscode/package.json` Expected: no
matches.

- [ ] **Step 2: If found, remove**

If grep returned a line, edit `editors/vscode/package.json` to drop
`--no-dependencies`. Otherwise this task is a no-op confirmation.

- [ ] **Step 3: Commit if any change**

```bash
git diff --quiet editors/vscode/package.json || git add editors/vscode/package.json && git commit -m "chore(vscode): ensure package script bundles dependencies"
```

### Task 19: Full test sweep

**Files:** none (verification only)

- [ ] **Step 1: Run full Deno test suite**

```bash
deno test --allow-run --allow-read --allow-write --allow-env
```

Expected: all tests pass, including new ones from Tasks 8, 9, 10.

- [ ] **Step 2: Run extension unit tests**

```bash
cd editors/vscode && npm test
```

Expected: all 8 tests pass.

- [ ] **Step 3: Run type check + lint**

```bash
just check
just lint
```

Expected: 0 errors.

- [ ] **Step 4: Build the binary and verify the smoke test runs against it**

```bash
just compile
deno test --allow-run --allow-read tests/e2e/lsp_compiled_test.ts
```

Expected: 1 test passes (no longer skipped).

- [ ] **Step 5: Build a local VSIX and install it**

```bash
cd editors/vscode
npm run package
code --install-extension markspec-ide-*.vsix --force
```

Reload VS Code window, open `tests/fixtures/requirement-block.md`. Confirm:

- Status bar shows `✓ MarkSpec`.
- Typing `- [` in a fresh line offers a completion.
- `Satisfies: SYS_NOPE_9999` shows a red squiggle within ~1 second.

- [ ] **Step 6: Commit any final cleanup**

```bash
git status
# If anything remains uncommitted, address it. Otherwise:
git log --oneline -20
```

Verify all changes from this plan are on the branch.

---

## Verification checklist (success criteria from spec)

After completing all tasks, validate against the spec's success criteria:

- [ ] **SC1 — User installs VSIX, sees diagnostics within 30 seconds.** Build a
      local VSIX, install on a clean test workspace (or just reload), open a
      `.md` file with at least one entry, verify diagnostics appear.

- [ ] **SC2 — Contributor clones, runs `just build`, opens VS Code, dev mode
      just works.** Test by removing `editors/vscode/node_modules` and
      `editors/vscode/out`, then running `just build`, opening VS Code, and
      confirming the LSP starts without manual config.

- [ ] **SC3 — Each of the five 2026-05-02 bugs has a test.**
  - Bug 1 (no transport bound): covered by Task 9 (compiled smoke test asserts
    initialize response).
  - Bug 2 (deps missing): covered indirectly by Task 19.5 (real VSIX install) —
    would fail to activate.
  - Bug 3 (`${workspaceFolder}` not expanded): covered by Task 2 (serverOptions
    test).
  - Bug 4 (`--stdio` rejected): covered by Task 9 (compiled smoke test passes
    `--stdio`).
  - Bug 5 (`--allow-run` watchdog): covered by Task 8 (lifecycle test).

- [ ] **SC4 — When the LSP crashes, status bar turns red and clicking opens
      logs.** Manually verify by killing the LSP process while VS Code is
      running (`pkill -f main.ts`) and confirming the status bar updates within
      5 seconds and clicking opens the output channel.

---

## Notes on execution

- Each task is independently committable; commit after every task.
- Tasks within a phase must be done in order. Phases 1-4 are also ordered (Phase
  1 unblocks Phase 2 because the extension test infrastructure is set up; Phase
  3 needs the server module structure from Phase 1).
- Phase 4 (CI) can technically run in parallel with Phase 3, but linearizing
  keeps the cognitive load lower.
- If any test added in Phase 2 fails on first run, treat that as
  bug-find-not-test-bug and investigate the underlying server/extension issue
  before adjusting the test.
