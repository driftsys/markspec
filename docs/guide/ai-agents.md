# AI agents and skillset

MarkSpec integrates with AI assistants at two levels:

- **MCP server** — exposes the compiled entry graph to any MCP-capable agent so
  it can query entries, search by display ID, and read traceability context.
- **Skillset** — teaches the agent MarkSpec's authoring conventions so it can
  write and review entries correctly without constant guidance.

## Setting up a new project

Run `markspec init` in an empty directory to scaffold everything you need:

```bash
markspec init
```

This writes:

- `project.yaml` — minimal project metadata
- `.markspec.yaml` — profile chain (defaults to the bundled profile)
- `markspec.lock` — toolchain pin at the running CLI's minor version
- `.vscode/extensions.json` — recommends the `driftsys.markspec-ide` extension
- MCP config for each detected client:
  - **Claude Code** → `.mcp.json` at repo root
  - **opencode** → `opencode.json` at repo root
- Skills bundle via `upskill add` (warns and continues if `upskill` is not
  installed)

### Targeting specific clients

Auto-detection covers Claude Code and opencode. Force a client with `--client`:

```bash
markspec init --client claude-code --client opencode
```

For `claude-desktop`, run `markspec mcp install --client claude-desktop`
separately — it writes to user-scope config (`~/.claude/`) outside the project
directory and is intentionally not part of `markspec init`.

For VS Code + Copilot, no MCP file is written — the bundled
`driftsys.markspec-ide` extension handles the wiring once the
`.vscode/extensions.json` recommendation is in place.

### Profile selection

`--profile <spec>` accepts any of:

- `bundled` (the default; explicit form)
- `false` (equivalent to `--no-profile`, core-only mode)
- `git+https://...` / `git+ssh://...` (git URL)
- `./relative/path` or `/absolute/path` (local profile directory)

See `markspec init --help` for the full flag list.

## MCP server

The MCP server runs as a subcommand of the same `markspec` binary:

```sh
markspec mcp
```

It speaks the Model Context Protocol over stdio JSON-RPC and exposes the
following tools:

| Tool                 | Description                                                     |
| -------------------- | --------------------------------------------------------------- |
| `entry_search`       | Fuzzy search entries by display ID or title                     |
| `entry_show`         | Show one entry's full detail (body, outgoing + incoming links)  |
| `entry_list`         | Spec overview (per-type counts) or paginated listing of entries |
| `entry_context`      | Walk the `Satisfies` chain upward from an entry                 |
| `entry_neighborhood` | Show an entry's parents (up) and children (down) as a subgraph  |
| `validate`           | Run validation and return structured diagnostics                |
| `markspec_refresh`   | Re-index the workspace after file changes                       |
| `profile_describe`   | Describe the active profile's types, attributes, and relations  |

Upstream entries (imported from locked `dependencies:` / `references:`) are
visible to `entry_show`, `entry_list`, and `entry_context` through the shared
compile cache — no separate tool. `entry_show` marks them with a
`from upstream <name>@<version> (read-only)` origin badge and annotates their
location as `(in upstream <name>)` because the file lives in another repository;
`entry_context` tags each upstream node in the chain with a lighter
`— from <name>@<version>` suffix.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "markspec": {
      "command": "markspec",
      "args": ["mcp"]
    }
  }
}
```

Generate the snippet automatically:

```sh
markspec mcp install --client claude-desktop
```

Pin a specific binary path (useful when the binary is not on `PATH` or when
package-manager upgrades would change the install location):

```sh
markspec mcp install --client claude-desktop \
  --binary-path /opt/markspec/bin/markspec
```

### Claude Code

`markspec mcp install --client claude-code` writes `.mcp.json` at the project
root. The file uses the same `mcpServers.markspec` shape as Claude Desktop and
is read automatically by Claude Code when it opens the directory.

```sh
markspec mcp install --client claude-code --scope workspace
markspec mcp install --client claude-code --scope workspace \
  --binary-path /opt/markspec/bin/markspec
```

The `--scope=user` flag is not supported for `claude-code` — the config is
always project-scoped (`.mcp.json` at the repo root).

### Cursor

```sh
markspec mcp install --client cursor
markspec mcp install --client cursor --binary-path /opt/markspec/bin/markspec
```

### opencode

`markspec mcp install --client opencode` writes `opencode.json` at the project
root. The file uses a flat `mcp.markspec` object with a `type: "local"` entry
(no `mcpServers` nesting), which matches the opencode JSON schema verified
against the [anomalyco/opencode](https://github.com/anomalyco/opencode)
repository.

```sh
markspec mcp install --client opencode --scope workspace
markspec mcp install --client opencode --scope workspace \
  --binary-path /opt/markspec/bin/markspec
```

The `--scope=user` flag is not supported for `opencode` — the config is always
project-scoped (`opencode.json` at the repo root).

### GitHub Copilot CLI

`markspec mcp install --client copilot` writes a Copilot-shaped MCP entry. It is
the one dual-scope client:

| Scope       | Path                         | Notes                              |
| ----------- | ---------------------------- | ---------------------------------- |
| `workspace` | `.github/mcp.json`           | Default; committable, per-repo     |
| `user`      | `~/.copilot/mcp-config.json` | Per-user, applies to every project |

```sh
markspec mcp install --client copilot                  # → .github/mcp.json
markspec mcp install --client copilot --scope user      # → ~/.copilot/mcp-config.json
markspec mcp install --client copilot --scope workspace \
  --binary-path /opt/markspec/bin/markspec
```

The entry nests under `mcpServers.markspec` like Claude Desktop, but the
local-server shape differs — it adds `type` and `tools`:

```json
{
  "mcpServers": {
    "markspec": {
      "type": "local",
      "command": "markspec",
      "args": ["mcp"],
      "tools": ["*"]
    }
  }
}
```

An omitted `--scope` defaults to `workspace`, matching the per-repo model of
`markspec init`. The `.github/mcp.json` path (verified against
`GitHub Copilot CLI 1.0.66`) is deliberately distinct from the `claude-code`
client's `.mcp.json` so the two clients never contend for one file.

**Editor / agent-mode surface.** `--client copilot` covers Copilot's _CLI_
surfaces only — the file-based sources the terminal reads (`.github/mcp.json`,
`~/.copilot/mcp-config.json`). Copilot's _in-editor_ agent mode is served
differently: the `driftsys.markspec-ide` extension (below) registers the MCP
server **programmatically** via VS Code's
`lm.registerMcpServerDefinitionProvider` API (VS Code 1.101+), so it lands in
the same agent-mode tool registry as a `.vscode/mcp.json` entry — without
markspec writing that file. The extension route reaches only the in-editor
agent; it cannot reach the Copilot CLI or a GitHub-hosted coding agent, which is
why those file-based surfaces need `--client copilot`.

This follows the **sanctioned-surfaces** policy: markspec writes MCP config only
via a vendor CLI or a user/workspace file the client reads, never a file an app
manages as its own private state. See
[#637](https://github.com/driftsys/markspec/issues/637) for the policy's wider
application to the Claude clients.

### VS Code (Copilot / Claude)

The VS Code extension registers the MCP server automatically — no extra
configuration needed. See [VS Code extension](editor-vscode.md#mcp-server).

## Skillset

The skillset is a bundle of Claude Code skills that teach AI assistants
MarkSpec-specific authoring conventions. Install it once per project; the skills
activate automatically when Claude Code opens the directory.

### Install with upskill

Install into the current project (writes per-client output under `.claude/`,
`.github/`, `.opencode/`, and `.agents/` and records the install in
`.upskill-lock.json`):

```sh
upskill add driftsys/markspec:skills/markspec-core.bundle.yaml
```

Install globally into `$HOME` instead, so the skills are available in every
project for the current user:

```sh
upskill add --global driftsys/markspec:skills/markspec-core.bundle.yaml
```

The bundle includes:

| Skill                               | Activates on                    | What it does                                                   |
| ----------------------------------- | ------------------------------- | -------------------------------------------------------------- |
| `markspec-entry-authoring`          | Any entry authoring request     | Guides the agent through correct block syntax and attributes   |
| `markspec-core-rules`               | Diagnostic triage               | Maps `MSL-` codes to their fix, suppression, and rationale     |
| `markspec-write-loop`               | File modification tasks         | Enforces the `insert → fmt → check` agent write loop           |
| `markspec-gherkin`                  | Test entry authoring            | Applies GWT / Gherkin structure to `test` entries              |
| `markspec-traceability-review`      | PR reviews, traceability audits | Walks the graph, checks coverage, flags orphaned entries       |
| `markspec-profile-bundle-authoring` | Profile manifest writing        | Validates manifest fields, extends chains, display-ID patterns |

### Manual install (without upskill)

If your team does not use upskill, download the bundle from the repository and
place it in `.claude/plugins/`:

```sh
curl -fsSL https://raw.githubusercontent.com/driftsys/markspec/main/skills/markspec-core.bundle.yaml \
  -o .claude/plugins/markspec-core.bundle.yaml
```

### Invoking skills from Claude Code

Skills activate automatically when the task matches. You can also invoke them
explicitly:

```
/markspec-write-loop
/markspec-traceability-review
```

## Agent write loop

The canonical pattern for AI-assisted requirement authoring is:

```text
markspec insert <type> <file>    # scaffold a new entry
markspec fmt <file>              # assign ULID, normalize indentation
markspec check <file>            # confirm no broken references
```

Each step produces structured output the agent can parse:

```sh
markspec insert requirement docs/requirements.md --print
markspec fmt docs/requirements.md
markspec check docs/requirements.md --format json
```

The `markspec-write-loop` skill enforces this sequence so agents don't skip the
format or validate steps.
