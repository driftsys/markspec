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

#### fmt

Stamp ULIDs, fix indentation, normalize attributes.

```sh
markspec fmt <file...>
markspec fmt --check <file...>
```

| Flag      | Type | Default | Description                                              |
| --------- | ---- | ------- | -------------------------------------------------------- |
| `--check` | bool | false   | Report changes without writing. Exit 1 if changes needed |

**Examples:**

```sh
# Format a single file (writes changes in place)
markspec fmt docs/requirements.md

# Format multiple files
markspec fmt docs/*.md

# Check mode for CI — reports but doesn't modify
markspec fmt --check docs/*.md
```

**Project-aware trace canonicalisation (requires `project.yaml`):**

When `markspec fmt` runs inside a project, it also canonicalises and heals trace
reference values:

- **Canonicalise** — any ULID written directly in a trace attribute
  (`Satisfies:`, `Derived-from:`, `Verified-by:`, etc.) is rewritten to the
  target entry's current display ID.
- **Heal** — if a target's display ID was renamed, the edge ledger in
  `markspec.lock` records the stable `target-ulid`; `fmt` uses it to rewrite the
  stale display ID to the target's new name.
- **Unresolved references are left as-is** — `markspec check` reports them via
  MSL-L006.

Neither action is performed when no `project.yaml` is discoverable (file-local
invocation). `fmt` reads the edge ledger but never writes `markspec.lock`; the
ledger is owned by `markspec lock`.

#### check

Check broken refs, missing Ids, malformed entries, duplicates.

```sh
markspec check <file...>
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--strict` | bool   | false   | Promote warnings to errors    |
| `--format` | string | `text`  | Output format: `json`, `text` |

**Examples:**

```sh
# Check a file
markspec check docs/requirements.md

# Strict mode — warnings become errors (useful for CI)
markspec check --strict docs/requirements.md

# JSON output for tool integration
markspec check --format json docs/*.md
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

#### export

Emit the compiled traceability graph in a portable format.

```sh
markspec export <format> <paths...>
```

Supported formats: `json`, `yaml`, `csv`.

**Examples:**

```sh
# JSON export
markspec export json "docs/**/*.md" > compiled.json

# CSV — one row per entry with display ID, title, type, shape, id, file, line
markspec export csv "docs/**/*.md" > entries.csv

# YAML
markspec export yaml "docs/**/*.md"
```

#### insert

Append a scaffolded entry block to a file. This is the agent write path — use it
from scripts or AI agents rather than hand-authoring new blocks.

```sh
markspec insert <type> <file>
```

| Flag      | Type | Default | Description                               |
| --------- | ---- | ------- | ----------------------------------------- |
| `--print` | bool | false   | Echo the inserted block to stdout as well |

The command:

1. Finds the highest existing display ID for `<type>` in `<file>`.
2. Computes the next sequential display ID.
3. Generates a fresh ULID.
4. Appends the block with a blank separator.

**Example:**

```sh
markspec insert requirement docs/requirements.md --print
# → appends SRS_PRJ_0003, prints block to stdout
```

Follow with `markspec fmt` to normalize indentation and `markspec check` to
confirm no broken references.

#### create

Print a scaffolded entry block without writing it to any file.

```sh
markspec create <type> <paths...>
```

**Example:**

```sh
markspec create requirement "docs/**/*.md"
```

#### next-id

Print the next available display ID for a profile-declared type without creating
an entry.

```sh
markspec next-id <type> <paths...>
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--format` | string | `text`  | Output format: `json`, `text` |

**Example:**

```sh
markspec next-id requirement "docs/**/*.md"
# → SRS_PRJ_0004

markspec next-id requirement "docs/**/*.md" --format json
# → {"type":"requirement","displayId":"SRS_PRJ_0004"}
```

For a **named (counter-less) type** — one whose `display-id-pattern` has no
`{n}` counter, e.g. `sw-component: "SWC_{name}"` (ADR-025) — there is no number
to mint. `next-id`, `create`, and `insert` instead emit an upper-case `NAME`
placeholder template for you to fill in by hand (slug-valid, so the scaffold
still passes `markspec check`):

```sh
markspec next-id sw-component "docs/**/*.md"
# → SWC_NAME   (with a note on stderr: author the identifier yourself)
```

#### lint

Run prose-quality analysis on entries (INCOSE lexicon, modal keywords,
structural checks). Returns `MSL-Q` and `MSL-M` codes.

```sh
markspec lint <paths...>
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--format` | string | `text`  | Output format: `json`, `text` |
| `--strict` | bool   | false   | Promote warnings to errors    |

Lint does **not** run as part of `check` or the pre-commit hook. It is a
review-time quality gate.

**Examples:**

```sh
markspec lint docs/requirements.md
markspec lint --strict "docs/**/*.md"
markspec lint --format json "docs/**/*.md"
```

### Lockfile and external sync

#### lock

Generate or refresh `markspec.lock`. The lockfile pins upstream profile and
language-pack versions, and records the sync mappings discovered from
`project.yaml`. See
[ADR-022](../architecture/adr-022-lockfile-and-external-sync.md).

```sh
markspec lock
```

| Flag       | Type   | Default | Description                                            |
| ---------- | ------ | ------- | ------------------------------------------------------ |
| `--check`  | bool   | false   | CI mode: read-only, exit `1` on drift.                 |
| `--update` | string | —       | Force re-resolve all upstreams, or one by `id`/`slug`. |
| `--format` | string | `text`  | Output format: `json`, `text`.                         |

**Examples:**

```sh
markspec lock                      # write or refresh markspec.lock
markspec lock --check              # CI gate: fail if lockfile is stale
markspec lock --update             # force re-resolve every upstream
markspec lock --update github-foo  # force re-resolve one upstream
```

#### sync

Read-only commands surfacing bound-entry state from `markspec.lock` and the
per-system NDJSON sync log under `.markspec/sync/<system>/log.ndjson`. `push` /
`pull` / `resolve` / `init` are connector-side and ship in per-tool ADRs.

```sh
markspec sync status [system]
markspec sync log    [system]
markspec sync show   <displayId>
```

**`sync status`** — group bound entries by `remote_state`:

| Flag       | Type   | Default | Description                                                                                                       |
| ---------- | ------ | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `--state`  | string | —       | Filter to one `remote_state` (`ok`, `behind`, `ahead`, `conflict`, `unreachable`, `deleted-upstream`, `unbound`). |
| `--format` | string | `text`  | Output format: `json`, `text`.                                                                                    |

**`sync log`** — tail the per-system sync log (NDJSON):

| Flag       | Type   | Default | Description                                              |
| ---------- | ------ | ------- | -------------------------------------------------------- |
| `--tail`   | number | `20`    | Number of lines from the end.                            |
| `--op`     | string | —       | Filter to one op: `push`, `pull`, `conflict`, `resolve`. |
| `--since`  | string | —       | Filter to entries at or after this RFC 3339 timestamp.   |
| `--format` | string | `text`  | Output format: `json`, `text`.                           |

**`sync show`** — full sync state for one bound entry:

| Flag       | Type   | Default | Description                    |
| ---------- | ------ | ------- | ------------------------------ |
| `--format` | string | `text`  | Output format: `json`, `text`. |

**Examples:**

```sh
markspec sync status                     # all systems, grouped by state
markspec sync status jira                # one system
markspec sync status --state conflict    # only conflicting entries
markspec sync log jira --tail 50 --op conflict
markspec sync show STK_BRK_0001
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

#### profile new

Scaffold a new profile directory with a starter manifest.

```sh
markspec profile new <id>
```

`<id>` must be lowercase alphanumeric with hyphens, optionally scoped
(`@org/name`).

```sh
markspec profile new my-profile
markspec profile new @acme/iso26262
```

Creates `<id>/markspec.yaml` and `<id>/README.md`.

#### profile add

Add a profile to the project's `.markspec.yaml`.

```sh
markspec profile add <spec>
```

`<spec>` is a local path or a scoped package name.

```sh
markspec profile add ./profiles/my-profile
markspec profile add @driftsys/iso26262
```

#### profile publish

Validate a profile manifest for publishability and print any issues.

```sh
markspec profile publish [--dir <dir>] [--format json|text]
```

Checks required fields (`id`, `version`), warns about missing `description` and
`license`, and reports any manifest validation errors. Exits `0` when the
manifest is publish-ready.

#### profile describe

Show full details for a profile element (type, attribute, relation, label, or
convention).

```sh
markspec profile describe <kind> <name>
```

`kind` is one of: `type`, `attribute`, `relation`, `label`, `convention`.

```sh
markspec profile describe type requirement
markspec profile describe attribute ASIL
markspec profile describe relation Satisfies
```

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

##### Project discovery

`markspec mcp` resolves the project root from the first of these that contains a
`project.yaml` or `.markspec.yaml` (walking upward from each):

1. `--root <path>` — pass the flag once per candidate root.
2. `MARKSPEC_PROJECT_ROOT` — colon-separated list of candidate roots.
3. `CLAUDE_PROJECT_DIR` — injected automatically by Claude Code (v2.1.139+); no
   configuration needed.
4. The server's launch working directory.

If none resolves, every MarkSpec tool replies with a message that begins "No
MarkSpec project found …" and names the directories it searched. Set `--root` or
`MARKSPEC_PROJECT_ROOT` to point the server at your project — this is the
reliable fix when it is launched from outside the project tree (for example a
user-scoped MCP install, whose working directory is the plugin cache, or a
monorepo opened at a parent directory).

```sh
markspec mcp --root /path/to/your/markspec-project
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

#### mcp install

Print MCP server configuration for a client. The output is the client's native
config snippet — pipe it to the client's settings file or copy-paste it.

```sh
markspec mcp install --client <client>
```

| Flag            | Type   | Default             | Description                                                                                                                |
| --------------- | ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--client`      | string | —                   | Client ID: `claude-desktop`, `cursor`, `vscode`.                                                                           |
| `--binary-path` | string | invoked binary name | Explicit path to the `markspec` binary. Default writes the invoked name (resolves via `PATH`, surviving package upgrades). |

**Examples:**

```sh
markspec mcp install --client claude-desktop
markspec mcp install --client cursor
markspec mcp install --client vscode
markspec mcp install --client claude-desktop --binary-path /opt/markspec/bin/markspec
```

#### lsp install

Print LSP server configuration for an editor. The output is the editor's native
config snippet (JSON for VS Code, Lua for Neovim, JSON for Zed) — pipe it to the
editor's settings file or copy-paste it.

```sh
markspec lsp install --editor <editor>
```

| Flag            | Type   | Default             | Description                                                                                                                |
| --------------- | ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--editor`      | string | —                   | Editor ID: `vscode`, `neovim`, `zed`.                                                                                      |
| `--binary-path` | string | invoked binary name | Explicit path to the `markspec` binary. Default writes the invoked name (resolves via `PATH`, surviving package upgrades). |

**Examples:**

```sh
markspec lsp install --editor vscode
markspec lsp install --editor neovim
markspec lsp install --editor zed
markspec lsp install --editor vscode --binary-path /opt/markspec/bin/markspec
```

### Not yet implemented

These commands are registered but print an error and exit:

| Command      | Intended purpose               |
| ------------ | ------------------------------ |
| `book dev`   | Live preview with hot reload   |
| `deck build` | Slides → PDF via Touying/Typst |
| `deck dev`   | Live slide preview             |

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

**Source file context guard** — in source files (Rust, Kotlin, Java, C, C++,
TypeScript, TSX, JavaScript, C#), completions only activate near entry markers
or trace keywords. The server won't interfere with your language's native LSP
(rust-analyzer, kotlin-lsp, etc.).

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
