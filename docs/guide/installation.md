# Installation

MarkSpec ships as a single self-contained binary. There are three ways to get
started, ordered by the experience they give you:

## VS Code extension (recommended)

The **MarkSpec** extension (`driftsys.markspec-ide`) bundles the language server
directly. Install it and you get real-time diagnostics, completions, and
go-to-definition with zero extra configuration.

**Install from the marketplace:**

1. Open VS Code.
2. Open the Extensions panel (`Ctrl+Shift+X` / `Cmd+Shift+X`).
3. Search for **MarkSpec**.
4. Click **Install** on the `driftsys.markspec-ide` extension.

The extension prompts you to install or locate the `markspec` binary the first
time it activates. Click **Download** to let it fetch the platform binary
automatically, or point it at an existing install.

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
# markspec 0.6.0 (core-schema 1)
```

## AI assistant skillset (upskill)

MarkSpec ships a Claude Code skillset that teaches AI assistants the MarkSpec
authoring conventions — entry block syntax, EARS patterns, the agent write loop,
and traceability review.

Install it with [upskill](https://github.com/driftsys/upskill):

```sh
upskill add markspec:markspec-core.bundle.yaml
```

This registers the following skills in your project's `.claude/plugins/`:

| Skill                               | Purpose                                     |
| ----------------------------------- | ------------------------------------------- |
| `markspec-entry-authoring`          | Entry block syntax, shapes, attributes      |
| `markspec-core-rules`               | Validation rules and diagnostic codes       |
| `markspec-write-loop`               | The `insert → format → validate` agent loop |
| `markspec-gherkin`                  | GWT / Gherkin pattern for test entries      |
| `markspec-traceability-review`      | Cross-file link review agent                |
| `markspec-profile-bundle-authoring` | Writing and publishing profile manifests    |

> See [AI agents and skillset](ai-agents.md) for MCP server setup and how to use
> the skills from Claude Code or Claude Desktop.
