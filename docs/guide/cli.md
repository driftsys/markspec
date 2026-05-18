# CLI guide

Reference for `project.yaml`, every subcommand, and editor / LSP integration.

MarkSpec follows the [Command Line Interface Guidelines](https://clig.dev/).
Every command supports `--help`. Commands that produce structured output support
`--format json` for machine-readable output to stdout (diagnostics always go to
stderr).

**Exit codes:** `0` success, `1` error, `2` warnings only (validate).

**Global options** (available on every command):

| Flag            | Description               |
| --------------- | ------------------------- |
| `-h, --help`    | Show help                 |
| `-V, --version` | Show version              |
| `-q, --quiet`   | Suppress non-error output |

---

## Project configuration

### project.yaml

Every MarkSpec project requires a `project.yaml` in the project root. MarkSpec
discovers it by walking up from the current directory.

#### Minimal example

```yaml
name: my-project
version: "1.0.0"
```

#### Complete example

```yaml
name: io.acme.braking-system
version: "2.3.0"
labels:
  - ASIL-A
  - ASIL-B
  - ASIL-C
  - ASIL-D
parents:
  - https://acme.com/refhub
parent-fallback: https://driftsys.github.io/refhub
```

#### Fields

| Field             | Type     | Required | Default                             | Description                                               |
| ----------------- | -------- | -------- | ----------------------------------- | --------------------------------------------------------- |
| `name`            | string   | yes      | —                                   | Project name. Reverse-DNS convention recommended.         |
| `version`         | string   | yes      | `"0.0.0"`                           | Project version. Quote in YAML to avoid number coercion.  |
| `labels`          | string[] | no       | `[]`                                | Allowed label vocabulary. Empty means no constraint.      |
| `parents`         | string[] | no       | `[]`                                | Upstream parent registry URLs, searched in order.         |
| `parent-fallback` | string   | no       | `https://driftsys.github.io/refhub` | Fallback registry when parents don't resolve a reference. |

### Directory conventions

MarkSpec does not enforce a directory layout. By convention:

- `docs/` — Markdown files containing requirements and design documentation
- `src/` — source code with doc-comment entries (Rust `///`, Kotlin `/**`)
- `project.yaml` — project root marker

The `compile` and `report` commands accept explicit paths or globs:

```sh
markspec compile "docs/**/*.md"
markspec compile docs/requirements.md src/main.rs
```

Profile configuration (`.markspec.yaml` and profile manifests) is covered in the
[Profile guide](profiles.md).

---

## Commands

### Authoring

#### format

Stamp ULIDs, fix indentation, normalize attributes.

```sh
markspec format <file...>
markspec format --check <file...>
```

| Flag      | Type | Default | Description                                              |
| --------- | ---- | ------- | -------------------------------------------------------- |
| `--check` | bool | false   | Report changes without writing. Exit 1 if changes needed |

**Examples:**

```sh
# Format a single file (writes changes in place)
markspec format docs/requirements.md

# Format multiple files
markspec format docs/*.md

# Check mode for CI — reports but doesn't modify
markspec format --check docs/*.md
```

#### validate

Check broken refs, missing Ids, malformed entries, duplicates.

```sh
markspec validate <file...>
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--strict` | bool   | false   | Promote warnings to errors    |
| `--format` | string | `text`  | Output format: `json`, `text` |

**Examples:**

```sh
# Validate a file
markspec validate docs/requirements.md

# Strict mode — warnings become errors (useful for CI)
markspec validate --strict docs/requirements.md

# JSON output for tool integration
markspec validate --format json docs/*.md
```

### Querying

#### show

Show details of a single entry by display ID or ULID.

```sh
markspec show <id> <paths...>
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--format` | string | `text`  | Output format: `json`, `text` |

**Examples:**

```sh
markspec show STK_PRJ_0001 "docs/**/*.md"
markspec show --format json STK_PRJ_0001 docs/requirements.md
```

#### context

Walk the Satisfies chain upward from an entry to see what it ultimately
satisfies.

```sh
markspec context <id> <paths...>
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--depth`  | number | `10`    | Maximum depth to walk         |
| `--format` | string | `text`  | Output format: `json`, `text` |

**Examples:**

```sh
markspec context SRS_PRJ_0001 "docs/**/*.md"
markspec context --depth 3 SRS_PRJ_0001 docs/requirements.md
```

#### dependents

List all entries that depend on (satisfy) a given entry.

```sh
markspec dependents <id> <paths...>
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--format` | string | `text`  | Output format: `json`, `text` |

**Examples:**

```sh
markspec dependents STK_PRJ_0001 "docs/**/*.md"
```

### Building

#### compile

Parse files, build traceability graph, output compiled result.

```sh
markspec compile <paths...>
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--format` | string | `text`  | Output format: `json`, `text` |

**Examples:**

```sh
# Summary output
markspec compile "docs/**/*.md"

# Full JSON output for downstream tools
markspec compile --format json "docs/**/*.md" > compiled.json
```

#### report

Generate a traceability matrix or coverage report.

```sh
markspec report <kind> <paths...>
```

`kind` is one of: `traceability`, `coverage`.

| Flag       | Type   | Default | Description                        |
| ---------- | ------ | ------- | ---------------------------------- |
| `--format` | string | `md`    | Output format: `md`, `json`, `csv` |
| `--scope`  | string | —       | Filter by domain abbreviation      |
| `--label`  | string | —       | Filter by label value              |
| `--output` | string | —       | Write to file instead of stdout    |

**Examples:**

```sh
# Traceability matrix in Markdown
markspec report traceability "docs/**/*.md"

# Coverage report as CSV
markspec report coverage --format csv "docs/**/*.md"

# Write to file
markspec report traceability --output matrix.md "docs/**/*.md"

# Filter by label
markspec report traceability --label ASIL-B "docs/**/*.md"
```

### Documents

#### doc build

Generate a single-document PDF via Typst.

```sh
markspec doc build <file>
```

| Flag           | Type   | Default      | Description      |
| -------------- | ------ | ------------ | ---------------- |
| `-o, --output` | string | `<file>.pdf` | Output file path |

**Examples:**

```sh
markspec doc build docs/spec.md
markspec doc build -o output/spec.pdf docs/spec.md
```

### Books

#### book build

Generate a multi-chapter static HTML site from a SUMMARY.md.

```sh
markspec book build
```

| Flag            | Type   | Default      | Description      |
| --------------- | ------ | ------------ | ---------------- |
| `-o, --output`  | string | `_site`      | Output directory |
| `-s, --summary` | string | `SUMMARY.md` | SUMMARY.md path  |

**Examples:**

```sh
markspec book build
markspec book build -o dist -s docs/SUMMARY.md
```

### Profile and diagnostics

#### profile show

Show the active profile chain and effective configuration.

```sh
markspec profile show
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--format` | string | `text`  | Output format: `json`, `text` |

#### doctor

Project health check: verifies `project.yaml`, profile configuration, and
project structure.

```sh
markspec doctor
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--format` | string | `text`  | Output format: `json`, `text` |

### AI agent integration

#### mcp

Start the MarkSpec MCP server. Communicates over stdio JSON-RPC. Exposes the
active project as MCP resources and tools to any MCP-capable AI client (Claude
Code, Claude Desktop, GitHub Copilot in VS Code, OpenCode).

```sh
markspec mcp
```

##### Resources

- `markspec://profile` — distilled profile manifest (types, attributes, link
  kinds, labels).
- `markspec://entries` — index of all project entries, grouped by type.
- `markspec://entry/{displayId}` — one entry per resource, with attributes,
  body, outgoing/incoming links.

##### Tools

- `entry_search { query, limit? }` — rank-search entries by display ID and
  title.
- `entry_context { id, depth? }` — walk the `satisfies` chain upward.
- `validate { files? }` — run the validator, return a Markdown diagnostics
  report.
- `markspec_refresh` — force-invalidate the compile cache (call after agent
  edits to guarantee freshness).

##### Claude Desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "markspec": {
      "command": "markspec",
      "args": ["mcp"],
      "cwd": "/path/to/your/markspec-project"
    }
  }
}
```

Restart Claude Desktop. The MarkSpec resources and tools appear in the attach
menu.

##### Claude Code

```sh
claude mcp add markspec --command markspec --args mcp --cwd /path/to/project
```

##### VS Code (Copilot)

The `markspec-ide` extension auto-registers the MarkSpec MCP server with VS Code
1.101+ — install the extension and the server appears in Copilot's MCP picker.
See [Editor and LSP integration — VS Code](#vs-code) below.

For users who don't run the extension, the manual recipe still works. Add a
`.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "markspec": {
      "command": "markspec",
      "args": ["mcp"]
    }
  }
}
```

Copilot does not support MCP resource subscriptions today, but the `markspec://`
resources still work — the server runs a fresh staleness check on every read, so
a re-read after an edit returns up-to-date content.

### Not yet implemented

These commands are registered but print an error and exit:

| Command            | Intended purpose                                         |
| ------------------ | -------------------------------------------------------- |
| `markspec export`  | Compiled JSON → json, csv, reqif, yaml                   |
| `markspec insert`  | Agent write path: insert a requirement block into a file |
| `markspec create`  | Scaffold a new requirement block                         |
| `markspec next-id` | Print the next available display ID for a type           |
| `markspec hook`    | Run format + validate as a pre-commit hook               |
| `book dev`         | Live preview with hot reload                             |
| `deck build`       | Slides → PDF via Touying/Typst                           |
| `deck dev`         | Live slide preview                                       |

---

## Editor and LSP integration

MarkSpec ships a built-in Language Server Protocol (LSP) server. Run it with:

```bash
markspec lsp
```

The server communicates over **stdio JSON-RPC** — the standard transport that
every LSP-capable editor supports.

### Features

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

### VS Code

Install the **MarkSpec** extension from the `editors/vscode/` directory in this
repository. The extension requires VS Code **1.101 or newer** (the version that
introduced the stable MCP extension API).

The extension provides two integrations in one install:

- **LSP** — diagnostics, completions, and entry-block scaffolding in the editor.
- **MCP** — registers a `markspec` MCP server with VS Code so Copilot (and any
  other MCP-aware client) can use the project's resources and tools without a
  separate `.vscode/mcp.json`.

Both point at the same `markspec` binary, resolved from `markspec.server.path`.

#### From source

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

#### Configuration

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

#### MCP server

Once the extension is installed, the **MarkSpec** MCP server appears in
Copilot's MCP picker — no `.vscode/mcp.json` required. To disable the
registration:

```json
{
  "markspec.mcp.enabled": false
}
```

The manual `.vscode/mcp.json` recipe in
[mcp — VS Code (Copilot)](#vs-code-copilot) remains supported for editors that
don't run the extension.

### Neovim

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

#### With nvim-lspconfig

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

### Other editors

Any editor with LSP support can use `markspec lsp`. The server expects:

- **Transport:** stdio (stdin/stdout JSON-RPC)
- **Trigger characters:** `[` (block scaffold) and `:` (ID reference)
- **Document sync:** full text on each change

Point your editor's LSP client at `markspec lsp` and it should work. If your
editor needs a specific configuration example, please open an issue.
