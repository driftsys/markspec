# MCP Server — Design Specification

**Date**: 2026-05-10 **Scope**: `packages/markspec/mcp/` **References**:
[ADR-005](../../architecture/adr-005-cli-architecture.md), GitHub issues #60–#63,
[2026-04-23 LSP design](2026-04-23-lsp-server-design.md)

## 1. Overview

This spec defines v1 of the MarkSpec MCP server — a stdio JSON-RPC server that
exposes MarkSpec's traceability data to AI coding agents (Claude Desktop, Claude
Code, and any other MCP client).

V1 is **read-only**. It ships five tools backed by the already-implemented core
library (`core/mod.ts`), giving agents the same query power as the
`markspec show / context / dependents / validate` CLI subcommands. Write
operations (`requirement_insert`) are deferred until `markspec insert` lands as
its own epic.

| Issue | Feature                          | v1 status                              |
| ----- | -------------------------------- | -------------------------------------- |
| #60   | `mcp/` module + `markspec mcp`   | In scope — server scaffold + lifecycle |
| #61   | Lookup tool (id → entry)         | In scope — renamed `entry_lookup`      |
| #62   | Search tool (query → entries)    | In scope — renamed `entry_search`      |
| #63   | `requirement_insert` write tool  | **Deferred** — see §9                  |

### Tool naming

The original issues use `registry_lookup` / `registry_search`. v1 ships them as
`entry_lookup` / `entry_search` to match current vocabulary; "registry" now
implies external RefHub-style standard lookup, which is a separate future tool
family. Issues #61/#62 will be updated when the spec is approved.

## 2. Architecture

### 2.1 Compile target

`mcp/server.ts` is **not** a separate compile target. It is dynamically imported
by `main.ts` when the user runs `markspec mcp`, identical to how
`lsp/server.ts` is dispatched. There is one binary — `markspec` — and `markspec
validate` never loads the MCP SDK.

```bash
deno compile packages/markspec/main.ts  # → markspec (single binary)
```

This matches the lazy-loading invariant in
[CLAUDE.md / AGENTS.md](../../../AGENTS.md): each subcommand pulls in only the
modules it needs.

### 2.2 Module structure

```text
packages/markspec/mcp/
├── server.ts          ← entry: stdio transport, MCP server lifecycle, tool registration
├── project.ts         ← project context: discoverProjectRoot, compile cache, mtime check, refresh
├── tools/
│   ├── mod.ts         ← register all tools; shared input-schema helpers
│   ├── lookup.ts      ← entry_lookup
│   ├── search.ts      ← entry_search
│   ├── context.ts     ← entry_context
│   ├── dependents.ts  ← entry_dependents
│   ├── validate.ts    ← validate
│   └── refresh.ts     ← markspec_refresh
└── (e2e tests live in tests/e2e/mcp_test.ts; unit tests are colocated)
```

Each tool is one file with: a name, a JSON Schema for inputs, and a handler.
`tools/mod.ts` collects them and registers them with the server. No barrel
`mod.ts` at the top of `mcp/` — nothing outside `mcp/` imports these modules.

### 2.3 Dependency flow

```text
core/mod.ts ← project.ts
core/mod.ts ← tools/*.ts
project.ts  ← tools/*.ts
tools/mod.ts ← server.ts
project.ts   ← server.ts

npm:@modelcontextprotocol/sdk ← server.ts, tools/mod.ts
```

The MCP module imports exclusively from `core/mod.ts` — never from internal core
paths.

## 3. Server Lifecycle (#60)

### 3.1 Transport

stdio only. The server is launched as a child process by the MCP client; the
client writes JSON-RPC messages to stdin and reads responses from stdout. This
matches Claude Desktop's default and matches the LSP's transport choice. HTTP /
SSE is out of scope for v1.

### 3.2 Capabilities

The server advertises one capability:

- `tools` — list and call tools

Resources, prompts, and sampling are **not** implemented in v1. They are
plausible follow-ups (resources especially — exposing parsed entries as MCP
resources would let clients browse the project), but the read-tool set is enough
for the agent use cases we know about.

### 3.3 Initialize sequence

1. Client connects on stdio. Server constructs `Server` and
   `StdioServerTransport` from `@modelcontextprotocol/sdk`.
2. Client sends `initialize`. Server responds with capabilities and version.
3. **In parallel** (background, fire-and-forget): the server kicks off a
   `compile()` of the project rooted at `Deno.cwd()`. The in-flight promise is
   stored in module state. See §4.
4. Client typically follows up with `tools/list`. This call does not require
   the compile to be done — the tool list is static.
5. First `tools/call` awaits the in-flight compile promise. Subsequent calls
   use the cached result if no files have changed.

### 3.4 Shutdown

The server listens for stdio EOF and the standard MCP `shutdown` notification.
On either signal it stops accepting new requests and exits the process. The
in-flight compile (if any) is abandoned by process exit — `compile()` has no
cancel API, but it touches no shared state, so abandoning is safe.

## 4. Project Context and Caching

### 4.1 Discovery

On `initialize`, the server calls `discoverProjectRoot(Deno.cwd(), readFile)`
from `core/mod.ts`. If no `project.yaml` is found, the server still starts and
`tools/list` works, but every `tools/call` returns a clean error:

> `"MarkSpec MCP server: no project.yaml found from <cwd>. Tools require project context."`

This mirrors how the project-aware CLI subcommands behave.

### 4.2 Compile cache

Module-level state in `project.ts`:

```text
ProjectCache = {
  projectRoot: string,
  config: ProjectConfig,
  profile: ProfileChain | null,
  inFlight: Promise<CompileResult> | null,    // background compile
  result: CompileResult | null,               // last successful result
  compiledAt: number,                         // ms epoch
  trackedFiles: { path: string, mtime: number }[],
}
```

### 4.3 Invalidation: mtime check on every call

`getCompiled()` is the single entry point used by all tools. Algorithm:

1. If `result === null` and `inFlight !== null`: await `inFlight`, populate
   `result`, return.
2. Stat every path in `trackedFiles`. Glob the project root for new `.md` and
   supported source files (same set the CLI uses). Compute:
   - `anyMtimeNewer` — any tracked file's current mtime > `compiledAt`
   - `anyNewFile` — a discovered file is not in `trackedFiles`
   - `anyMissing` — a tracked file no longer exists
3. If any of those is true: await a fresh `compile()`, swap into `result`,
   update `compiledAt` and `trackedFiles`, return.
4. Otherwise: return `result`.

The stat sweep is single-digit milliseconds for projects with hundreds of files
— well under the cost of a recompile (100–500 ms typical). No filesystem
watcher is needed in v1; we can add one later if profiling shows the stat sweep
dominates on very large projects.

### 4.4 Explicit refresh

`markspec_refresh` is a no-arg tool that forces a recompile. It exists as an
escape hatch: an agent that has just edited several files can call refresh to
guarantee the next query sees the new state without depending on mtime
resolution.

### 4.5 Concurrency

`getCompiled()` is `async`. If two tool calls land while a recompile is
in-flight, both await the same `inFlight` promise — `compile()` is not run
twice. A simple per-process mutex (one `inFlight: Promise | null` slot) is
sufficient for stdio's single-client model.

## 5. Tools

All tool inputs use JSON Schema declared inline in the tool file. All outputs
are JSON-serializable.

Outputs are wrapped in the MCP `CallToolResult` shape: a `content` array with a
single `text` item containing pretty-printed JSON. Agents parse this back into
structured data. (The MCP SDK supports structured `content` types but JSON-as-
text is the broadly compatible idiom.)

### 5.1 `entry_lookup` (#61)

Resolve a single entry by display ID or ULID.

- **Input**: `{ id: string }`
- **Output**:
  ```json
  {
    "displayId": "STK_AEB_0001",
    "ulid": "01HGW2...",
    "title": "...",
    "type": "stakeholder-requirement",
    "shape": "identified",
    "attributes": [{ "key": "Satisfies", "value": "..." }, ...],
    "location": { "file": "...", "line": 42, "column": 1 },
    "forwardLinks": [{ "kind": "satisfies", "to": "SYS_AEB_0012" }, ...],
    "reverseLinks": [{ "kind": "verified-by", "from": "SIT_AEB_0030" }, ...]
  }
  ```
- **Error**: `entry not found: <id>`

Backed by `compile().entries.get(id)` plus `forward.get(id)` and
`reverse.get(id)`. Mirrors `markspec show <id> --format json` exactly.

### 5.2 `entry_search` (#62)

Rank-search entries by display-ID and title.

- **Input**: `{ query: string, limit?: number }` — `limit` defaults to 20,
  capped at 100.
- **Output**: array of `{ displayId, title, type, score }`, sorted by score
  descending.

#### Ranking algorithm (v1)

1. Normalize `query` and each candidate field to lowercase.
2. Tokenize on whitespace and underscores.
3. Score per entry:
   - +10 if `query` is a prefix of `displayId`
   - +5 if `query` is a substring of `displayId`
   - +3 per query-token matching a title-token (exact)
   - +1 per query-token matching a title-token (substring)
   - +2 if all query-tokens appear in title (any order)
4. Drop entries with score 0. Sort descending. Take `limit`.

This is ~30 lines of pure code. It handles the two natural query shapes
(partial ID, keyword from a known title) and is trivial to upgrade later. We
explicitly chose not to pull in `fuse.js` for v1 — cost is dependency weight
and we have no evidence the better fuzziness moves the needle.

### 5.3 `entry_context` (#60-adjacent)

Walk the `Satisfies` chain upward from an entry.

- **Input**: `{ id: string, depth?: number }` — `depth` defaults to 10.
- **Output**: array of `{ displayId, title, depth }` in BFS order, where
  `depth` is hops from the start entry (0 = the start entry itself).

Mirrors `markspec context <id> --format json`. Same cycle protection
(`visited` set).

### 5.4 `entry_dependents` (#60-adjacent)

List all entries that link to the given entry (any link kind).

- **Input**: `{ id: string }`
- **Output**: array of `{ from, kind, title }` from `compile().reverse.get(id)`.

Mirrors `markspec dependents <id> --format json`.

### 5.5 `validate`

Run the validator pipeline.

- **Input**: `{ files?: string[] }` — when omitted, validate the full project.
  Relative paths are resolved against the project root; absolute paths are
  used as-is.
- **Output**: array of `{ severity, code, message, location }`. Always full
  diagnostics (no truncation). Cross-file diagnostics are computed against the
  full corpus regardless; if `files` is provided, the result is filtered to
  diagnostics whose `location.file` matches one of the input paths after
  normalizing both sides to absolute paths.

Mirrors `markspec validate --format json`. `--strict` is **not** exposed in v1
— agents can promote warnings themselves if they need to.

### 5.6 `markspec_refresh`

Force-invalidate the compile cache.

- **Input**: `{}`
- **Output**: `{ refreshed: true, entries: <number>, links: <number> }`

Always recompiles, even if mtime check would have skipped it. Returns counts
so agents can sanity-check that the recompile happened.

## 6. SDK and Dependencies

`@modelcontextprotocol/sdk` (TypeScript MCP SDK), imported via `npm:` because
no JSR mirror exists today:

```typescript
import { Server } from "npm:@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "npm:@modelcontextprotocol/sdk/types.js";
```

This matches the existing precedent (`vscode-languageserver` is also `npm:`).
Node.js compatibility is preserved — the SDK is npm-published and runs on both
runtimes.

No additional dependencies. JSON Schema for tool inputs is hand-written
(schemas are tiny — three fields max). No Zod, no JSON-Schema-from-Zod.

## 7. Errors

Two categories:

**Setup errors** — surface as MCP errors on the offending `tools/call`:

| Code              | Trigger                                              |
| ----------------- | ---------------------------------------------------- |
| `NO_PROJECT_ROOT` | No `project.yaml` found from `Deno.cwd()`            |
| `COMPILE_FAILED`  | `compile()` returned errors of severity `error`      |

**Tool errors** — handler-level, returned as `isError: true` content:

| Code              | Trigger                                       |
| ----------------- | --------------------------------------------- |
| `ENTRY_NOT_FOUND` | `entry_lookup`/`context`/`dependents` miss    |
| `INVALID_INPUT`   | JSON-schema validation failed                 |

`COMPILE_FAILED` is a hard error — the cache is left empty and subsequent
calls retry. We do **not** silently return partial graphs; the agent should
know the project is broken.

## 8. Tests

### 8.1 Unit tests

Each `tools/<name>.ts` has a colocated `<name>_test.ts`. Tests build a minimal
fixture `CompileResult` (or use a shared builder) and assert tool output JSON
shape and content. No process spawning, no SDK mocking.

The ranking algorithm in `search.ts` gets focused tests for each scoring rule
(prefix bonus, token coverage, etc.).

`project.ts` gets unit tests for the cache invalidation logic with an
in-memory readFile / stat shim.

### 8.2 E2E test

`tests/e2e/mcp_test.ts` spawns `deno run main.ts mcp` with a fixture project
in a temp directory. It exchanges a real JSON-RPC sequence over stdio:

1. `initialize` → assert capabilities include `tools`.
2. `tools/list` → assert all six tools present, schemas non-empty.
3. `tools/call entry_lookup { id: "STK_AEB_0001" }` → assert response shape.
4. `tools/call entry_search { query: "braking" }` → assert at least one hit.
5. `tools/call validate {}` → assert empty diagnostics on the clean fixture.
6. Mutate a fixture file to introduce a broken ref. `tools/call validate {}`
   → assert the broken-ref diagnostic appears (proves auto-invalidation works).
7. `shutdown` notification → assert clean exit.

This is the integration boundary; it never imports from `mcp/` directly.

### 8.3 Snapshot tests

`tests/e2e/mcp_test.ts` snapshots the `tools/list` response so wording or
schema regressions are caught on review.

## 9. Out of Scope for v1

| Item                    | Reason                                                    |
| ----------------------- | --------------------------------------------------------- |
| `requirement_insert`    | Requires `markspec insert` (epic:insert, #38–#41); land that first, then add the wrapper tool. |
| External RefHub lookup  | A separate tool family — distinct concept from local entries. |
| HTTP / SSE transport    | stdio covers Claude Desktop / Claude Code defaults.       |
| Resources / prompts     | Agent UX is fine without; tools cover known use cases.    |
| Sampling                | Out of scope; relevant only for nested-LLM workflows.     |
| Multi-root workspace    | Single project root matches CLI semantics.                |
| Filesystem watcher      | Stat sweep is cheap enough; revisit if profiling demands. |
| Hot profile reload      | Profile chain is loaded once on initialize; refresh tool re-reads. |

## 10. Rollout

One PR with the full v1:

1. Add `mcp/server.ts`, `mcp/project.ts`, `mcp/tools/*.ts`, colocated unit
   tests.
2. Add `tests/e2e/mcp_test.ts`.
3. Wire `markspec mcp` in `main.ts` to `await import("./mcp/server.ts")`,
   removing the `notImplemented("mcp")` placeholder.
4. Add `npm:@modelcontextprotocol/sdk` to the project's dependency graph (it
   is pulled in transitively by `import` — no `deno.json` change required
   beyond what the lockfile records).
5. Update [docs/guide/commands.md](../../guide/commands.md) — promote `mcp`
   from "not implemented" to documented, with a worked example connecting
   from Claude Desktop.
6. Update GitHub issues #60–#63 with the renamed tools and the deferral of
   #63.

## 11. Open Questions

None blocking implementation. Items for follow-up after v1 ships:

- **Telemetry**: Should the server log tool invocation counts? Useful for
  understanding which tools agents actually use, but introduces a logging
  surface. Defer.
- **Caching across processes**: Each `markspec mcp` process keeps its own
  cache. Two MCP clients connecting (e.g., Claude Desktop and Claude Code
  simultaneously) compile twice. Acceptable for v1.
- **Profile changes**: Editing `.markspec.yaml` doesn't currently invalidate
  the cache (mtime check only watches parsed files). If profile-driven
  attribute validation lands, we add `.markspec.yaml` to the watched set.
