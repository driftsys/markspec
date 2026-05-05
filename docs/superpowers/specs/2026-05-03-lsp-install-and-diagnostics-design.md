# LSP install, spawn, and diagnostics design

**Status:** Approved **Date:** 2026-05-03 **Owner:** sebastien.tasson **Related
work:** [2026-04-23-lsp-server-design.md](2026-04-23-lsp-server-design.md)

## Problem

The MarkSpec LSP works on the author's machine and nowhere else. A debugging
session on 2026-05-02 surfaced five stacked bugs in the install/spawn path:

1. Server crashed on spawn — `createConnection(features)` with no transport.
2. Extension activation failed — `.vsix` packaged with `--no-dependencies`,
   missing `vscode-languageclient`.
3. `${workspaceFolder}` not expanded in extension args — VS Code only expands
   variables for built-in launch configs.
4. Cliffy rejected the `--stdio` flag that vscode-languageclient appends.
5. Deno's `process.kill(pid, 0)` requires `--allow-run`; the LSP framework's
   parent-process watchdog interpreted the resulting permission error as "parent
   died" and exited 1 every 3 seconds.

None were caught by the existing test suite because:

- The extension-side bugs (1, 2, 3, 4) lived in the spawn contract between the
  extension and the server, which was never tested.
- The watchdog bug (5) was missed because the existing lifecycle tests pass
  `processId: null` in `initialize`, which prevents the watchdog from ever
  activating. In real VS Code the `processId` is the extension host PID, so the
  watchdog runs.

The bugs surfaced as silent failures: stderr is intercepted by the LSP
framework, the watchdog catches its own exception, the only signal was "Server
process exited with code 1" repeated until VS Code gave up after five restarts.
Diagnosis required reading vscode-languageserver source code.

This design fixes the spawn path, makes failures visible, and tests the contract
so the next contributor doesn't repeat the experience.

## Audiences

Two distinct audiences, served by separate spawn paths within one extension:

- **End users** — industrial doc engineers using MarkSpec on a project. They
  install the extension VSIX (from a GitHub release for v1, eventually from the
  marketplace), open a `.md` file, expect everything to work. They do not have
  Deno installed and never read CLI logs.
- **MarkSpec contributors** — developers working on the toolchain itself. They
  have Deno, run `just build`, want fast iteration on LSP code without
  rebuilding a binary on every change.

## Distribution

### User mode (default)

The extension bundles the compiled `markspec` binary per platform. CI produces
four per-platform `.vsix` files:

- `markspec-ide-X.Y.Z-darwin-arm64.vsix`
- `markspec-ide-X.Y.Z-darwin-x64.vsix`
- `markspec-ide-X.Y.Z-linux-x64.vsix`
- `markspec-ide-X.Y.Z-win32-x64.vsix`

**Distribution for v1 is GitHub release assets, not the marketplace.** Users
install with `code --install-extension <downloaded.vsix>`. Marketplace
publication is deferred until v0.1 of MarkSpec ships and the install flow has
been used by at least one non-author teammate. The bundle-per-platform design
holds whether the VSIX comes from the marketplace or a release page.

Layout inside the unpacked extension:

```text
~/.vscode/extensions/driftsys.markspec-ide-X.Y.Z/
├── package.json
├── out/extension.js
├── node_modules/        ← vscode-languageclient and friends
└── bin/
    └── markspec         ← the deno-compiled binary for this platform
```

The extension spawns `bin/markspec lsp` directly. The compiled binary embeds the
permissions granted at compile time
(`--allow-read --allow-write --allow-run --allow-env --allow-ffi`), so the
runtime spawn needs no Deno permission flags. This eliminates bugs 4 and 5 by
construction.

**Updates for v1 are manual.** Users redownload the VSIX from the release page
and reinstall. Once we publish to the marketplace, VS Code's built-in extension
auto-update takes over (same model as `rust-analyzer`, `vscode-typescript`,
`deno-vscode`) — no separate binary update channel needed at that point. The
bundled binary's lifecycle is the extension's lifecycle in both cases.

**Air-gapped users** — corporate networks (automotive, aerospace) often block
external network calls at runtime. Bundling the binary in the VSIX means the
extension works without network access after install. This is a deliberate goal,
not a side effect.

### Developer mode (opt-in)

Developers set `markspec.server.path` in their workspace settings to override
the bundled binary. Conventional values:

```json5
{
  // Use system deno against live source (fastest iteration)
  "markspec.server.path": "deno",
  "markspec.server.args": [
    "run",
    "--allow-read",
    "--allow-env",
    "--allow-run",
    "${workspaceFolder}/packages/markspec/main.ts",
    "lsp",
  ],
  "markspec.trace.server": "verbose",
}
```

The extension treats `markspec.server.path` as authoritative when set; otherwise
falls back to the bundled binary at `<extensionPath>/bin/markspec`. Mirrors
`rust-analyzer.server.path`.

`${workspaceFolder}` substitution must be performed by the extension, not
assumed from VS Code — bug 3 is solved by code in the extension, not by a
settings convention.

**For this repository specifically**, `.vscode/settings.json` is committed with
the dev-mode incantation above. Every contributor working on the markspec
toolchain itself wants dev mode — it's the default for this repo. The committed
settings rely on `${workspaceFolder}` (resolved by the extension), so the file
is portable across clones. The hardcoded absolute path that briefly lived in
this file during the 2026-05-02 debugging session is replaced.

For repositories that _use_ MarkSpec (downstream projects), the recommendation
is the opposite: `.vscode/settings.json` is not committed, the bundled binary
runs unconfigured. Dev-mode is only relevant in this repo.

### CI build process

The `just compile` target produces one binary for the host platform. CI replaces
this with a matrix:

```yaml
matrix:
  - { os: macos-14, target: aarch64-apple-darwin, asset: darwin-arm64 }
  - { os: macos-13, target: x86_64-apple-darwin, asset: darwin-x64 }
  - { os: ubuntu-22.04, target: x86_64-unknown-linux-gnu, asset: linux-x64 }
  - { os: windows-latest, target: x86_64-pc-windows-msvc, asset: win32-x64 }
```

`deno compile --target <triple>` cross-compiles. Per-platform binaries are
placed in `editors/vscode/bin/markspec`, the extension is packaged with
`vsce package --target <vscode-target>`, and the four `.vsix` files are attached
to the GitHub release as assets. (When marketplace publication unblocks, the
same artifacts go through `vsce publish` instead — no rebuild required.)

Local extension build for development uses the host-platform binary only (no
cross-compile in `just build`).

## Crash visibility

The diagnostic story has three layers, each cheap to build, each catching a
different failure class.

### Layer 1 — Debug log file (opt-in via env var)

When `MARKSPEC_LSP_DEBUG_LOG` is set to a writable path, the server appends
timestamped lifecycle events to that file. Always-on equivalents would burn
permissions and disk; opt-in keeps the default footprint zero.

Events logged:

- Server start (PID, args, transport mode).
- `connection.onInitialize` start and end.
- `connection.onInitialized` start, indexed file count, end.
- `publishAllDiagnostics` invocation count and duration.
- `connection.onShutdown` and `connection.onExit` (so silent watchdog kills are
  distinguishable from clean shutdowns).
- All uncaught errors and unhandled rejections, with stack.

Configured via the existing `markspec.server.args` for dev mode, or via the
user-mode extension passing `MARKSPEC_LSP_DEBUG_LOG` through `process.env` if a
`markspec.trace.debugLog` setting is set.

This replaces the ad-hoc `dbg()` instrumentation we added during the 2026-05-02
debugging session — it lives in the codebase permanently behind the env-var
switch instead of being added and removed each time.

### Layer 2 — Output channel forwarding

The "MarkSpec" output channel already exists. Today it carries
`connection.console.log/warn/error` output. Two additions:

- A top-level `globalThis.addEventListener("unhandledrejection", ...)` that
  forwards the rejection to `connection.console.error` instead of letting it
  crash silently.
- The same for `addEventListener("error", ...)`.

When forwarding fails (because the connection itself is broken), fall back to
writing to `MARKSPEC_LSP_DEBUG_LOG` if set, else give up — at that point the
process is already terminating.

### Layer 3 — Status bar item

The extension adds a status bar item showing LSP health:

- `MarkSpec ✓` (foreground default) — server alive, indexing complete.
- `MarkSpec ⟳` — server starting or reindexing.
- `MarkSpec ✗` (foreground red) — server crashed or never started.

Click action opens the "MarkSpec" output channel. This gives the user a
permanent, visible signal that the LSP is or isn't working — which would have
shortened the 2026-05-02 debugging session by an hour.

State transitions are driven by `LanguageClient` state events
(`onDidChangeState`) plus a custom `markspec/indexed` notification the server
sends after `publishAllDiagnostics` completes the initial indexing pass.

## Test strategy

Three test layers, each catching a class of bug the existing suite missed.

### Spawn-contract tests (extension-side)

A new `editors/vscode/src/extension.test.ts` runs under `npm test` (vitest or
`node --test`). It:

- Constructs `ServerOptions` for both modes (bundled binary, dev-mode
  `markspec.server.path` set).
- Asserts the exact `command`, `args`, and `transport` for each.
- Verifies `${workspaceFolder}` substitution happens in the extension, not
  relied on from VS Code.
- Verifies the bundled-binary path resolves correctly relative to `__dirname`.

This catches:

- Bug 3 (`${workspaceFolder}` not expanded) — directly.
- Bug 2 (missing deps in `.vsix`) — indirectly, by importing
  `vscode-languageclient` in the test (would fail at import time if missing).
- Future regressions where someone changes the spawn args without checking both
  modes.

### Permission-restricted lifecycle test (Deno-side)

A new test in `tests/e2e/lsp_lifecycle_test.ts` that spawns the LSP via
`deno run` with the _minimum_ permission set the dev-mode spawn uses
(`--allow-read --allow-write --allow-env --allow-run`) and passes a real, alive
`processId` in `initialize` (e.g., `Deno.pid`). It sends `initialize` +
`initialized`, waits 5 seconds (past the 3-second watchdog window), then sends
`shutdown` + `exit` and asserts:

- The server is still responsive at the 5-second mark.
- The server exits cleanly (code 0) after `exit`.

The combination of {real processId, restricted permissions} is what makes this
test catch bug 5. Existing tests pass `processId: null`, so the watchdog never
starts. Stripping `--allow-run` from a test that passes `processId: null` would
still pass — both conditions matter.

This catches:

- Bug 5 (`process.kill` permission) — directly.
- Future regressions where someone tightens the spawn permissions.
- Future regressions where the watchdog or another framework component starts
  requiring a permission we don't grant.

### Compiled-binary smoke test (CI)

After the per-platform `deno compile` step in CI, run a smoke test against the
compiled binary:

- `<binary> lsp` with stdin closed → asserts exit code matches the no-input
  baseline (whatever that is — likely 1 because no shutdown was sent, but the
  test pins it).
- `<binary> lsp` with `initialize` + `shutdown` + `exit` over stdio → asserts
  exit 0 and a valid `initialize` response.
- `<binary> --version` → asserts version matches the expected release.

This catches:

- Bug 1 (no transport bound) — would fail on the initialize-response assertion.
- Bug 4 (`--stdio` rejected) — would fail at startup.
- Future regressions where the compiled binary diverges from the source-run
  binary (e.g., a missing `--include` for embedded assets).

The existing test suite runs against `deno run` in source mode and would not
catch these.

## Migration plan

The five-bug debugging session on 2026-05-02 was committed to a feature branch.
This design replaces those fixes with the proper architecture in the same
branch:

1. Replace the hardcoded absolute path in `.vscode/settings.json` with
   `${workspaceFolder}` so it's portable across contributor clones. Keep the
   file committed (this repo's contributors all want dev mode).
2. Keep `--allow-run` in `markspec.server.args` for dev mode — it's required by
   the parent-process watchdog when running via `deno run`. The bundled binary
   still doesn't need it because compile-time permissions cover that path.
3. Remove ad-hoc `dbg()` instrumentation from `lsp/server.ts` (already done) and
   replace with the `MARKSPEC_LSP_DEBUG_LOG` env-var-gated equivalent.
4. Add the per-platform CI build matrix.
5. Add the three test layers.
6. Update `editors/vscode/src/extension.ts` to:
   - Resolve `markspec.server.path` if set, else fall back to bundled
     `bin/markspec`.
   - Perform `${workspaceFolder}` substitution explicitly.
   - Wire the status bar item.
7. Update `editors/vscode/package.json` `package` script to drop
   `--no-dependencies`.

## Out of scope

- **Marketplace publication.** v1 ships VSIX files as GitHub release assets
  only. Marketplace publication unblocks once v0.1 of MarkSpec ships and the
  install flow has been validated by a non-author teammate. The bundle-per-
  platform architecture works identically in both modes.
- **Auto-update channel beyond the marketplace.** When marketplace publication
  happens, its cadence is sufficient. If LSP-bugfix latency becomes a real
  problem after that, add a GitHub-release auto-update layer on top —
  non-breaking.
- **Bundled Deno runtime.** The compiled binary is self-contained via
  `deno compile`; users don't need Deno installed.
- **LSP feature improvements.** Completion quality, additional triggers, etc.
  are tracked separately — this design is exclusively about _how the server
  starts and stays alive_, not what it does once running.
- **Cross-editor support.** This design is VS Code only. A future spec can
  address a generic LSP entry point usable by Neovim, Helix, etc., but it should
  not block this work.

## Success criteria

This design is successful when:

1. A user downloads the VSIX for their platform from the GitHub release page,
   installs it via `code --install-extension`, opens a `.md` file, and sees
   diagnostics within 30 seconds with no terminal interaction beyond the install
   command.
2. A contributor clones the repo, runs `just build`, opens VS Code, and the
   dev-mode LSP runs against live source — no per-machine config required
   because the committed `.vscode/settings.json` uses `${workspaceFolder}`.
3. Each of the five bugs from 2026-05-02 has a test that fails when the bug is
   reintroduced.
4. When the LSP crashes, the user sees a red status bar item within 5 seconds
   and clicks through to a log channel that names the failing component.
