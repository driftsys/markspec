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
markspec init --client claude --client opencode
```

Claude Desktop is not a markspec target — its `claude_desktop_config.json` is
the desktop app's private state file, so markspec never writes it. Configure it
by hand (see [Claude Desktop](#claude-desktop) below).

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
| `project_list`       | List the discovered MarkSpec projects and their labels          |

Upstream entries (imported from locked `dependencies:` / `references:`) are
visible to `entry_show`, `entry_list`, and `entry_context` through the shared
compile cache — no separate tool. `entry_show` marks them with a
`from upstream <name>@<version> (read-only)` origin badge and annotates their
location as `(in upstream <name>)` because the file lives in another repository;
`entry_context` tags each upstream node in the chain with a lighter
`— from <name>@<version>` suffix.

### Several projects in one folder

The server finds every MarkSpec project at or below the folder it starts in. A
project is a folder that holds a `project.yaml` or a `.markspec.yaml`. A nested
project is a separate project: its entries are not merged into the enclosing
project's graph, and it uses its own profile. The search follows `.gitignore`
and the `exclude:` list of each enclosing project's `.markspec.yaml`: a
project's `exclude:` patterns are relative to that project and apply to the
folders below it. The server never scans down from a filesystem root or from
your home folder, even when that folder has a config of its own; that folder's
own project is still served. Discovery runs after the server has connected to
the client, so startup does not wait for it; the first tool call or resource
request waits until it is done. Listing the tools does not wait. If discovery
fails, that request returns the error, and the next tool call or resource
request runs discovery again. When that next request is `markspec_refresh`,
discovery runs twice: once for the retry, then once more for the rediscovery
that `markspec_refresh` always does.

With several projects:

- Every tool and resource answers for all projects. Except for `entry_search`
  (see below), each result sits under a `## Project: <label>` heading. The label
  is the project folder relative to the primary root: the nearest folder with a
  `project.yaml` (else a `.markspec.yaml`) found by walking up from the start
  folder, or the start folder itself when there is none. The primary root itself
  has the label `.`. When one project fails, its section reads
  `Error: <message>` under its `## Project: <label>` heading, and the other
  projects still answer.
- Every tool except `project_list` accepts an optional `project` argument with a
  label, which limits the answer to that project. An unknown label returns an
  error that lists the known labels.
- When `entry_search` selects several projects, it answers with one list instead
  of one section per project. It ranks the matches of all selected projects
  together by score and returns at most `limit` matches in total. Each match
  names its project: `(project: <label>, score N)`. A project that fails is
  listed after the matches, under `Errors:`, as
  `Error in project <label>: <message>`, and uses none of the limit. When only
  one project is selected, including through the `project` argument, the answer
  is the plain single-project list, without project tags or an `Errors:`
  section.
- `project_list` lists each project with its label, absolute root, active
  profile, and entry count once compiled.
- `validate` resolves relative `files` paths against the primary root and checks
  each file in the project that owns it.
- Each project compiles on first use, and the projects a request selects compile
  at the same time. With exactly one project, the output is the same as before
  and the project starts compiling as soon as discovery ends.
- `markspec_refresh` runs discovery again, so projects added or removed after
  startup are picked up.
- Reading a `markspec://entry/{id}` URI returns every project that holds that
  ID, under project headings.

Nested projects are separate graphs in the MCP server, but bare `markspec check`
still checks the enclosing folder tree as one graph, nested projects included.
This split is intended. As a result, MCP `validate` can differ from
`markspec check` for nested projects: a display ID declared once in each of two
nested projects is a duplicate for `check` but not for `validate`, and a
`Satisfies:` that points from one nested project into another resolves for
`check` but not for `validate`.

To stop the MCP server from treating a nested folder that has its own config
(for example a test fixture) as a separate project, list it under `exclude:` in
the enclosing `.markspec.yaml`:

```yaml
exclude:
  - "tests/fixtures/"
```

The MCP compile of the enclosing project then still includes the entries in that
folder, because the MCP compile does not apply `exclude:`. `exclude:` also
removes the folder from the scope of `markspec check`, `markspec lint`,
`markspec fmt`, and the LSP: they do not check, lint, format, or index its files
at all.

### Claude Desktop

markspec does **not** configure Claude Desktop — its
`claude_desktop_config.json` is the desktop app's own private state file, so
markspec leaves it to you (there is no `--client claude-desktop`). Add the
`markspec` server by hand to
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows), then restart the app:

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

### Claude Code

`markspec mcp install --client claude` writes `.mcp.json` at the project root.
The file uses the standard `mcpServers.markspec` shape and is read automatically
by Claude Code when it opens the directory.

```sh
markspec mcp install --client claude --scope workspace
markspec mcp install --client claude --scope workspace \
  --binary-path /opt/markspec/bin/markspec
```

The `--scope=user` flag is not supported for `claude` — the config is always
project-scoped (`.mcp.json` at the repo root).

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

The entry nests under `mcpServers.markspec` like Claude Code's `.mcp.json`, but
the local-server shape differs — it adds `type` and `tools`:

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
`GitHub Copilot CLI 1.0.66`) is deliberately distinct from the `claude` client's
`.mcp.json` so the two clients never contend for one file.

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
