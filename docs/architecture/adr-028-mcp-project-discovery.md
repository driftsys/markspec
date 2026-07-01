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

`createProject` resolves the root by walking an ordered list of candidate
directories and adopting the **first** one whose upward walk detects a project
(`project.yaml` or `.markspec.yaml`):

```text
candidates = [ ...--root flags, ...MARKSPEC_PROJECT_ROOT split on ':', CLAUDE_PROJECT_DIR?, cwd ]
```

Precedence (highest to lowest): repeatable `--root <path>` flag →
colon-separated `MARKSPEC_PROJECT_ROOT` env → `CLAUDE_PROJECT_DIR` env (Claude
Code's auto-injected variable) → the server's launch `cwd`. `cwd` is always the
last, guaranteed candidate — it is what the server used exclusively before this
ADR.

Every candidate is trimmed of surrounding whitespace before use; blank segments
are dropped. Detection (`detectMarkspecProject`) and root resolution
(`discoverProjectRoot`) are otherwise unchanged — only the _set of start
directories_ grows from `[cwd]` to the ordered list.

### 2. Resolved once, synchronously, at startup

Every signal above is known synchronously when the process starts. `Project`
stays **set-once**: no getters, no mutation, no async re-resolution after
`createProject` returns. This avoids restructuring `Project`'s five
tool/resource-facing fields (`projectRoot`, `markspecDetected`, `config`,
`profileChain`, `profile`) around a mutable or lazily-resolved root.

### 3. MCP `roots` is not used

`roots/list` is not called anywhere in the discovery path. Advertised-but-
unimplemented support on Claude Code means a call would time out (~5s) for no
working consumer today; adopting it would also require restructuring `Project`
around an async, re-resolvable root. Revisit only if a real client implements
`roots/list`.

### 4. Rich soft-gate message names every searched directory

`SOFT_GATE_MESSAGE` (the load-bearing literal prefix from ADR-023, "No MarkSpec
project found…") stays as-is for existing callers. A new
`Project.softGateMessage` field, built by `buildSoftGateMessage(searchedDirs)`
(`mcp/project.ts`), lists every candidate directory that was searched and names
the two remedies:

```text
No MarkSpec project found in this workspace.
Searched from: <dir1>, <dir2>, … (walked upward for .markspec.yaml / project.yaml).
Point the server at your project with `markspec mcp --root <path>` or the
MARKSPEC_PROJECT_ROOT environment variable. This server has no work to do here —
stop calling MarkSpec tools.
```

Both dispatch sites (`mcp/tools/mod.ts`, `mcp/resources/mod.ts`) return
`project.softGateMessage` instead of the bare constant. The literal phrase "No
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
seam that lets `createProject`'s resolution loop stay unit-testable without
touching `Deno.env`.

### 6. Install adapters are not wired up in this change

No install adapter passes `--root` in this ADR. Claude Code does not expand
`${workspaceFolder}`-style tokens in `.mcp.json`, and the auto-injected
`CLAUDE_PROJECT_DIR` already covers that client without any adapter change.
Tracked as follow-up #644.

### 7. No downward search for a monorepo subdirectory

When the opened root is a monorepo parent containing a project in a
subdirectory, discovery does not search downward for it — only upward from each
candidate. The explicit `--root` / `MARKSPEC_PROJECT_ROOT` override is the
escape hatch. A downward search would be ambiguous when the parent holds
multiple projects. Tracked as follow-up #645.

## Consequences

- `markspec mcp` now finds the project in the previously-broken case
  (user-scoped install, `cwd` = plugin cache) with zero configuration on Claude
  Code v2.1.139+, via `CLAUDE_PROJECT_DIR`.
- CI and any client whose launch `cwd` is wrong can force the root explicitly
  via `--root` or `MARKSPEC_PROJECT_ROOT`, which always outrank `cwd`.
- The soft-gate message is more diagnosable: it names every directory that was
  searched instead of staying silent about what was tried.
- `Project` remains a plain, set-once, synchronously-constructed value — no new
  async re-resolution path, no new mutable state for tools/resources to reason
  about.
- A `.markspec.yaml`-only candidate still detects a project
  (`markspecDetected = true`) but can leave `projectRoot` undefined, exactly as
  before this ADR (`discoverProjectRoot` only recognizes `project.yaml`).
  Tracked as follow-up #647.

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
- **Bounded downward search for a project in a monorepo subdirectory.** Deferred
  (#645): ambiguous when the opened root contains more than one project; the
  explicit override already covers this case.

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
- As-built: `packages/markspec/mcp/project.ts` (`buildRootOverrides`, the
  ordered resolution loop in `createProject`, `buildSoftGateMessage`,
  `defaultEnv`'s env-read), `packages/markspec/mcp/server.ts` (`startServer`
  root-flag passthrough), `packages/markspec/cli/commands/mcp_cmd.ts` (`--root`
  flag), `packages/markspec/mcp/tools/mod.ts` and
  `packages/markspec/mcp/resources/mod.ts` (dispatch through
  `project.softGateMessage`), `packages/markspec/mcp/project_test.ts`.
