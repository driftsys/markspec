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

### Manual download

Pre-built binaries are attached to every GitHub Release. Download the archive
for your platform, extract the `markspec` binary, and place it anywhere on your
`PATH`.

| Platform         | File                            |
| ---------------- | ------------------------------- |
| macOS (Apple)    | `markspec-macos-aarch64.tar.gz` |
| macOS (Intel)    | `markspec-macos-x86_64.tar.gz`  |
| Linux (x86_64)   | `markspec-linux-x86_64.tar.gz`  |
| Linux (aarch64)  | `markspec-linux-aarch64.tar.gz` |
| Windows (x86_64) | `markspec-windows-x86_64.zip`   |

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
# markspec 0.5.0 (core-schema 1)
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
