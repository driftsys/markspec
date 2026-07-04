# VS Code extension

The **MarkSpec** extension (`driftsys.markspec-ide`) provides first-class editor
support for MarkSpec documents and source-file doc comments. It speaks the
Language Server Protocol (LSP) and delegates to the same `markspec` binary you
use on the command line.

## Features

| Feature                  | Description                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------- |
| Real-time diagnostics    | Validation errors and warnings inline as you type                                      |
| Entry block completions  | `- [` → full block scaffold with display ID and attribute skeleton                     |
| ID reference completions | `Satisfies:` → pick from all display IDs in the workspace                              |
| Type completions         | `Type:` → core types + profile-declared types                                          |
| Hover                    | Hover any display ID to preview the entry's title, type, and body                      |
| Go-to-definition         | `F12` on a display ID jumps to the entry's source location                             |
| Find all references      | `Shift+F12` lists every file that references a display ID                              |
| Workspace rename         | `F2` renames a display ID across the entire workspace                                  |
| Document outline         | Outline view lists every entry in the file                                             |
| Workspace symbol search  | `Ctrl+T` fuzzy-searches entries by display ID or title                                 |
| Folding                  | Each entry block is collapsible                                                        |
| Document highlights      | Cursor on a display ID highlights every occurrence in the file                         |
| Code lens                | Per-entry inline lenses: "↑ N dependents" and "↓ Satisfies: ID — Title"                |
| Inlay hints              | Per-entry inline hints: resolved `: <type>` and `(N dependents)` counters              |
| Document links           | `Verified-by:` file-path values are clickable links to the test source                 |
| Document formatting      | `Shift+Alt+F` runs the same code path as `markspec fmt` on the buffer                  |
| Semantic tokens          | Display IDs, ULIDs, modal verbs, EARS triggers, and typl tokens are syntax-highlighted |
| Quick fixes              | One-click fixes for MSL-M060 (uppercase modal), MSL-A030 (generated attr), and more    |

### Upstream entries (federated projects)

When a project locks upstream repositories (`dependencies:` / `references:` in
`project.yaml`, resolved by `markspec lock`), the imported entries appear in the
editor as read-only citizens:

- **Completion** offers their display IDs with an `— from <name>@<version>`
  badge, so you can see an ID is imported, not local.
- **Hover** renders the imported entry the same as a local one.
- **Go-to-definition is a no-op** — an upstream entry lives in another
  repository and has no file in this workspace to open.
- **Rename and formatting never touch them**, and no diagnostics are published
  against them; their validation happened in their own repository.

## Install

**VS Code Marketplace:**

1. Open **Extensions** (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Search for **MarkSpec**.
3. Install `driftsys.markspec-ide` — or run
   `code --install-extension driftsys.markspec-ide`.

**Open VSX** (VSCodium, Cursor, Gitpod, …):
<https://open-vsx.org/extension/driftsys/markspec-ide> — or
`codium --install-extension driftsys.markspec-ide`.

The extension activates only in a **MarkSpec project** — a workspace that
contains a `.markspec.yaml` activator (per ADR-008). In a plain Markdown or
source repository with no `.markspec.yaml` the extension stays dormant: it never
spawns the language server, never indexes, and never writes a `.markspec/`
directory. Run `markspec init` (or add a `.markspec.yaml`) to turn a workspace
into a MarkSpec project.

## Configuration

All settings live under the `markspec.` prefix in VS Code settings.

| Setting                 | Default      | Description                                                |
| ----------------------- | ------------ | ---------------------------------------------------------- |
| `markspec.server.path`  | `"markspec"` | Path to the `markspec` binary. Override if not on `PATH`.  |
| `markspec.server.args`  | `["lsp"]`    | Arguments passed to the binary to start the LSP server.    |
| `markspec.trace.server` | `"off"`      | LSP protocol trace level: `off`, `messages`, or `verbose`. |

**Example** — binary in a project-local path:

```json
{
  "markspec.server.path": "${workspaceFolder}/.bin/markspec"
}
```

## Logs

In a MarkSpec project the language server writes a per-project event log to
`<workspace>/.markspec/lsp.log` (rotated at 1 MB, three files kept). The first
time it opens that file it drops a self-ignoring `.markspec/.gitignore` (`*`)
alongside it, so the log never shows up in `git status` — you do not need to add
anything to your repository's `.gitignore`. A workspace with no `.markspec.yaml`
gets no `.markspec/` directory at all. Override the location with the
`markspec.trace.logPath` setting (or the `MARKSPEC_LSP_LOG` environment
variable); an explicit path writes the log regardless of project membership. Set
`MARKSPEC_LSP_LOG_OFF=1` to disable logging entirely.

## Schema validation

MarkSpec publishes JSON Schemas for its config files at
`https://driftsys.github.io/markspec/schemas/<name>/v1.json`:

| File                    | Schema                       |
| ----------------------- | ---------------------------- |
| `.markspec.yaml`        | `…/schemas/markspec/v1.json` |
| profile `markspec.yaml` | `…/schemas/profile/v1.json`  |
| `markspec.lock`         | `…/schemas/lock/v1.json`     |

**YAML files** (`.markspec.yaml`, profile `markspec.yaml`). `markspec init`
writes a `$schema:` key into generated `.markspec.yaml` files, which the
[YAML Language Server](https://github.com/redhat-developer/vscode-yaml) reads
automatically. To add it by hand:

```yaml
$schema: https://driftsys.github.io/markspec/schemas/markspec/v1.json
profiles:
  - io.example.base@1.0.0
```

Or map by filename in VS Code `settings.json`:

```json
{
  "yaml.schemas": {
    "https://driftsys.github.io/markspec/schemas/profile/v1.json": "**/markspec.yaml"
  }
}
```

**Lockfile** (`markspec.lock`, TOML). `markspec lock` writes a `#:schema`
directive on the first line, which the
[Even Better TOML](https://taplo.tamasfe.dev/) extension reads:

```text
#:schema https://driftsys.github.io/markspec/schemas/lock/v1.json
```

## MCP server

The extension also registers MarkSpec as an MCP server so Claude and other AI
agents can query your entry graph directly from inside the editor.

No extra configuration is required — the extension reads `markspec.server.path`
and registers the MCP server automatically. In VS Code with Copilot or Claude
extension enabled, the server appears as **MarkSpec** in the agent tool list.

## Neovim / other LSP clients

Any editor that supports LSP can use `markspec lsp`. Example Neovim (lazy.nvim)
configuration:

```lua
require("lspconfig").markspec.setup({
  cmd = { "markspec", "lsp" },
  filetypes = { "markdown" },
  root_dir = require("lspconfig.util").root_pattern("project.yaml"),
})
```

Generate the full configuration snippet for your editor:

```sh
markspec lsp install --editor neovim
markspec lsp install --editor zed
markspec lsp install --editor vscode   # prints JSON config block
```

Pin a specific binary path (default writes the invoked binary name, which
resolves via `PATH` and survives package-manager upgrades):

```sh
markspec lsp install --editor neovim --binary-path /opt/markspec/bin/markspec
```

## Troubleshooting

**Extension never activates**

- The extension activates only when the workspace contains a `.markspec.yaml`.
  Add one (or run `markspec init`) to mark the folder as a MarkSpec project.

**Extension activates but shows no diagnostics**

- Confirm the binary is on `PATH`: `markspec --version` in a terminal.
- Check the MarkSpec output panel (**View → Output → MarkSpec**) for LSP errors.
- Confirm the file has MarkSpec entry blocks — diagnostics only appear for files
  the server recognises (`.md` and supported source files with entry markers or
  trace attributes).

**"markspec: command not found"**

Set `markspec.server.path` to the absolute binary path, e.g.
`/home/user/.local/bin/markspec`.

**Completions not appearing**

- Completions for block scaffold require the line to start with `- [`.
- Trace-attribute completions require the workspace to be indexed — check the
  output panel for "Indexed N files".
