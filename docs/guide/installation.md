# Installation

MarkSpec is a single self-contained binary plus an optional VS Code extension
that bundles it. Pick the onboarding path that matches how you work.

## Choose your path

### Path 1 — VS Code + Copilot (2 steps)

You want inline diagnostics and Copilot-assisted authoring. No separate CLI
install needed — the extension bundles the `markspec` binary.

1. Install the **MarkSpec** extension (`driftsys.markspec-ide`) from the
   Marketplace (see [VS Code Marketplace](#vs-code-marketplace) below).
2. Open a folder that contains `.md` files. The extension activates, starts the
   language server, and registers its MCP server for Copilot automatically.

### Path 2 — Claude Code (4 steps)

You want the CLI, the editor extension, and the MarkSpec MCP server wired into
Claude Code.

1. Install the CLI (see [Binary install](#binary-install) below).
2. Install the **MarkSpec** extension from the Marketplace or
   [Open VSX](#open-vsx).
3. In your project root, run `markspec init` (see
   [Project setup with `markspec init`](#project-setup-with-markspec-init)).
   This writes `.mcp.json` so Claude Code discovers the MarkSpec MCP server.
4. Restart Claude Code (or reload the window) so it picks up `.mcp.json`.

### Path 3 — opencode (4 steps)

Same as Claude Code, but step 3's `markspec init` writes `opencode.json` instead
of `.mcp.json`, and step 4 reloads opencode.

1. Install the CLI (see [Binary install](#binary-install)).
2. Install the **MarkSpec** extension from the Marketplace or
   [Open VSX](#open-vsx).
3. Run `markspec init` in your project root — it detects opencode and writes
   `opencode.json`.
4. Reload opencode so it picks up the MCP server.

## VS Code extension

The **MarkSpec** extension (`driftsys.markspec-ide`) bundles the language server
directly, giving you real-time diagnostics, completions, and go-to-definition
with zero extra configuration.

### VS Code Marketplace

From the Extensions panel:

1. Open the Extensions panel (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Search for **MarkSpec**.
3. Click **Install** on `driftsys.markspec-ide`.

Or from the command line:

```sh
code --install-extension driftsys.markspec-ide
```

### Open VSX

For editors that use the Open VSX registry (VSCodium, Cursor, Gitpod, …) the
same extension is published at
<https://open-vsx.org/extension/driftsys/markspec-ide>:

```sh
# any editor whose CLI is configured against Open VSX
codium --install-extension driftsys.markspec-ide
```

> See [VS Code extension](editor-vscode.md) for the full feature list, settings
> reference, and troubleshooting.

## Binary install

A self-contained binary without any runtime requirement.

### macOS / Linux (install script)

```sh
curl -fsSL https://raw.githubusercontent.com/driftsys/markspec/main/install.sh | sh
```

The script:

1. Detects your platform and architecture.
2. Downloads the release binary from GitHub Releases.
3. Verifies the SHA256 checksum.
4. Places the binary in `~/.local/bin`.

Add `~/.local/bin` to your `PATH` if it is not already there:

```sh
# bash / zsh
export PATH="$HOME/.local/bin:$PATH"
```

### Windows (PowerShell install script)

Run in PowerShell 5.1 (ships with Windows 10/11) or PowerShell 7+:

```powershell
irm https://raw.githubusercontent.com/driftsys/markspec/main/install.ps1 | iex
```

The script:

1. Verifies the host is x86_64. ARM Windows is not supported yet.
2. Downloads `markspec-x86_64-pc-windows-msvc.tar.gz` and its SHA-256.
3. Verifies the checksum with `Get-FileHash`.
4. Extracts `markspec.exe` with `tar` (bundled on Windows 10 1803+).
5. Places the binary in `%USERPROFILE%\.local\bin` (override with the
   `MARKSPEC_INSTALL_DIR` environment variable).

The installer does not modify your `PATH` automatically. If `markspec` is not on
your `PATH`, the script prints both a session-scope and user-scope command. To
make the install permanent:

```powershell
[Environment]::SetEnvironmentVariable(
  'Path',
  "$HOME\.local\bin;" + [Environment]::GetEnvironmentVariable('Path', 'User'),
  'User'
)
```

Open a new terminal and run `markspec --version` to verify.

> **Antivirus / SmartScreen.** On the first run a freshly downloaded
> `markspec.exe` may trigger a SmartScreen or AV prompt because the binary is
> not yet Authenticode-signed
> ([#403](https://github.com/driftsys/markspec/issues/403) tracks code signing).
> Allow it once and the prompt does not return.

### Manual download

Pre-built binaries are attached to every GitHub Release. Download the archive
for your platform, extract the `markspec` binary, and place it anywhere on your
`PATH`.

| Platform         | File                                     |
| ---------------- | ---------------------------------------- |
| macOS (Apple)    | `markspec-macos-aarch64.tar.gz`          |
| macOS (Intel)    | `markspec-macos-x86_64.tar.gz`           |
| Linux (x86_64)   | `markspec-linux-x86_64.tar.gz`           |
| Linux (aarch64)  | `markspec-linux-aarch64.tar.gz`          |
| Windows (x86_64) | `markspec-x86_64-pc-windows-msvc.tar.gz` |

### Deno (from source)

If you already use Deno and prefer running from source:

```sh
deno install -g jsr:@driftsys/markspec
```

Binary is placed in `~/.deno/bin`. Run without installing:

```sh
deno run jsr:@driftsys/markspec --help
```

### Verify

```sh
markspec --version
# markspec <version> (core-schema <n>)
```

## Project setup with `markspec init`

Once the CLI is installed, scaffold a project in one command:

```sh
markspec init
```

In an empty (or existing) project root this writes:

- `project.yaml` — minimal project metadata
- `.markspec.yaml` — profile chain (defaults to the bundled profile)
- `markspec.lock` — toolchain floor pinned to the running CLI's minor version
- `.vscode/extensions.json` — recommends `driftsys.markspec-ide`
- MCP config for each detected agent client:
  - **Claude Code** → `.mcp.json` at the repo root
  - **opencode** → `opencode.json` at the repo root
- The MarkSpec skills bundle via `upskill add` (skipped with a warning if
  `upskill` is not installed)

VS Code + Copilot needs no MCP file — the bundled extension handles that wiring
once the `.vscode/extensions.json` recommendation is in place.

> **Non-default profiles need `markspec lock`.** `init` writes `markspec.lock`
> with **no upstreams** — it does not fetch or resolve the profile chain (init
> performs no network I/O). With the bundled default profile that stub is the
> final, correct lock. With a git or local profile (`--profile git+…` /
> `--profile ./path`), `init` warns `LOCKFILE_STUB_NEEDS_PIN`; run
> [`markspec lock`](cli.md#lock) once to resolve and pin the profile's
> upstreams.

> See [AI agents and skillset](ai-agents.md) for the full `markspec init` flag
> reference (`--client`, `--profile`) and MCP server details.

## AI assistant skillset (upskill)

MarkSpec ships a Claude Code skillset that teaches AI assistants the MarkSpec
authoring conventions — entry block syntax, EARS patterns, the agent write loop,
and traceability review.

Install it with [upskill](https://github.com/driftsys/upskill):

```sh
upskill add driftsys/markspec:skills/markspec-core.bundle.yaml
```

This registers the following skills under `.claude/`, `.github/`, `.opencode/`,
and `.agents/`:

| Skill                               | Purpose                                  |
| ----------------------------------- | ---------------------------------------- |
| `markspec-entry-authoring`          | Entry block syntax, shapes, attributes   |
| `markspec-core-rules`               | Validation rules and diagnostic codes    |
| `markspec-write-loop`               | The `insert → fmt → check` agent loop    |
| `markspec-gherkin`                  | GWT / Gherkin pattern for test entries   |
| `markspec-traceability-review`      | Cross-file link review agent             |
| `markspec-profile-bundle-authoring` | Writing and publishing profile manifests |

> See [AI agents and skillset](ai-agents.md) for MCP server setup and how to use
> the skills from Claude Code or Claude Desktop.
