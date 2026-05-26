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
| Document formatting      | `Shift+Alt+F` runs the same code path as `markspec format` on the buffer               |
| Semantic tokens          | Display IDs, ULIDs, modal verbs, EARS triggers, and typl tokens are syntax-highlighted |
| Quick fixes              | One-click fixes for MSL-M060 (uppercase modal), MSL-A030 (generated attr), and more    |

## Install

1. Open **Extensions** (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Search for **MarkSpec**.
3. Install `driftsys.markspec-ide`.

The extension activates on any workspace that contains `.md` files.

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

**Extension activates but shows no diagnostics**

- Confirm the binary is on `PATH`: `markspec --version` in a terminal.
- Check the MarkSpec output panel (**View → Output → MarkSpec**) for LSP errors.
- Verify the project has a `project.yaml` — `markspec validate` requires one.

**"markspec: command not found"**

Set `markspec.server.path` to the absolute binary path, e.g.
`/home/user/.local/bin/markspec`.

**Completions not appearing**

- Completions for block scaffold require the line to start with `- [`.
- Trace-attribute completions require the workspace to be indexed — check the
  output panel for "Indexed N files".
