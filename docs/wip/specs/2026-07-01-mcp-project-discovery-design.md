# MCP project discovery: env-var + cwd root resolution

**Date:** 2026-07-01 **Status:** approved (brainstorm), awaiting implementation
plan **Drives:** `markspec mcp` project-root discovery **Fixes:** #641

## Problem

The MarkSpec MCP server fails to locate a valid project in some session contexts
even though the project is correctly configured and `markspec check` passes from
the terminal.

Root cause (confirmed in code + Claude Code behaviour): the server discovers its
project root by walking **up from its own launch working directory** and nothing
else.

- `mcp/server.ts` calls `createProject(defaultEnv())` and `defaultEnv()` sets
  `cwd: () => Deno.cwd()` (`mcp/project.ts`); `createProject` walks up from that
  `cwd` via `discoverProjectRoot` / `detectMarkspecProject` and consults no
  other signal.
- The install adapters write `{ command, args: ["mcp"] }` — no `cwd`, no `env` —
  so the server inherits whatever directory the client launched it from.

Why that breaks (Claude Code, GitHub-issue-sourced — see the
`reference_claude_code_mcp_launch` memo):

- **User-scoped MCP servers launch with cwd = `~/.claude/plugins/cache/…`**, not
  the project (#42687). Walking up from the plugin cache never reaches the
  project — this is the reported failure.
- **MCP `roots` is advertised but not implemented** by Claude Code; calling
  `roots/list` times out ~5s and returns nothing (#3315, "not planned"). Roots
  is not a usable discovery channel here.
- **No config variable interpolation** (`${workspaceFolder}` / `${VAR}` are not
  expanded in `.mcp.json`), so an install adapter can't inject a workspace path.
- **`CLAUDE_PROJECT_DIR` is auto-injected** into every stdio MCP subprocess as
  of Claude Code v2.1.139+, pointing at the project root (#58121). Reading it is
  the zero-config fix.

The current soft-gate message also never says which directory was searched, so
the failure is hard to diagnose.

## Guiding principle

**Read the channel that works; don't rely on the launch `cwd` alone, and don't
depend on MCP roots (broken on the affected client).** An explicit operator
override always wins, for CI and for any client whose launch context is wrong.
Everything needed is known synchronously at process start — no protocol
round-trip, no async re-resolution.

## Decisions

| #  | Decision              | Choice                                                                                                                                     |
| -- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| D1 | Discovery signals     | `--root` flag, `MARKSPEC_PROJECT_ROOT` env, `CLAUDE_PROJECT_DIR` env, launch `cwd`                                                         |
| D2 | Precedence            | `--root` **>** `MARKSPEC_PROJECT_ROOT` **>** `CLAUDE_PROJECT_DIR` **>** `cwd` (first candidate whose upward-walk finds a project)          |
| D3 | MCP roots             | **Dropped.** Advertised-but-unimplemented on Claude Code → 5s timeout (#3315). Revisit only if a real client implements `roots/list`       |
| D4 | Override surface      | Repeatable `markspec mcp --root <path>` + `MARKSPEC_PROJECT_ROOT` (`:`-separated). `CLAUDE_PROJECT_DIR` is read automatically              |
| D5 | Resolution timing     | Resolved once at `createProject`; no re-discovery, no async restructure; `Project` fields stay set-once                                    |
| D6 | Soft-gate message     | Report the directories searched and name the override remedies; keep the literal `"No MarkSpec project found"` prefix (ADR-023)            |
| D7 | Monorepo subdirectory | Escape hatch only — `MARKSPEC_PROJECT_ROOT`/`--root`. No downward search (ambiguous when a parent holds multiple projects). Follow-up #645 |
| D8 | Install adapters      | No `--root` wiring this PR — no interpolation on Claude Code (#58121), and CLAUDE_PROJECT_DIR/roots-less clients differ. Follow-up #644    |

## Design

### 1. Ordered candidate resolution

Every signal is a **directory to start discovery from**. Resolution walks the
ordered candidate list and adopts the **first** candidate that MarkSpec detects
as a project:

```
candidates = [ ...--root flags, ...MARKSPEC_PROJECT_ROOT split, CLAUDE_PROJECT_DIR?, cwd ]
```

For each candidate, in order:

- `detectMarkspecProject(candidate)` (walks up for `project.yaml` **or**
  `.markspec.yaml`) — the first candidate that returns `true` is **the
  project**.
- For that winning candidate, `discoverProjectRoot(candidate)` (walks up for
  `project.yaml`) sets `projectRoot`; it may be `undefined` when only a
  `.markspec.yaml` exists, exactly as today.

If **no** candidate detects a project: `projectRoot = undefined`,
`markspecDetected = false`, and the full candidate list is retained as
`searchedDirs` so the soft-gate message can name them.

The mechanism (`discoverProjectRoot` / `detectMarkspecProject`) is unchanged;
only the _set of start dirs_ grows from `[cwd]` to the ordered list.

### 2. `ProjectEnv` seam addition

`ProjectEnv` gains one method; the rest is unchanged.

- `rootOverrides(): string[]` — the ordered, higher-priority candidates
  **before** `cwd`:
  `[...flagRoots, ...splitColon(MARKSPEC_PROJECT_ROOT),
  ...(CLAUDE_PROJECT_DIR ? [CLAUDE_PROJECT_DIR] : [])]`.
  Empty segments dropped.
- `cwd()`, `readFile`, `stat`, `walk` unchanged.

`defaultEnv(flagRoots: string[] = [])` builds `rootOverrides` by reading
`Deno.env.get("MARKSPEC_PROJECT_ROOT")` and `Deno.env.get("CLAUDE_PROJECT_DIR")`
(env access is allowed in the entry point). Tests supply an in-memory shim that
returns a fixed `rootOverrides` array, so precedence is fully unit-testable
without env mutation.

### 3. `createProject` changes (`mcp/project.ts`)

- Build `candidates = [...env.rootOverrides(), env.cwd()]`.
- Resolve per §1: set `projectRoot`, `markspecDetected`, and (on failure)
  `searchedDirs`. Load config + profile from `projectRoot` and kick the existing
  background compile exactly as today.
- No getters, no `resolveRoots`, no mutation — `Project`'s fields remain
  set-once because there is no re-resolution. The five fields tools/resources
  read (`projectRoot`, `markspecDetected`, `config`, `profileChain`, `profile`)
  keep their current `readonly` shape and identity.

### 4. Soft-gate message

`SOFT_GATE_MESSAGE` stays as the literal **prefix** constant (unchanged text,
preserved for ADR-023 and existing tests). Add `project.softGateMessage`
(computed from `searchedDirs`):

```
No MarkSpec project found in this workspace.
Searched from: <dir1>, <dir2>, … (walked upward for .markspec.yaml / project.yaml).
Point the server at your project with `markspec mcp --root <path>` or the
MARKSPEC_PROJECT_ROOT environment variable. This server has no work to do here —
stop calling MarkSpec tools.
```

The two dispatch sites (`tools/mod.ts:168`, `resources/mod.ts:111`) switch from
the const to `project.softGateMessage`.

### 5. CLI flag + passthrough

- `mcp_cmd.ts`: add a repeatable `--root <path:string>` option (`collect: true`)
  to the `markspec mcp` action; pass the collected array into
  `startServer({ rootFlags })`.
- `server.ts`: `startServer(options?: { rootFlags?: string[] })` forwards
  `options?.rootFlags ?? []` to `defaultEnv(...)`. No other reordering — the
  server keeps constructing the project before `connect()`.

## Error handling

- An override path that resolves to no project is retained in `searchedDirs` and
  surfaced by §4 naming it — deterministic, not a silent fallback to `cwd`.
- Existing compile-failure recovery (`inFlight` reset in `finally`) is
  untouched.
- No `listRoots()` call exists, so there is no timeout/hang path to guard.

## Testing

Unit (`mcp/project_test.ts`, in-memory `ProjectEnv` with a fixed
`rootOverrides`):

- `rootOverrides` first entry (simulating `--root`) beats a valid `cwd`.
- `CLAUDE_PROJECT_DIR`-only override resolves a project when `cwd` is a
  non-project dir.
- Precedence: a resolvable `MARKSPEC_PROJECT_ROOT` entry wins over a later
  `CLAUDE_PROJECT_DIR` entry that also resolves.
- No candidate resolves → `projectRoot` undefined, `markspecDetected` false,
  `softGateMessage` names every searched dir and keeps the literal prefix.
- `defaultEnv` unit: given `flagRoots` + fake env getters, `rootOverrides`
  returns them in `--root` → `MARKSPEC_PROJECT_ROOT` → `CLAUDE_PROJECT_DIR`
  order with empty segments dropped and `:`-split applied. (Extract the ordering
  as a small pure helper so it's testable without touching `Deno.env`.)

E2E (blackbox `markspec mcp`, `tests/e2e/`): spawn `markspec mcp` from a
non-project temp cwd with `MARKSPEC_PROJECT_ROOT` (then, separately,
`CLAUDE_PROJECT_DIR`) pointing at a fixture project, drive one `tools/call`, and
assert it returns real data, not the soft gate. Spawn with neither set from a
non-project cwd → the tool response includes the searched-dir soft-gate message.

## Alternatives considered

- **MCP roots (`roots/list`).** Rejected: advertised-but-unimplemented on Claude
  Code → 5s timeout (#3315). Would add async restructure + a mutable-getter
  `Project` for no working consumer today.
- **Per-tool-call `cwd` argument.** Rejected: not idiomatic; burdens the model
  on every call.
- **Bounded downward search for a subdir project.** Rejected (D7): ambiguous
  when a parent holds multiple projects; the explicit override covers it.
- **Adapter `--root ${workspaceFolder}` wiring.** Deferred (D8): no
  interpolation on Claude Code; wiring a literal token would create a broken
  override.

## Out of scope / non-goals

- No MCP roots, no downward subdir search (#645), no adapter `--root` wiring
  (#644), no filesystem watcher.
- No change to the compile pipeline, cache, or invalidation semantics.
- Single-root only: the first candidate that resolves wins. Writes remain
  CLI-only (ADR-023).
