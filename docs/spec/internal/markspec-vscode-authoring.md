# MarkSpec — VS Code Authoring Experience

Status: Draft\
Date: 2026-05-25\
Scope: How the MarkSpec VS Code extension serves the three user cohorts —
requirement authors, developers, maintainers — across CLI bootstrap, live
preview, command palette, webview viewers, tree view, and status bar\
Builds on:
[markspec-toolchain-distribution.md](markspec-toolchain-distribution.md) (single
binary, install surface, version/schema alignment, config-write safety),
[markspec-profile-schema.md](markspec-profile-schema.md) (profile-declared type
vocabulary that drives preview coloring), ADR-005 (CLI architecture), clig.dev
(stream conventions, exit codes), VS Code Extension API (1.85+), markdown-it

This spec defines the **VS Code extension's responsibilities** beyond the LSP
features it already wires up: bootstrapping the CLI when missing, contributing a
live Markdown preview that matches published-book styling, exposing the CLI's
workflows via the Command Palette, hosting webview-based viewers for reports
that can't be expressed inline, and surfacing project health via tree view and
status bar.

It does **not** specify LSP server capabilities (companion work — formatting,
code lens, inlay hints, document links, type hierarchy are server-side and
benefit all LSP clients, including Neovim and Helix; tracked separately as the
"LSP feature additions" epic). It does not cover Neovim, Helix, Zed, or any
other editor — those are served by the LSP server's capability set, by the
`markspec lsp install` command (toolchain-distribution.md §4), or by their own
extensions.

---

## 0. Terminology

| Term                  | Meaning in this spec                                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **the extension**     | The `markspec` VS Code extension shipped from `editors/vscode/`.                                                                                                                                         |
| **the CLI**           | The `markspec` binary the user has on `PATH` (or that the extension has bootstrapped on the user's behalf — §3).                                                                                         |
| **bootstrap install** | The extension's first-activation flow that detects whether the CLI is available and, if not, downloads + installs it from a published GitHub release (§3).                                               |
| **web preview**       | The built-in VS Code Markdown preview (`Ctrl+Shift+V`), enhanced by an extension-contributed markdown-it plugin and CSS so entry blocks render in the published style (§4). The only live preview in v1. |
| **PDF generation**    | A one-shot `Markspec: Build PDF` command that invokes `markspec doc build` and opens the resulting PDF in the user's PDF viewer (§5). Not a live preview.                                                |
| **author**            | A user in the requirement-author cohort (§2) — VS Code only, never touches a terminal.                                                                                                                   |
| **developer**         | A user in the developer cohort (§2) — uses both editor and CLI.                                                                                                                                          |
| **maintainer**        | A user in the maintainer cohort (§2) — primarily CLI; editor is optional.                                                                                                                                |

---

## 1. Scope and boundaries

In scope: the VS Code extension's user-facing surface — what activates on
install, what appears in the Command Palette, how previews render, what panels
populate, what settings exist. Plus the bootstrap install flow that lets the 20%
requirement-author cohort use the tool without ever opening a terminal.

Out of scope (and where each piece is owned):

- **LSP server capabilities.** Formatting (`textDocument/formatting`), code
  lens, inlay hints, document links, type/call hierarchy, and the custom
  `markspec/profile` request live in the LSP server and serve every LSP client.
  Tracked as a separate **"LSP feature additions" epic — prioritized as a v1
  prerequisite for this spec**: without `textDocument/formatting` the
  format-on-save workflow does not exist for authors, and without
  `markspec/profile` the web preview's profile-aware coloring (§4.4) degrades to
  monochrome. This spec _consumes_ those capabilities (the Command Palette's
  `Markspec: Format Document` is a thin wrapper over the LSP request) but does
  not specify them — they ship in parallel.
- **`markspec lsp install` / `markspec mcp install`.** Owned by
  [markspec-toolchain-distribution.md](markspec-toolchain-distribution.md). The
  extension's bootstrap (§3 here) and those CLI install commands are
  **independent** install paths: the CLI install commands serve the 80%
  developer + maintainer cohort who install the CLI first; the extension's
  bootstrap serves the 20% author cohort who install the extension first.
- **Neovim / Helix / Zed.** The LSP server already serves them; per-editor
  packaging is out of v1.
- **Release engineering** (signing, notarization, GitHub release pipeline).
  toolchain-distribution.md §3.4 fixes the boundary; this spec depends on the
  release pipeline producing signed/notarized macOS binaries (Stage 2) for the
  bootstrap flow to avoid Gatekeeper warnings, but does not specify the
  pipeline.
- **CI integration.** Pre-commit hooks, GitLab/GitHub CI examples, release
  workflows — owned by markspec-user-docs.md (Prompt 4) and by the language-pack
  / dependency-ingestion specs.

---

## 2. User segmentation (load-bearing design driver)

The extension serves three cohorts with materially different workflows. The
**author cohort is the load-bearing constraint**: every other cohort can fall
back to the CLI, but authors cannot. If a workflow is not reachable from inside
VS Code, authors do not have it.

| Cohort                  | Share | Touches CLI? | Primary workflows                                                                                                                                                                                                                                                                         |
| ----------------------- | ----- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Requirement authors** | ~20%  | Never        | Edit `.md` files. Need live diagnostics, completions, navigation, format-on-save, live preview that matches the published book, and one-click access to PDF and report generation. Will not type CLI commands; will not configure shells; will not edit JSON config files for the editor. |
| **Developers**          | ~50%  | Sometimes    | Edit `.md` files _and_ source files with doc-comment requirements. Run pre-commit hooks. Want both editor convenience and CLI scripting. Tolerant of a one-time CLI install step; appreciate the extension surfacing both surfaces.                                                       |
| **Maintainers**         | ~30%  | Always       | CI integration, profile authoring, release engineering, scripted reports. Use the editor for navigation and review, but the CLI is the primary tool. The extension is a convenience, not a dependency.                                                                                    |

**Implications for every section that follows:**

- Bootstrap install (§3) MUST work for the author cohort with zero CLI
  knowledge. A failed bootstrap is a failed onboarding.
- Every CLI-backed feature (build, export, report) MUST have a Command Palette
  entry _and_ a webview viewer where appropriate (§6, §7). "Run it in the
  terminal" is not an acceptable instruction for authors.
- Configuration MUST default to working out of the box. Settings are for power
  users; the defaults are for authors (§10).
- Error messages MUST suggest a fix the author can apply from inside VS Code
  (Command Palette action, settings change, marketplace search) — never "run
  this shell command."

---

## 3. CLI bootstrap installation

### 3.1 Activation flow

On extension activation, before starting the LSP client:

1. **Detect.** Look for `markspec` in:
   1. `markspec.server.path` setting (developer override — wins outright if set
      and valid).
   2. A path the extension previously recorded in its `globalState` (a prior
      successful bootstrap — survives extension updates).
   3. The host platform's `PATH`.

2. **If found and version-compatible** (release version on a known channel,
   core-schema version matches what the extension was built against —
   toolchain-distribution.md §3): proceed to start the LSP client.

3. **If found but version-incompatible**: surface a status-bar warning and a
   `Markspec: Update CLI` command (skew detection, toolchain-distribution.md
   §3.3). Do not auto-update silently — that violates §6.3 of the toolchain
   spec's config-write safety ethos.

4. **If not found**: show a notification — "MarkSpec CLI is required for full
   functionality (PDF export, reports, pre-commit hooks). Install now?" with
   actions [Install] [Not now] [Don't ask again]. On [Install]:
   1. Show a progress notification with cancel.
   2. Resolve the latest stable release manifest from a fixed URL
      (`https://github.com/driftsys/markspec/releases/latest/download/manifest.json`
      — exact URL frozen in §10).
   3. Fetch the platform-specific binary, verify its SHA-256 against the
      manifest.
   4. Place it at the install location (§3.2).
   5. Record the path in `globalState`.
   6. If the install location is not already on the user's `PATH`, show a
      separate prompt with a one-click "Add to PATH" action that writes the
      shell-init snippet for the user's detected shell (§3.3).

5. **After install**: verify by running `<path> --version`, confirm the reported
   release + core-schema match what the manifest promised, then start the LSP
   client.

### 3.2 Install location

| Platform          | Default install location                        |
| ----------------- | ----------------------------------------------- |
| macOS, Linux, BSD | `~/.local/bin/markspec`                         |
| Windows           | `%LOCALAPPDATA%\Programs\markspec\markspec.exe` |

Rationale: these are the dominant user-owned binary locations across modern
toolchains (mise, asdf, rustup, deno-install, gh-cli, oh-my-posh all default
here). They survive extension uninstall — a user who later runs
`code --uninstall-extension driftsys.markspec` keeps their CLI. They do not
require elevation. They are platform-conventional, so the "Add to PATH" snippet
is predictable.

Override via the `markspec.cli.installLocation` setting (§10) for restrictive
environments. The setting takes a directory; the binary lives at
`<dir>/markspec` (or `markspec.exe` on Windows).

### 3.3 PATH integration

After install, if the binary's directory is not on `PATH`, the extension shows a
single dismissible notification:

> "MarkSpec CLI installed to `~/.local/bin/markspec`. This directory isn't on
> your PATH — terminal commands like `markspec fmt` won't work yet. [Add to
> PATH] [Skip] [Show snippet]"

- **Add to PATH** detects the user's shell (`SHELL` env, default-shell on Win)
  and appends the appropriate snippet to `~/.bashrc`, `~/.zshrc`,
  `~/.config/fish/config.fish`, or modifies the user environment block on
  Windows. Uses the same managed-block discipline as
  [toolchain-distribution.md §6](markspec-toolchain-distribution.md) — a fenced
  region the extension owns, idempotent, reversible.
- **Show snippet** reveals the snippet in the output channel so the user can
  paste it into their own dotfile setup.
- **Skip** records the choice; the prompt does not return unless the user
  explicitly runs `Markspec: CLI: Configure PATH`.

For the author cohort, **Add to PATH** is the path of least resistance and the
default action. For developers and maintainers, the snippet form is preserved
for those who manage shell init via dotfiles repos.

### 3.4 Updates and uninstall

- **Update.** A `Markspec: Update CLI` command (and an automatic check on
  extension activation, throttled to once per day) compares the installed CLI's
  version against the latest release manifest. On newer-available, the
  notification offers **Update**, **Not now**, **Don't ask again**. The update
  flow reuses §3.1 step 4 from the download step.
- **Skew warning.** When the LSP server's `markspec/version` notification
  (toolchain-distribution.md §3.3) reports a core-schema that does not match the
  extension's expectation, the status bar shows a warning icon. Clicking reveals
  the explanation and an **Update CLI** action.
- **Uninstall (ownership-based).** The extension's rule is simple: **if the
  extension installed the CLI, the extension is responsible for removing it. If
  the user installed the CLI themselves, the extension never touches it.**
  - **Ownership record.** On successful bootstrap install (§3.1), the extension
    writes `{ installedByExtension: true, path, version,
    installedAt }` to
    `globalState`. On a path detected at activation (PATH lookup or
    `markspec.server.path` override), it writes
    `{ installedByExtension: false, path }`. The boolean is the authority for
    everything below.
  - **`Markspec: Uninstall CLI` command — ownership applies.**
    - When `installedByExtension === true`: confirm once ("Remove the MarkSpec
      CLI at `<path>` and the PATH snippet?"), then remove the binary, remove
      the PATH snippet (managed-block reversal per §3.3), and clear the
      `globalState` record. One confirmation, no quick-pick — ownership makes
      the action unambiguous.
    - When `installedByExtension === false`: refuse with an explanation ("The
      CLI at `<path>` was not installed by this extension. Remove it via your
      package manager or by deleting the file directly."). The extension never
      deletes a file it did not install.
  - **Install-time notification.** After a successful bootstrap install, a
    one-time dismissible notification surfaces `Markspec: Uninstall CLI` and
    explains it MUST be run BEFORE uninstalling the extension. Recorded so the
    prompt does not repeat.
  - **Walkthrough item.** `contributes.walkthroughs` includes an "Uninstalling
    MarkSpec" step that documents the cleanup command, visible from the
    marketplace page.
  - **No silent cleanup in `deactivate()`.** VS Code does not differentiate
    uninstall from disable, reload, update, or host shutdown. Silent deletion
    from `deactivate` would fire on every one of those events. The extension
    never removes files outside the explicit `Markspec: Uninstall CLI` flow.
  - **If the user forgets and uninstalls the extension first**: the binary
    persists. `globalState` typically survives extension uninstall in modern VS
    Code (data is keyed by extension id, retained for some time), so on a later
    reinstall the ownership record is recovered and `Markspec: Uninstall CLI`
    works again. If `globalState` has been wiped, the orphan-recovery flow
    re-attaches ownership (see below).
  - **Orphan recovery.** On a later extension reinstall: if a `markspec` binary
    exists at the platform-default install location (§3.2) and no `globalState`
    ownership record is present, the extension prompts "Found existing markspec
    at `<path>` — adopt as a previously- bootstrapped install (subject to
    `Markspec: Uninstall CLI` cleanup), or treat as a user-managed install
    (extension will not touch it)?" The answer sets the ownership flag
    accordingly.

### 3.5 macOS Gatekeeper

Until the release pipeline ships signed and notarized macOS binaries (Stage 2
per toolchain-distribution.md §3.4), the bootstrap flow on macOS will produce a
Gatekeeper prompt on first launch ("`markspec` cannot be opened because the
developer cannot be verified").

The extension MUST anticipate this and, before launching the bootstrapped binary
on macOS, show a notification with a one-line explanation and a **Show me how**
action that opens VS Code's instructions for approving an unsigned binary. After
Stage 2 lands, this path becomes dead code and is removed.

### 3.6 Options analysis

| Alternative                                               | Rejected because                                                                                                                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Download from GitHub releases (**chosen**)                | Same mechanism on every platform; full control over manifest, checksums, and version coupling; no dependency on a platform package manager being installed.            |
| Delegate to brew / scoop / apt / dnf                      | Cleaner UX where installed; fragile when not. ~60% of authors will not have a working `brew install` configuration. Falls back to GitHub releases — strictly worse UX. |
| Bundle the binary in the VSIX (current code's default)    | Forks the binary: extension copy drifts from any CLI the user installed. Contradicts toolchain-distribution.md §2.2 last row.                                          |
| Print a manual install command and exit                   | Onboards the developer and maintainer cohorts; abandons authors entirely. Not viable for the load-bearing constraint.                                                  |
| Invoke `code --install-extension`-style auto-installation | The user already has the extension; they need the _CLI_. Not applicable.                                                                                               |

---

## 4. Markdown preview (live, web, reflowing)

### 4.1 Decision

**The primary preview is the built-in VS Code Markdown preview (`Ctrl+Shift+V`),
enhanced by an extension-contributed markdown-it plugin and CSS stylesheet.**
Not a custom webview, not a PDF render.

Rationale: VS Code's built-in preview already implements scroll-sync,
incremental refresh, multi-pane layout, and the
`Markdown: Open Preview to the
Side` workflow authors already know.
Re-implementing those in a custom webview would cost weeks and produce a worse
result. The extension owns only the entry-block rendering and the stylesheet;
everything else is free.

### 4.2 Reflow guarantee (load-bearing)

Authors hate previews that preserve hard line wraps from the source. The spec
guarantees reflow:

- `markdown-it` instance MUST use `breaks: false` (default — pinned here so a
  future plugin can't silently flip it).
- The markdown-it plugin's transformation of entry blocks MUST wrap body content
  in `<div>` (block context) or unwrap into the surrounding flow. Never `<pre>`.
- CSS MUST NOT apply `white-space: pre`, `pre-wrap`, or `pre-line` to entry body
  content. Default `normal` flow only.
- Paragraph breaks in source (blank lines) MUST render as `<p>` boundaries; soft
  line breaks (single `\n`) MUST render as spaces.
- CI MUST include a regression test: feed an entry whose body is a long
  paragraph wrapped at 80 columns in source; assert the rendered HTML contains
  exactly one `<p>` and no `<br>` for the soft line breaks.

### 4.3 Entry block rendering

The markdown-it plugin walks the AST and detects list items matching the entry
pattern (a list item whose first inline is `[TYPE_NNNN] Title`, followed by an
indented body and trailer block). For each match:

- Wrap in `<div class="markspec-entry markspec-type-{TYPE}">…</div>` where
  `{TYPE}` is the entry's type name (kebab-case).
- Title becomes `<h4 class="markspec-entry-title">[TYPE_NNNN] Title</h4>`.
- Body renders as normal Markdown inside `<div class="markspec-entry-body">`.
- Trailer renders as a dl/dt/dd table inside
  `<div class="markspec-entry-trailer">`.
- Labels (from `Labels:`) render as `<span class="markspec-label">…</span>`
  pills.
- Trace-link attributes (`Satisfies:`, `Verified-by:`, etc.) render with
  dashed-underline cross-reference styling and link to the target entry (anchor
  scroll within the preview, or definition jump if the target is in a different
  file — relies on VS Code's `command:` URI scheme).

### 4.4 Profile-aware coloring

Type colors are **not hardcoded** in the extension. They come from the active
profile.

Mechanism:

- On extension activation (and on `markspec/indexed` LSP notification), the
  extension sends a custom LSP request `markspec/profile` and receives the
  active profile's effective type list with per-type color metadata.
- The extension generates a CSS rule per type, e.g.:
  ```css
  .markspec-type-stakeholder-requirement {
    border-left-color: var(--markspec-color-blue, #4477AA);
  }
  ```
  The variable is keyed by the **palette hue** the LSP returns for the type
  (`"blue" | "cyan" | "teal" | "orange" | "red" | "purple" | "grey"`). The
  extension provides `--markspec-color-{hue}` definitions through its bundled
  `theme/markspec.css`; the inline hex fallback covers the bootstrap window
  before the stylesheet loads. The same `--markspec-color-{hue}` convention
  powers the published HTML book — single rendering path.
- The extension injects this stylesheet into the preview via the markdown
  preview's `addContent` hook (or via a dynamic stylesheet contribution if VS
  Code's API allows; otherwise via `data:` URI in the markdown-it output).
- Unknown types (e.g. when the profile is still loading, or for entries that the
  parser couldn't resolve) fall back to a neutral default — no missing-color
  errors.

The same generation logic powers the published HTML book (the
`render/styles/mod.ts` Markdown-level transformer, currently described in
AGENTS.md as "not yet wired into the pipeline"). Wiring it up gives both the VS
Code preview and the book HTML a single rendering path.

### 4.5 Options analysis

| Alternative                                                          | Rejected because                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contribute markdown-it plugin + CSS to built-in preview (**chosen**) | Scroll-sync, incremental refresh, multi-pane, navigation, search, etc. all free. Author muscle memory (`Ctrl+Shift+V`) preserved. Same code path serves the published book HTML.                                                                                |
| Custom webview replacing the built-in preview                        | Have to re-implement scroll-sync, refresh, multi-pane. Author confusion (two previews). Higher maintenance. Marginal control gain.                                                                                                                              |
| PDF as the live preview (Typst WASM)                                 | PDF has fixed page widths — cannot reflow to viewport (load-bearing §4.2). Compile latency (1-3s) makes it feel sluggish. PDF is a one-shot publication artifact (§5), not a live preview surface.                                                              |
| Render via the LSP server returning HTML                             | Server doesn't currently load any rendering pipeline. Putting it there breaks "Single binary, lazy loading" (CLAUDE.md). Adds a custom protocol message that other clients (Neovim) wouldn't consume anyway. Client-side markdown-it + CSS is strictly simpler. |

---

## 5. PDF generation (one-shot)

### 5.1 Decision

v1 ships **no live PDF preview**. The web preview (§4) is the only live preview
— it is web-styled, reflowing, and visually matches the published HTML book.
Authors author against the web preview during writing.

For publication-ready PDF output, a one-shot `Markspec: Build PDF` command
invokes `markspec doc build` and opens the resulting PDF artifact in the user's
PDF viewer (the built-in VS Code PDF viewer if installed, otherwise the OS
default).

Rationale: PDF cannot satisfy the §4.2 reflow guarantee — pages have fixed
widths by definition. A separate paginated preview adds maintenance burden for a
workflow that is intrinsically "build the artifact once, then check it" — a
one-shot command serves that case directly without a debounced rebuild loop.

### 5.2 Mechanism

The command shells out: `markspec doc build <file>` on the active document,
writing to a workspace-local `dist/` path (or a temp file, configurable via
`markspec.build.pdfOutput`). On success, it opens the resulting PDF in a new
editor tab. On failure (broken trace links, profile load errors), it shows the
diagnostics in the Problems panel and surfaces a notification with a **Show
output** action.

Progress: a status-bar message ("Building PDF…") appears for the duration of the
CLI invocation, since Typst compiles can take >1s (clig.dev: tell the user when
an operation hangs).

### 5.3 Future work (out of v1)

A live PDF preview webview with debounced rebuild remains a valid future
addition — e.g., for maintainers reviewing pagination before a print release.
v1.1 or later, with explicit design: pagination UI, scroll-sync, print-fidelity
controls. Out of scope for this spec.

---

## 6. Command Palette surface

The Command Palette is the primary discovery surface for authors. Every
CLI-backed feature has a corresponding `Markspec: ...` command. Commands are
grouped by category for the palette's filter-by-category UX.

### 6.1 Edit category

| Command                        | Backing                         | Notes                                                                |
| ------------------------------ | ------------------------------- | -------------------------------------------------------------------- |
| `Markspec: Format Document`    | LSP `textDocument/formatting`   | Requires the "LSP feature additions" epic's format capability.       |
| `Markspec: Validate Workspace` | LSP refresh                     | Forces a fresh cross-file validation pass; opens the Problems panel. |
| `Markspec: New Entry…`         | LSP code action or CLI `insert` | Quick-pick of profile-declared types; inserts a scaffolded block.    |
| `Markspec: Insert Trace Link…` | LSP code action                 | Quick-pick of existing entry IDs; inserts a `Satisfies:` or similar. |
| `Markspec: Rename Display ID…` | LSP rename                      | Surfaces VS Code's rename UI bound to the entry under the cursor.    |

### 6.2 Navigate category

| Command                       | Backing                | Notes                                                            |
| ----------------------------- | ---------------------- | ---------------------------------------------------------------- |
| `Markspec: Go to Entry…`      | LSP workspace symbols  | Quick-pick of all entries in the workspace; jumps to definition. |
| `Markspec: Show Trace Chain…` | LSP custom + tree view | Opens the entry under cursor in the Satisfies-chain tree (§8).   |
| `Markspec: Show Dependents…`  | LSP custom + tree view | Opens the entry under cursor in the dependents tree (§8).        |

### 6.3 Preview / build category

| Command                       | Backing                         | Notes                                                                             |
| ----------------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| `Markspec: Open Preview`      | built-in `markdown.showPreview` | Convenience alias — defers to `Ctrl+Shift+V` with the markspec stylesheet active. |
| `Markspec: Build PDF`         | CLI `doc build`                 | §5 — one-shot build, opens the resulting PDF.                                     |
| `Markspec: Preview Book`      | CLI `book build`                | Webview pointing at the generated HTML site; rebuild on save.                     |
| `Markspec: Compile Workspace` | CLI `compile`                   | Writes compiled JSON; shows summary in output channel.                            |
| `Markspec: Export…`           | CLI `export`                    | Quick-pick of format (json / yaml / csv); writes file.                            |

### 6.4 Report category

| Command                              | Backing                             | Notes                                      |
| ------------------------------------ | ----------------------------------- | ------------------------------------------ |
| `Markspec: Show Traceability Matrix` | CLI `report matrix --format json`   | §7.1 — webview with interactive matrix UI. |
| `Markspec: Show Coverage Report`     | CLI `report coverage --format json` | §7.2 — webview with coverage breakdown.    |

### 6.5 Info category

| Command                         | Backing                  | Notes                                                                       |
| ------------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| `Markspec: Run Doctor`          | CLI `doctor`             | Renders the health-check report in a webview with action buttons for fixes. |
| `Markspec: Show Profile`        | CLI `profile show` + LSP | Shows the active profile chain and types in a webview.                      |
| `Markspec: Show Output`         | already implemented      | Reveals the MarkSpec output channel.                                        |
| `Markspec: CLI: Update`         | bootstrap §3.4           | Manually trigger an update check.                                           |
| `Markspec: CLI: Configure PATH` | bootstrap §3.3           | Re-runs the "Add to PATH" flow.                                             |
| `Markspec: CLI: Uninstall`      | bootstrap §3.4           | Removes the bootstrapped binary + PATH snippet.                             |

### 6.6 Defaults

- Default keybindings: only `Markspec: Format Document` gets one (`Shift+Alt+F`,
  matching VS Code convention for format-document). Everything else is
  palette-only by default; users can bind via their keybindings file.
- Right-click editor menu: `Markspec: New Entry…`, `Markspec: Go to Entry…`,
  `Markspec: Show Trace Chain…` appear when the active document is a
  MarkSpec-relevant file (`.md` or a supported source extension).
- Editor title bar: `Markspec: Open Preview`, `Markspec: Build PDF` appear on
  `.md` files only.

---

## 7. Webview viewers

Webviews host the views that can't be expressed as in-editor decorations or
preview. Each follows the same lifecycle: launched by a Command Palette entry,
backed by a JSON payload from the CLI or LSP, refreshed on save (default) or
debounced (opt-in).

### 7.1 Traceability matrix

- Launch: `Markspec: Show Traceability Matrix`.
- Data: `markspec report matrix --format json` invoked on the workspace.
- Render: an interactive HTML matrix. Rows are upstream entries (typically STK),
  columns are downstream (SYS, SWE, SRS, TST). Cells indicate
  satisfies/derived-from/verified-by relationships. Click a cell to jump to the
  entry in the editor.
- Refresh: on save, throttled to once per 2 seconds.
- Empty / unreachable: a styled "no entries reachable from the workspace" panel
  when the project has none.

### 7.2 Coverage report

- Launch: `Markspec: Show Coverage Report`.
- Data: `markspec report coverage --format json`.
- Render: a tree grouped by entry type, with each entry showing verification
  status (verified, partial, unverified) and the list of Verified-by links.
- Refresh: same as §7.1.

### 7.3 Doctor / Profile

- Launch: `Markspec: Run Doctor` / `Markspec: Show Profile`.
- Data: `markspec doctor --format json` / `markspec profile show --format json`.
- Render: status panel with green/yellow/red indicators per check, and a "fix"
  button where the diagnostic has a known remedy (e.g., MSL-A030's attribute
  removal is exposed as a one-click button in the doctor panel, not just as a
  code action).

### 7.4 Webview security

All webviews use VS Code's `WebviewPanel` with `localResourceRoots` constrained
to the extension's `dist/` directory and the workspace `.markspec/` (if it
exists). No external URLs. CSP
`default-src 'none'; script-src 'self';
style-src 'self' 'unsafe-inline'; img-src 'self' data:;`.
No `eval`; no postMessage from untrusted origins.

---

## 8. Tree view (requirements panel)

An activity-bar icon (book + checkmark) opens the MarkSpec side panel hosting a
tree view of the workspace's entries. Three view modes (segmented control):

- **By type.** Top-level nodes are type names; children are entries of that
  type, grouped by file.
- **By file.** Top-level nodes are files; children are the entries declared in
  each file.
- **By chain.** Top-level nodes are stakeholder requirements (or whatever the
  profile declares as the chain root); children are entries that satisfy them,
  recursively.

Click an entry node to jump to its definition. Right-click for
`Show Trace
Chain`, `Show Dependents`, `Copy Display ID`,
`Insert Reference Here`.

The tree refreshes on the LSP's `markspec/indexed` notification and on
incremental parse updates.

---

## 9. Status bar

The status bar surfaces project health at a glance. Four segments, each
clickable:

- **Version + core-schema.** `markspec 0.5.0 (schema 1)` — clicking opens the
  doctor panel. Color: muted when matched, yellow when extension expects a
  different schema (§3.4 skew detection).
- **Profile.** `profile: aspice-l3` — clicking opens the profile panel.
- **Validation summary.** `✓ 0 errors` / `⚠ 3 warnings` / `✗ 2 errors` —
  clicking opens the Problems panel.
- **CLI state.** Only visible when the CLI is missing or installing.
  `markspec: not installed` / `installing…` / `update available` — clicking
  triggers the relevant bootstrap action.

---

## 10. Settings reference

All settings live under the `markspec.*` namespace.

| Setting                              | Type     | Default   | Purpose                                                                                                          |
| ------------------------------------ | -------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| `markspec.server.path`               | string   | `""`      | Override CLI path; empty means "use bootstrap or PATH" (§3.1).                                                   |
| `markspec.server.args`               | string[] | `[]`      | Extra args passed to `markspec lsp`. `${workspaceFolder}` substituted.                                           |
| `markspec.cli.autoInstall`           | boolean  | `true`    | Whether bootstrap §3.1 runs when CLI is missing.                                                                 |
| `markspec.cli.installLocation`       | string   | `""`      | Override the directory used by bootstrap (§3.2). Empty means platform default.                                   |
| `markspec.cli.updateCheck`           | enum     | `"daily"` | `"never"`, `"daily"`, `"weekly"` — how often the extension checks for CLI updates.                               |
| `markspec.preview.web.profileColors` | boolean  | `true`    | Whether the web preview applies profile-declared type colors (§4.4). Set false for a neutral monochrome preview. |
| `markspec.build.pdfOutput`           | string   | `"dist/"` | Workspace-relative directory `Markspec: Build PDF` writes to. Empty means a temp file.                           |
| `markspec.mcp.enabled`               | boolean  | `true`    | Whether the extension registers the MCP server with VS Code (1.101+).                                            |
| `markspec.mcp.args`                  | string[] | `["mcp"]` | Args used when spawning the MCP server.                                                                          |
| `markspec.inlineCompletion.enabled`  | boolean  | `true`    | Whether the AI inline-completion provider runs.                                                                  |
| `markspec.trace.server`              | enum     | `"off"`   | LSP trace level: `"off"`, `"messages"`, `"verbose"`.                                                             |
| `markspec.trace.debugLog`            | string   | `""`      | Path for the LSP server's debug log; `${workspaceFolder}` substituted.                                           |

Release-manifest URL is **not** a setting — it is hard-coded as a constant
(`https://github.com/driftsys/markspec/releases/latest/download/manifest.json`).
Settings cannot point at arbitrary URLs because that would make the bootstrap
flow a credential-injection vector.

---

## 11. clig.dev / VS Code idiom conformance

The extension follows two complementary conventions: clig.dev for the CLI it
shells out to (inherited from AGENTS.md), and VS Code Extension Guidelines for
the extension UX itself.

| Rule                                              | How the extension complies                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Commands have categories                          | Every command is prefixed `Markspec:` with a `category` of `Edit`, `Navigate`, `Preview`, `Report`, `Info`, or `CLI`. |
| Settings have descriptions                        | Every setting has a `description` in `package.json` matching the §10 column.                                          |
| Output channel for logs                           | `MarkSpec` channel + `MarkSpec LSP` (when trace enabled). Never `console.log`.                                        |
| Notifications used sparingly                      | Bootstrap, version skew, install completion — not for routine events.                                                 |
| Webview CSP locked down                           | §7.4 — `default-src 'none'`, no `eval`, no external URLs.                                                             |
| No interactive prompts in non-interactive context | The extension itself is interactive by nature; the CLI shell-outs follow toolchain-distribution.md §6.4.              |
| `NO_COLOR` honored                                | Inherited from the CLI; webviews that surface CLI output respect `NO_COLOR` when rendering ANSI.                      |
| Stable command IDs                                | `markspec.*` namespace, never renamed without a one-version deprecation alias.                                        |

---

## 12. Open questions

Capped at five per the spec-authoring convention. None blocks v1; all can be
resolved during implementation.

1. **Manifest hosting.** The §3.1 bootstrap fetches a release manifest from a
   hard-coded URL. Is the canonical home GitHub releases, or do we want a
   first-party CDN (`releases.markspec.dev/...`) for cache control and to
   decouple from any future GitHub move? GitHub is the obvious default; the
   question is whether to introduce a stable indirection now.

2. **Tree view as activity bar vs. explorer panel.** §8 places the requirements
   tree in its own activity-bar icon. An alternative is a collapsible panel in
   the existing Explorer view group. Activity bar is more discoverable; explorer
   panel is lighter-weight. Both are reasonable.

3. **Profile-aware preview color caching.** §4.4 fetches the profile's color
   metadata on activation. If the profile changes during a session (rare —
   typically requires a workspace reload), the preview's CSS goes stale until
   the user reloads the window. Auto-refreshing the preview's stylesheet on
   `markspec/indexed` is feasible but adds a round-trip per index. Worth it, or
   accept "reload window when profile changes"?

4. **Webview lifecycle on close.** §7 webviews are persistent across editor
   focus loss but discarded on user-close. When the user re-launches the same
   command, do we reuse the panel (preserve scroll state) or open fresh? Reuse
   seems right but conflicts with "the CLI re-ran, here's the updated output"
   framing.

5. **Bundled binary in v1 vs. v2.** This spec removes the VSIX-bundled binary
   (§3.6, toolchain-distribution.md §2.2). For the v1 release, do we ship two
   extension variants — one with bundle (for offline / restricted environments),
   one without — or do we mandate the bootstrap path for everyone and document
   the offline workaround? Single variant is architecturally cleaner; two
   variants serves the restricted-network case without complaint.

---

## Annex — Cross-reference summary

| Section here         | Source                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| §2 User segmentation | Explicit cohort breakdown introduced during the 2026-05-25 spec brainstorm                                                     |
| §3 Bootstrap install | [markspec-toolchain-distribution.md §2.2, §3.3, §6](markspec-toolchain-distribution.md); GitHub releases manifest format       |
| §4 Markdown preview  | VS Code Markdown API; markdown-it; `packages/markspec/render/styles/mod.ts` (Markdown-level transformer); `theme/markspec.css` |
| §5 PDF generation    | `render/typst/` (existing Typst pipeline); `markspec doc build` CLI                                                            |
| §6 Command Palette   | VS Code Extension API; clig.dev parallels via shelled-out CLI                                                                  |
| §7 Webview viewers   | VS Code Webview API; `markspec report` JSON schema                                                                             |
| §8 Tree view         | VS Code TreeView API; `book/summary/` structure                                                                                |
| §9 Status bar        | VS Code StatusBar API; `editors/vscode/src/statusBar.ts`                                                                       |
| §10 Settings         | `editors/vscode/package.json` `contributes.configuration`                                                                      |
| §11 Conformance      | VS Code Extension Guidelines; AGENTS.md "CLI standard: clig.dev"; clig.dev                                                     |
