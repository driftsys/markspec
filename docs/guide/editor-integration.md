# Editor integration

MarkSpec ships a built-in Language Server Protocol (LSP) server. Run it with:

```bash
markspec lsp
```

The server communicates over **stdio JSON-RPC** — the standard transport that
every LSP-capable editor supports.

## Features

**Diagnostics** — broken references, missing IDs, duplicate display IDs, and
malformed entries appear as inline errors and warnings as you type. File-local
checks run immediately; cross-file validation runs on save.

**Entry block completion** — type `- [` at the start of a line to get a
pre-filled entry block scaffold with the next available display ID for each type
defined in your profile.

**ID reference completion** — after a trace attribute keyword (`Satisfies:`,
`Derived-from:`, `Verified-by:`, etc.) the server suggests all known display IDs
in the project.

**Source file context guard** — in source files (Rust, Kotlin, Java, C, C++),
completions only activate near entry markers or trace keywords. The server won't
interfere with your language's native LSP (rust-analyzer, kotlin-lsp, etc.).

## VS Code

Install the **MarkSpec** extension from the `editors/vscode/` directory in this
repository. The extension requires VS Code **1.101 or newer** (the version that
introduced the stable MCP extension API).

The extension provides two integrations in one install:

- **LSP** — diagnostics, completions, and entry-block scaffolding in the editor.
- **MCP** — registers a `markspec` MCP server with VS Code so Copilot (and any
  other MCP-aware client) can use the project's resources and tools without a
  separate `.vscode/mcp.json`.

Both point at the same `markspec` binary, resolved from `markspec.server.path`.

### From source

```bash
cd editors/vscode
npm install
npm run compile
```

Then in VS Code: `Extensions → ⋯ → Install from VSIX` or press `Ctrl+Shift+P` →
`Extensions: Install from VSIX…` and select the `.vsix` file, or use the
development host:

```bash
code --extensionDevelopmentPath=editors/vscode
```

### Configuration

| Setting                 | Default      | Description                                               |
| ----------------------- | ------------ | --------------------------------------------------------- |
| `markspec.server.path`  | `"markspec"` | Path to the `markspec` binary (used by both LSP and MCP). |
| `markspec.server.args`  | `["lsp"]`    | Arguments passed to start the LSP server.                 |
| `markspec.mcp.enabled`  | `true`       | Register the MarkSpec MCP server with VS Code.            |
| `markspec.mcp.args`     | `["mcp"]`    | Arguments passed to start the MCP server.                 |
| `markspec.trace.server` | `"off"`      | Trace level: `off`, `messages`, or `verbose`.             |

If `markspec` is not on your PATH, set the full path:

```json
{
  "markspec.server.path": "/home/you/.local/bin/markspec"
}
```

### MCP server

Once the extension is installed, the **MarkSpec** MCP server appears in
Copilot's MCP picker — no `.vscode/mcp.json` required. To disable the
registration:

```json
{
  "markspec.mcp.enabled": false
}
```

The manual `.vscode/mcp.json` recipe in
[Commands — `mcp` § VS Code (Copilot)](commands.md#vs-code-copilot) remains
supported for editors that don't run the extension.

## Neovim

Neovim's built-in LSP client works out of the box. Add this to your `init.lua`:

```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = { "markdown" },
  callback = function()
    vim.lsp.start({
      name = "markspec",
      cmd = { "markspec", "lsp" },
      root_dir = vim.fs.root(0, { "project.yaml", ".git" }),
    })
  end,
})
```

For source files (Rust, Kotlin, etc.) where MarkSpec entry blocks appear in doc
comments, add the relevant file types to the `pattern` list:

```lua
pattern = { "markdown", "rust", "kotlin", "java", "c", "cpp" },
```

The server's context guard ensures it only activates near MarkSpec entry
markers, so it won't conflict with rust-analyzer or other language servers
running on the same buffer.

### With nvim-lspconfig

If you use [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig), add a
custom server definition:

```lua
local lspconfig = require("lspconfig")
local configs = require("lspconfig.configs")

if not configs.markspec then
  configs.markspec = {
    default_config = {
      cmd = { "markspec", "lsp" },
      filetypes = { "markdown", "rust", "kotlin", "java", "c", "cpp" },
      root_dir = lspconfig.util.root_pattern("project.yaml", ".git"),
    },
  }
end

lspconfig.markspec.setup({})
```

## Other editors

Any editor with LSP support can use `markspec lsp`. The server expects:

- **Transport:** stdio (stdin/stdout JSON-RPC)
- **Trigger characters:** `[` (block scaffold) and `:` (ID reference)
- **Document sync:** full text on each change

Point your editor's LSP client at `markspec lsp` and it should work. If your
editor needs a specific configuration example, please open an issue.
