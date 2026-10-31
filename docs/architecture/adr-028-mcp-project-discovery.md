# ADR-028 — MCP project-root discovery

Status: Accepted (2026-07-01)\
Related: [ADR-023](./adr-023-mcp-trigger-language.md) — this ADR governs how the
project root is _found_; ADR-023 governs the trigger language and soft-gate
message that fires when it is not found. Fixes #641.

## Context

The MCP server (`markspec mcp`) discovers its project root by walking **up from
its own launch working directory** (`mcp/project.ts`,
`createProject(defaultEnv())` → `Deno.cwd()`) and consults no other signal. The
install adapters write `{ command, args: ["mcp"] }` with no `cwd` or `env`, so
the server inherits whatever directory the client happened to launch it from.

This breaks in a documented, reproducible way for Claude Code:

- **User-scoped MCP servers launch with `cwd` = `~/.claude/plugins/cache/…`**,
  not the project (Claude Code issue #42687). Walking up from the plugin cache
  never reaches the project.
- **MCP `roots` (`roots/list`) is advertised but not implemented** by Claude
  Code; calling it times out after roughly 5 seconds and returns nothing (Claude
  Code issue #3315, "not planned"). Roots is not a usable discovery channel on
  the affected client.
- **No config variable interpolation** — `${workspaceFolder}` / `${VAR}` are not
  expanded in `.mcp.json`, so an install adapter cannot inject a workspace path
  into the launch config.
- **`CLAUDE_PROJECT_DIR` is auto-injected** into every stdio MCP subprocess as
  of Claude Code v2.1.139+, pointing at the project root (Claude Code issue
  #58121). Reading it is a zero-config fix for the reported failure mode.

The soft-gate message from ADR-023 also never said which directory was searched,
making the failure hard to diagnose from the agent's side.

## Decision

### 1. Ordered candidate resolution, first match wins

The MCP server resolves the root by walking an ordered list of candidate
directories and adopting the **first** one whose discovery finds a project
(`project.yaml` or `.markspec.yaml`). As built, `discover()` in
`mcp/workspace.ts` runs this loop for the MCP server (section 7 adds the
downward search to each candidate); `createProject` in `mcp/project.ts` runs the
upward-only form of the same loop for `markspec desk`:

```text
candidates = [ ...--root flags, ...MARKSPEC_PROJECT_ROOT split on ':', CLAUDE_PROJECT_DIR?, cwd ]
```

Precedence (highest to lowest): repeatable `--root <path>` flag →
colon-separated `MARKSPEC_PROJECT_ROOT` env → `CLAUDE_PROJECT_DIR` env (Claude
Code's auto-injected variable) → the server's launch `cwd`. `cwd` is always the
last, guaranteed candidate — it is what the server used exclusively before this
ADR.

Every candidate is trimmed of surrounding whitespace before use; blank segments
are dropped. In `discover()`, a candidate that repeats an earlier one, as given
or after symlink resolution, is skipped, so it is not scanned twice. Root
resolution (`project.yaml` first, then `.markspec.yaml`) is otherwise unchanged
— only the _set of start directories_ grows from `[cwd]` to the ordered list.

### 2. Resolved once at startup, after the connection is up

Every signal above is known synchronously when the process starts. The MCP
server connects its transport first and only then runs discovery
(`createWorkspace` in `mcp/workspace.ts`), so the `initialize` handshake never
waits for the downward scan of section 7. Every tool and resource handler waits
for discovery to finish before it answers; `tools/list` does not.

When discovery fails, the requests that waited for it get the error: a tool call
returns an `isError` result and a resource request is rejected. The server then
forgets the failed attempt, and the next tool call or resource request,
including `markspec_refresh`, starts a new attempt. When `markspec_refresh` is
the request that starts the new attempt, discovery runs twice: first the new
attempt, then the rediscovery that `markspec_refresh` always runs. Requests that
arrive while an attempt runs wait for that attempt, so only one attempt runs at
a time. There is no background retry and no timer: a new attempt starts only
when a request arrives. The notifications of section 7 are connected once, to
the workspace of the attempt that succeeds.

The server sets no timeout on discovery. A discovery that never finishes blocks
every request that waits for it: tool calls, `resources/list`, and
`resources/read`. A client that sets its own request time limit ends such a
request when that limit expires; a client without one keeps waiting. Such a
discovery stays stuck until the server restarts, as before this retry was added;
a server-side timeout would add code for a case that has not occurred.

Each `Project` stays **set-once**: no getters, no mutation, no async
re-resolution after it is opened. This avoids restructuring `Project`'s five
tool/resource-facing fields (`projectRoot`, `markspecDetected`, `config`,
`profileChain`, `profile`) around a mutable or lazily-resolved root. The set of
projects is the only mutable part: section 7 introduces an `McpWorkspace` that
holds one `Project` per discovered root and swaps the set on `markspec_refresh`.

### 3. MCP `roots` is not used

`roots/list` is not called anywhere in the discovery path. Advertised-but-
unimplemented support on Claude Code means a call would time out (~5s) for no
working consumer today; adopting it would also require restructuring `Project`
around an async, re-resolvable root. Revisit only if a real client implements
`roots/list`.

### 4. Rich soft-gate message names every searched directory

`SOFT_GATE_MESSAGE` (the load-bearing literal prefix from ADR-023, "No MarkSpec
project found…") stays as-is for existing callers.
`buildSoftGateMessage(searchedDirs, options)` (`mcp/project.ts`) lists every
candidate directory that was searched and names the two remedies. The MCP
workspace exposes it as `McpWorkspace.softGateMessage` (set only when no project
was found); `createProject` exposes it as `Project.softGateMessage` for
`markspec desk`. Only the MCP workspace passes `searchedBelow: true`, which adds
the last line below, because only it searches below each directory:

```text
No MarkSpec project found in this workspace.
Searched from: <dir1>, <dir2>, … (walked upward for .markspec.yaml / project.yaml).
Point the server at your project with `markspec mcp --root <path>` or the
MARKSPEC_PROJECT_ROOT environment variable. This server has no work to do here —
stop calling MarkSpec tools.
Also searched below each directory for nested MarkSpec projects.
```

Both MCP dispatch sites (`mcp/tools/mod.ts`, `mcp/resources/mod.ts`) return
`workspace.softGateMessage` instead of the bare constant. The literal phrase "No
MarkSpec project found" is preserved at the start of the message, keeping the
ADR-023 SKIP-rule trigger intact.

### 5. Override surface

- `markspec mcp --root <path>` — repeatable Cliffy option (`collect: true`),
  forwarded through `startServer({ rootFlags })` into `defaultEnv(flagRoots)`.
- `MARKSPEC_PROJECT_ROOT` — colon-separated (POSIX `PATH`-style) list of
  candidate roots, read from `Deno.env` in `defaultEnv`.
- `CLAUDE_PROJECT_DIR` — read automatically; no configuration needed on Claude
  Code v2.1.139+.

`buildRootOverrides(flagRoots, markspecProjectRoot, claudeProjectDir)` is the
pure ordering helper (`mcp/project.ts`); `ProjectEnv.rootOverrides()` is the
seam that lets the resolution loops (`discover()` in `mcp/workspace.ts`,
`createProject` in `mcp/project.ts`) stay unit-testable without touching
`Deno.env`.

### 6. Install adapters are not wired up in this change

No install adapter passes `--root` in this ADR. Claude Code does not expand
`${workspaceFolder}`-style tokens in `.mcp.json`, and the auto-injected
`CLAUDE_PROJECT_DIR` already covers that client without any adapter change.
Tracked as follow-up #644.

### 7. Downward discovery: every project under the start folder is answered

After the start folder is resolved (sections 1 and 2), the server also searches
below it for further MarkSpec projects. It uses the same gitignore-aware file
walk as `markspec check`, honours the `exclude:` list of each enclosing
project's `.markspec.yaml` (patterns are relative to the project that declares
them and apply to the folders below it; a nested root covered by the `exclude:`
of any ancestor root is dropped), and finds every `project.yaml` and
`.markspec.yaml`. Each config file resolves to a root the same way a document
there would, so a `.markspec.yaml` below a `project.yaml` does not start a
project of its own.

- A nested project is a separate project. Its entries are not merged into the
  enclosing project's graph, and it is compiled and validated against its own
  profile.
- This split is intended, and it differs from the CLI: bare `markspec check`
  still checks the enclosing tree as one graph, nested projects included. MCP
  `validate` can therefore disagree with `check` for nested projects. A display
  ID declared once in each of two nested projects is a duplicate for `check`
  (MSL-R006 / MSL-I008) but not for MCP `validate`, and a `Satisfies:` that
  points from one nested project into another resolves for `check` but is
  unresolved for MCP `validate`.
- Every tool and resource answers for all discovered projects and labels each
  result `## Project: <label>`, where the label is the project root relative to
  the primary root (the config root found by walking up from the start folder,
  or the start folder itself when none is above it; `.` for the primary
  project). Every tool except `project_list` accepts an optional `project`
  argument that limits the answer to one label. The `project_list` tool lists
  the labels.
- When several projects are selected and one fails, its section reads
  `Error: <message>` and the others still answer. With one selected project the
  error propagates unchanged, so single-project output stays byte-identical.
- There is never a downward scan from a filesystem root or from `$HOME` (when
  the primary root is one of them), even when that folder holds a config of its
  own. Such a folder's own project is still served; without a config it yields
  no projects.
- Discovery runs after the transport is connected (section 2). With exactly one
  project, output is unchanged and the project starts compiling as soon as
  discovery ends. With several, each project compiles on first use, and
  `resources/list` and the tools compile or render the selected projects at the
  same time, keeping label order in the output.
- `markspec_refresh` runs discovery again, so projects added or removed after
  startup are picked up. It is exempt from the soft gate: it re-runs discovery
  first and returns the soft-gate text when no project is found, whatever its
  `project` argument names.
- A `markspec://delivered/...` document is read from the first project, in label
  order, that delivers that path from that profile.
- A repository that keeps a folder with its own config as a fixture can list
  that folder in `exclude:` of the enclosing `.markspec.yaml`, so the MCP server
  does not treat it as a separate project. The MCP compile walk does not apply
  `exclude:`, so the enclosing project's MCP graph still includes the folder's
  entries. `exclude:` also removes the folder from the scope of
  `markspec check`, `markspec lint`, `markspec fmt`, and the LSP, which then do
  not check, lint, format, or index its files at all.

This supersedes the earlier decision to skip downward search (follow-up #645).

## Consequences

- `markspec mcp` now finds the project in the previously-broken case
  (user-scoped install, `cwd` = plugin cache) with zero configuration on Claude
  Code v2.1.139+, via `CLAUDE_PROJECT_DIR`.
- CI and any client whose launch `cwd` is wrong can force the root explicitly
  via `--root` or `MARKSPEC_PROJECT_ROOT`, which always outrank `cwd`.
- The soft-gate message is more diagnosable: it names every directory that was
  searched instead of staying silent about what was tried.
- `Project` remains a plain, set-once value — no async re-resolution path inside
  it. The only mutable state is the project set held by `McpWorkspace` (§7),
  which `markspec_refresh` replaces through `rediscover()`.
- A `.markspec.yaml`-only candidate (`markspecDetected = true`, no
  `project.yaml` anywhere upward) resolves `projectRoot` to the directory
  containing `.markspec.yaml` (#647, fixed). Compile-backed tools work fully for
  these projects; `Project.config` stays `undefined` since no `project.yaml`
  exists to load.

## Alternatives considered

- **MCP `roots` (`roots/list`) as the idiomatic primary channel.** Rejected:
  Claude Code advertises the capability but does not implement `roots/list` —
  calling it times out after ~5s (Claude Code issue #3315). Adopting it would
  also require an async restructure of `Project` for no working consumer today.
- **Per-tool-call `cwd` argument.** Rejected: not idiomatic for MCP tools and
  burdens the calling model with plumbing a path on every call.
- **Install-adapter `--root ${workspaceFolder}` wiring.** Deferred (#644):
  Claude Code does not interpolate config variables in `.mcp.json`, so wiring a
  literal token into an adapter-written config would silently produce a broken
  override.
- **Bounded downward search that picks one project.** Rejected: ambiguous when
  the opened root contains more than one project. Section 7 answers all of them
  instead (#645).

## References

- Issue #641 — MCP server fails to locate a valid project in some session
  contexts.
- [ADR-023](./adr-023-mcp-trigger-language.md) — the soft-gate message this ADR
  enriches; the load-bearing "No MarkSpec project found" phrase originates
  there.
- Claude Code issue #42687 — user-scoped MCP servers launch with `cwd` set to
  the plugin cache directory.
- Claude Code issue #3315 — `roots/list` advertised but not implemented; callers
  time out (~5s), marked "not planned".
- Claude Code issue #58121 — `CLAUDE_PROJECT_DIR` auto-injected into stdio MCP
  subprocesses as of v2.1.139.
- As-built: `packages/markspec/mcp/project.ts` (`buildRootOverrides`,
  `buildSoftGateMessage`, `defaultEnv`'s env-read, and the upward-only loop in
  `createProject` used by `markspec desk`), `packages/markspec/mcp/workspace.ts`
  (`discover()`, the MCP candidate loop with downward discovery, and
  `McpWorkspace.softGateMessage`),
  `packages/markspec/core/discovery/projects.ts` (`discoverProjectRoots`,
  `findNestedProjectRoots`), `packages/markspec/mcp/server.ts` (`startServer`:
  connect first, then discovery; root-flag passthrough),
  `packages/markspec/cli/commands/mcp_cmd.ts` (`--root` flag),
  `packages/markspec/mcp/tools/mod.ts` and
  `packages/markspec/mcp/resources/mod.ts` (dispatch through
  `workspace.softGateMessage`), `packages/markspec/mcp/project_test.ts`,
  `packages/markspec/mcp/workspace_test.ts`.
