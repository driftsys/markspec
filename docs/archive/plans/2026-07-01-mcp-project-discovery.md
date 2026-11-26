# MCP project discovery (env-var + cwd) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `markspec mcp` find the project via an ordered candidate list —
`--root` flag → `MARKSPEC_PROJECT_ROOT` → `CLAUDE_PROJECT_DIR` → launch `cwd` —
and emit a soft-gate message that names the directories searched. Fixes #641.

**Architecture:** All signals are known synchronously at process start, so
`createProject` resolves the root once by walking an ordered candidate list; the
first candidate whose upward walk detects a project wins. No MCP roots, no async
re-resolution — `Project` stays set-once. New root candidates flow in through
one new `ProjectEnv.rootOverrides()` seam so the whole thing is unit -testable
without touching `Deno.env`.

**Tech Stack:** Deno / TypeScript (strict), `@std/assert`, `@std/path`, Cliffy
(`markspec mcp` CLI), MCP SDK (unchanged).

## Global Constraints

- Zero warnings from `deno lint`, `deno check`, `deno test`. Remove imports your
  changes orphan.
- Node compatibility: library code must not call `Deno.*`. Only `defaultEnv`
  (the entry-point Deno shim) may read `Deno.env`; the pure helper
  `buildRootOverrides` and the `ProjectEnv` interface stay Deno-free.
- Formatting: `deno fmt` (TS) + `dprint fmt` (MD). Run `just fmt` before each
  commit; the pre-commit hook also runs it.
- The literal phrase `"No MarkSpec project found"` is load-bearing (ADR-023 —
  tool descriptions key on it). Every soft-gate string MUST start with / contain
  it. The existing `SOFT_GATE_MESSAGE` constant text stays unchanged.
- Conventional Commits, scope `mcp`. One logical change per commit.
- Per-file test command used throughout:
  `deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi <path>`

---

### Task 1: `rootOverrides` seam — pure ordering helper + `ProjectEnv` + `defaultEnv`

**Files:**

- Modify: `packages/markspec/mcp/project.ts` (add `buildRootOverrides`; add
  `rootOverrides` to `ProjectEnv`; wire `defaultEnv`)
- Test: `packages/markspec/mcp/project_test.ts` (helper tests; shim update)

**Interfaces:**

- Produces:
  `buildRootOverrides(flagRoots: readonly string[], markspecProjectRoot: string | undefined, claudeProjectDir: string | undefined): string[]`
- Produces: `ProjectEnv.rootOverrides(): string[]`
- Produces: `defaultEnv(flagRoots?: readonly string[]): ProjectEnv`

- [ ] **Step 1: Write the failing test** — append to `project_test.ts`:

```typescript
Deno.test("buildRootOverrides: orders flags, MARKSPEC_PROJECT_ROOT, CLAUDE_PROJECT_DIR", () => {
  const out = buildRootOverrides(
    ["/flag/a", "/flag/b"],
    "/env/one:/env/two",
    "/claude/dir",
  );
  assertEquals(out, [
    "/flag/a",
    "/flag/b",
    "/env/one",
    "/env/two",
    "/claude/dir",
  ]);
});

Deno.test("buildRootOverrides: drops blank/empty segments and missing env", () => {
  assertEquals(buildRootOverrides([" ", "/keep"], undefined, undefined), [
    "/keep",
  ]);
  assertEquals(buildRootOverrides([], "::/only:", ""), ["/only"]);
});
```

Add `buildRootOverrides` to the existing import block at the top of
`project_test.ts`:

```typescript
import {
  buildRootOverrides,
  checkFileStaleness,
  createProject,
  detectMarkspecProject,
  type ProjectEnv,
  SOFT_GATE_MESSAGE,
} from "./project.ts";
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/mcp/project_test.ts`
Expected: FAIL — `buildRootOverrides` is not exported.

- [ ] **Step 3: Add the helper + interface member + wire `defaultEnv`** in
      `project.ts`.

Add the pure helper (place it just above the `ProjectEnv` interface):

```typescript
/**
 * Assemble the ordered project-root override candidates that take precedence
 * over the launch `cwd`. Order encodes precedence (first wins): explicit
 * `--root` flags, then `MARKSPEC_PROJECT_ROOT` (colon-separated, POSIX
 * `PATH`-style), then Claude Code's auto-injected `CLAUDE_PROJECT_DIR`. Blank
 * segments are dropped so an unset or empty env var contributes nothing.
 */
export function buildRootOverrides(
  flagRoots: readonly string[],
  markspecProjectRoot: string | undefined,
  claudeProjectDir: string | undefined,
): string[] {
  const out: string[] = [];
  for (const r of flagRoots) {
    if (r.trim().length > 0) out.push(r);
  }
  if (markspecProjectRoot) {
    for (const seg of markspecProjectRoot.split(":")) {
      if (seg.trim().length > 0) out.push(seg);
    }
  }
  if (claudeProjectDir && claudeProjectDir.trim().length > 0) {
    out.push(claudeProjectDir);
  }
  return out;
}
```

Add the member to the `ProjectEnv` interface (after `cwd()`):

```typescript
/** Return the starting working directory used for root discovery. */
cwd(): string;
/**
 * Ordered project-root override candidates that take precedence over
 * {@linkcode ProjectEnv.cwd} during discovery. See
 * {@linkcode buildRootOverrides}.
 */
rootOverrides(): string[];
```

Replace `defaultEnv` so it accepts flag roots and reads env defensively
(`Deno.env` may be unavailable under a restricted `deno run`):

```typescript
export function defaultEnv(flagRoots: readonly string[] = []): ProjectEnv {
  const envGet = (key: string): string | undefined => {
    try {
      return Deno.env.get(key);
    } catch {
      return undefined; // --allow-env not granted; treat as unset
    }
  };
  return {
    cwd: () => Deno.cwd(),
    rootOverrides: () =>
      buildRootOverrides(
        flagRoots,
        envGet("MARKSPEC_PROJECT_ROOT"),
        envGet("CLAUDE_PROJECT_DIR"),
      ),
    readFile: async (path: string) => {
      try {
        return await Deno.readTextFile(path);
      } catch {
        return undefined;
      }
    },
    stat: async (path: string) => {
      const stat = await Deno.stat(path);
      return { mtime: stat.mtime?.getTime() ?? 0 };
    },
    walk: (root: string) => walkFs(root),
  };
}
```

Update the `makeEnv` shim in `project_test.ts` to satisfy the new interface —
add a second parameter and the `rootOverrides` member:

```typescript
function makeEnv(
  files: Record<string, { content: string; mtime: number }>,
  rootOverrides: string[] = [],
): {
  env: ProjectEnv;
  bumpMtime: (path: string, content: string, mtime: number) => void;
  removeFile: (path: string) => void;
} {
  const store = new Map(Object.entries(files));
  return {
    env: {
      cwd: () => PROJ,
      rootOverrides: () => rootOverrides,
      readFile: (path) => {
```

(The `wrappedEnv` at `project_test.ts:165` spreads `...env`, so it inherits
`rootOverrides` automatically — no change needed there.)

- [ ] **Step 4: Run tests to verify they pass**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/mcp/project_test.ts`
Expected: PASS (all existing tests + the two new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/mcp/project.ts packages/markspec/mcp/project_test.ts
git commit -m "feat(mcp): add rootOverrides seam for project discovery"
```

---

### Task 2: Ordered candidate resolution + `softGateMessage` in `createProject`

**Files:**

- Modify: `packages/markspec/mcp/project.ts` (`createProject` resolution loop;
  `buildSoftGateMessage`; `Project.softGateMessage`)
- Test: `packages/markspec/mcp/project_test.ts`

**Interfaces:**

- Consumes: `buildRootOverrides` / `ProjectEnv.rootOverrides` (Task 1)
- Produces: `Project.softGateMessage: string`

- [ ] **Step 1: Write the failing tests** — append to `project_test.ts`:

```typescript
Deno.test("createProject: an override beats a non-project cwd", async () => {
  // cwd (PROJ_EMPTY) has no project files; the override dir does.
  const OVERRIDE = resolve("/override");
  const { env } = makeEnv({
    [join(OVERRIDE, "project.yaml")]: { content: PROJECT_YAML, mtime: 1 },
    [join(OVERRIDE, "req.md")]: { content: REQ_DOC, mtime: 1 },
  }, [OVERRIDE]);
  // makeEnv's cwd is PROJ (which has no files in this store) → only the
  // override resolves.
  const proj = await createProject(env);
  assertEquals(proj.markspecDetected, true);
  assertEquals(proj.projectRoot, OVERRIDE);
});

Deno.test("createProject: precedence — first resolvable override wins", async () => {
  const FIRST = resolve("/first");
  const SECOND = resolve("/second");
  const { env } = makeEnv({
    [join(FIRST, "project.yaml")]: { content: PROJECT_YAML, mtime: 1 },
    [join(SECOND, "project.yaml")]: { content: PROJECT_YAML, mtime: 1 },
  }, [FIRST, SECOND]);
  const proj = await createProject(env);
  assertEquals(proj.projectRoot, FIRST);
});

Deno.test("createProject: no candidate resolves → gated + message names dirs", async () => {
  const OTHER = resolve("/elsewhere");
  const { env } = makeEnv({}, [OTHER]); // no project files anywhere
  const proj = await createProject(env);
  assertEquals(proj.markspecDetected, false);
  assertEquals(proj.projectRoot, undefined);
  // Message starts with the load-bearing phrase and names both candidates.
  assertStringIncludes(proj.softGateMessage, "No MarkSpec project found");
  assertStringIncludes(proj.softGateMessage, OTHER);
  assertStringIncludes(proj.softGateMessage, PROJ); // cwd is always a candidate
  assertStringIncludes(proj.softGateMessage, "--root");
});
```

`assertStringIncludes` is already imported at the top of the file (used by
existing tests). `join` / `resolve` are already imported from `@std/path`.

- [ ] **Step 2: Run tests to verify they fail**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/mcp/project_test.ts`
Expected: FAIL — `proj.softGateMessage` is `undefined`; override is not
resolved.

- [ ] **Step 3: Implement the resolution loop + message + field** in
      `project.ts`.

Add the message builder just below the `SOFT_GATE_MESSAGE` constant:

```typescript
/**
 * Compose the soft-gate message that names every directory searched. Starts
 * with the same load-bearing phrase as {@linkcode SOFT_GATE_MESSAGE} (ADR-023)
 * and points the operator at the `--root` / `MARKSPEC_PROJECT_ROOT` remedies.
 */
export function buildSoftGateMessage(searchedDirs: readonly string[]): string {
  const dirs = searchedDirs.join(", ");
  return "No MarkSpec project found in this workspace.\n" +
    `Searched from: ${dirs} (walked upward for .markspec.yaml / project.yaml).\n` +
    "Point the server at your project with `markspec mcp --root <path>` or the " +
    "MARKSPEC_PROJECT_ROOT environment variable. This server has no work to do " +
    "here — stop calling MarkSpec tools.";
}
```

Add the field to the `Project` interface (after `markspecDetected`):

```typescript
readonly markspecDetected: boolean;
/**
 * Human-readable "no project here" message naming the directories searched,
 * for tools/resources to return when {@linkcode Project.markspecDetected} is
 * `false`. Starts with the load-bearing ADR-023 phrase.
 */
readonly softGateMessage: string;
```

Replace the head of `createProject` (the three `cwd`/`markspecDetected`/
`projectRoot` lines) with the ordered loop:

```typescript
export async function createProject(env: ProjectEnv): Promise<Project> {
  // Ordered discovery candidates: explicit overrides first (Task 1), launch
  // cwd last. First candidate whose upward walk detects a project wins (D2).
  const candidates = [...env.rootOverrides(), env.cwd()];
  let markspecDetected = false;
  let projectRoot: string | undefined;
  for (const candidate of candidates) {
    if (await detectMarkspecProject(candidate, env.readFile)) {
      markspecDetected = true;
      projectRoot = await discoverProjectRoot(candidate, env.readFile);
      break;
    }
  }
  const softGateMessage = buildSoftGateMessage(candidates);

  let config: ProjectConfig | undefined;
  let profileChain: ProfileChain | null = null;
```

Add `softGateMessage` to the returned object (next to `markspecDetected`):

```typescript
return {
  projectRoot,
  markspecDetected,
  softGateMessage,
  config,
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/mcp/project_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/mcp/project.ts packages/markspec/mcp/project_test.ts
git commit -m "feat(mcp): resolve project root from ordered candidates + rich soft-gate"
```

---

### Task 3: Route dispatch sites through `project.softGateMessage`

**Files:**

- Modify: `packages/markspec/mcp/tools/mod.ts:168`
- Modify: `packages/markspec/mcp/resources/mod.ts:111`
- Test: `packages/markspec/mcp/tools/mod_test.ts`,
  `packages/markspec/mcp/resources/mod_test.ts`

**Interfaces:**

- Consumes: `Project.softGateMessage` (Task 2)

- [ ] **Step 1: Update the mocks + failing assertions.**

In `tools/mod_test.ts`, add `softGateMessage` to `mockProject`:

```typescript
function mockProject(detected: boolean): Project {
  return {
    projectRoot: detected ? "/proj" : undefined,
    markspecDetected: detected,
    softGateMessage: "No MarkSpec project found (mock)",
    config: undefined,
```

Change the exact-equality assertion at `tools/mod_test.ts:53`:

```typescript
const result = await dispatchTool("entry_search", { query: "x" }, project);
assertStringIncludes(result, "No MarkSpec project found");
```

Ensure `assertStringIncludes` is imported in `tools/mod_test.ts` and drop the
now-unused `SOFT_GATE_MESSAGE` import (line 10). The import line should read:

```typescript
import { assertEquals, assertStringIncludes } from "@std/assert";
```

In `resources/mod_test.ts`, add `softGateMessage` to `gatedProject`:

```typescript
function gatedProject(): Project {
  return {
    projectRoot: undefined,
    markspecDetected: false,
    softGateMessage: "No MarkSpec project found (mock)",
    config: undefined,
```

Change both exact-equality assertions (`resources/mod_test.ts:126` and `:132`):

```typescript
assertEquals(result.mimeType, "text/plain");
assertStringIncludes(result.text, "No MarkSpec project found");
```

```typescript
const result = await readResource("markspec://entry/STK_0001", project);
assertStringIncludes(result.text, "No MarkSpec project found");
```

Ensure `assertStringIncludes` is imported in `resources/mod_test.ts` and drop
the now-unused `SOFT_GATE_MESSAGE` import (line 19).

- [ ] **Step 2: Run tests to verify they fail**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/mcp/tools/mod_test.ts packages/markspec/mcp/resources/mod_test.ts`
Expected: FAIL — dispatch sites still return the old constant, but that still
contains the phrase, so these specific asserts may PASS. The real failure is
`deno check` / lint: `mockProject`/`gatedProject` now declare `softGateMessage`
but the production `Project` type only gains it once Task 2 is merged (it is —
Task 2 precedes this). If running Task 3 in isolation, the assert change is the
gate. Proceed to Step 3 regardless.

- [ ] **Step 3: Route the dispatch sites to the per-project message.**

`tools/mod.ts` — change line 168 inside `dispatchTool`:

```typescript
if (!project.markspecDetected) {
  if (!HANDLERS[name]) {
    throw new Error(`unknown tool: ${name}`);
  }
  return project.softGateMessage;
}
```

Remove the now-unused `SOFT_GATE_MESSAGE` from the `tools/mod.ts` import at line
15:

```typescript
import { type Project } from "../project.ts";
```

`resources/mod.ts` — change line 111 inside `readResource`:

```typescript
if (!project.markspecDetected) {
  return {
    uri,
    mimeType: "text/plain",
    text: project.softGateMessage,
  };
}
```

Remove the now-unused `SOFT_GATE_MESSAGE` from the `resources/mod.ts` import at
line 20:

```typescript
import { type Project } from "../project.ts";
```

- [ ] **Step 4: Run tests + type-check to verify they pass**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/mcp/`
Run: `deno check packages/markspec/mcp/server.ts` Expected: PASS, no type
errors, no unused-import lint warnings.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/mcp/tools/mod.ts packages/markspec/mcp/tools/mod_test.ts packages/markspec/mcp/resources/mod.ts packages/markspec/mcp/resources/mod_test.ts
git commit -m "feat(mcp): return searched-dirs soft-gate message from tools/resources"
```

---

### Task 4: CLI `--root` flag + `startServer` passthrough

**Files:**

- Modify: `packages/markspec/mcp/server.ts` (`startServer` signature)
- Modify: `packages/markspec/cli/commands/mcp_cmd.ts` (add `--root` option)
- Test: `packages/markspec/mcp/project_test.ts` (defaultEnv env-read wiring)

**Interfaces:**

- Consumes: `defaultEnv(flagRoots)` (Task 1)
- Produces: `startServer(options?: { rootFlags?: string[] }): Promise<void>`

- [ ] **Step 1: Write the failing test** — a serial test proving `defaultEnv`
      reads the two env vars in precedence order. Append to `project_test.ts`:

```typescript
Deno.test("defaultEnv: rootOverrides reads flags then env vars in order", () => {
  const prevMs = Deno.env.get("MARKSPEC_PROJECT_ROOT");
  const prevCc = Deno.env.get("CLAUDE_PROJECT_DIR");
  try {
    Deno.env.set("MARKSPEC_PROJECT_ROOT", "/env/ms");
    Deno.env.set("CLAUDE_PROJECT_DIR", "/env/cc");
    const env = defaultEnv(["/flag/x"]);
    assertEquals(env.rootOverrides(), ["/flag/x", "/env/ms", "/env/cc"]);
  } finally {
    if (prevMs === undefined) Deno.env.delete("MARKSPEC_PROJECT_ROOT");
    else Deno.env.set("MARKSPEC_PROJECT_ROOT", prevMs);
    if (prevCc === undefined) Deno.env.delete("CLAUDE_PROJECT_DIR");
    else Deno.env.set("CLAUDE_PROJECT_DIR", prevCc);
  }
});
```

Add `defaultEnv` to the `project_test.ts` import block.

- [ ] **Step 2: Run test to verify it fails**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/mcp/project_test.ts`
Expected: FAIL — `defaultEnv` is not imported yet (or, once imported, PASSES
because Task 1 already implemented it). If it passes immediately, that is
acceptable — it locks the wiring; proceed.

- [ ] **Step 3: Add the `startServer` option + CLI flag.**

`server.ts` — change the signature and the `createProject` call:

```typescript
export async function startServer(
  options: { rootFlags?: string[] } = {},
): Promise<void> {
```

```typescript
const project = await createProject(defaultEnv(options.rootFlags ?? []));
```

And the bottom-of-file self-run stays `await startServer();` (no args).

`mcp_cmd.ts` — add the repeatable option + pass it through on the base command:

```typescript
export const mcpCmd = new Command()
  .description("Start MCP server or install its configuration")
  .option(
    "--root <path:string>",
    "Project root to serve (repeatable). Overrides cwd/env discovery.",
    { collect: true },
  )
  .action(async (options: { root?: string[] }) => {
    const { startServer } = await import("../../mcp/server.ts");
    await startServer({ rootFlags: options.root ?? [] });
  })
  .command("install")
```

- [ ] **Step 4: Run tests + type-check + manual smoke.**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/mcp/project_test.ts`
Run: `deno check packages/markspec/main.ts packages/markspec/mcp/server.ts`
Expected: PASS, no type errors.

Manual smoke (proves the flag reaches discovery and the gate fires): from a
non-project temp dir, the server should start without discovering a project.
Run:
`cd "$(mktemp -d)" && echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' | deno run --allow-read --allow-write --allow-env --allow-run --allow-ffi <ABS_PATH_TO>/packages/markspec/main.ts mcp --root /tmp/does-not-exist 2>/dev/null | head -c 200`
Expected: a JSON-RPC `initialize` result line (server boots; no crash). Full
behavioural coverage is the unit tests above — this only confirms the flag
parses and the server starts.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/mcp/server.ts packages/markspec/cli/commands/mcp_cmd.ts packages/markspec/mcp/project_test.ts
git commit -m "feat(mcp): add 'markspec mcp --root' flag wired to discovery"
```

---

### Task 5: Documentation

**Files:**

- Modify: `docs/guide/commands.md` (MCP section)

**Interfaces:** none.

- [ ] **Step 1: Locate the MCP section.**

Run: `grep -n "markspec mcp" docs/guide/commands.md` Expected: the heading +
existing `mcp` / `mcp install` documentation lines.

- [ ] **Step 2: Add a "Project discovery" subsection** under the `markspec mcp`
      docs. Insert this prose (adjust the surrounding heading level to match the
      file):

```markdown
#### How the server finds your project

`markspec mcp` resolves the project root from the first of these that contains a
`project.yaml` or `.markspec.yaml` (walking upward):

1. `--root <path>` — repeat the flag to pass several candidates.
2. `MARKSPEC_PROJECT_ROOT` — colon-separated list of candidate roots.
3. `CLAUDE_PROJECT_DIR` — injected automatically by Claude Code (v2.1.139+); no
   configuration needed.
4. The server's launch working directory.

If none resolves, every MarkSpec tool replies "No MarkSpec project found …" and
names the directories it searched. Set `--root` or `MARKSPEC_PROJECT_ROOT` to
point it at your project — this is the reliable fix when the server is launched
from outside the project (for example a user-scoped MCP install, whose working
directory is the plugin cache, or a monorepo opened at a parent directory).
```

- [ ] **Step 3: Format + verify.**

Run: `just fmt` Run: `dprint check docs/guide/commands.md` Expected: no diff /
passes.

- [ ] **Step 4: Commit**

```bash
git add docs/guide/commands.md
git commit -m "docs(mcp): document markspec mcp project-root discovery"
```

---

### Task 6: Garden the spec + full build gate

**Files:**

- Move: `docs/wip/specs/2026-07-01-mcp-project-discovery-design.md` and this
  plan → `docs/archive/` (per the working-memory lifecycle rule) OR run the
  `sdd-gardening` skill to write durable records. Decide at execution time with
  the user; do NOT leave `docs/wip/` populated on a `main`-targeting branch.

- [ ] **Step 1: Run the full gate.**

Run: `just build` Expected: lint + test + type-check pass; binary compiles.

- [ ] **Step 2: Run the format gate separately (not covered by `just build`).**

Run: `deno fmt --check && dprint check` Expected: both pass.

- [ ] **Step 3: Garden `docs/wip/`** (see `sdd-working-memory-lifecycle` rule)
      so the branch merges with an empty `docs/wip/`. Confirm with the user
      whether to archive the spec+plan or garden into `docs/`.

- [ ] **Step 4: Open the PR** with `Closes #641.` on the first line of the body,
      and a "Follow-ups: #644, #645" note.

---

## Self-Review

**Spec coverage:**

- D1/D2 discovery signals + precedence → Task 2 resolution loop (candidates =
  overrides ++ cwd), Task 1 ordering helper.
- D3 drop roots → nothing added; verified no `listRoots` call exists.
- D4 override surface (`--root` + `MARKSPEC_PROJECT_ROOT` +
  `CLAUDE_PROJECT_DIR`) → Task 1 (`buildRootOverrides`, `defaultEnv`) + Task 4
  (`--root` flag).
- D5 resolve-once, set-once `Project` → Task 2 (no getters/mutation).
- D6 soft-gate message → Task 2 (`buildSoftGateMessage`) + Task 3 (dispatch).
- D7/D8 deferred → tracked in #645 / #644; no task, cited in PR.
- Testing section → Tasks 1–4 unit tests; the intentional omission of a stdio
  e2e (to avoid the known mcp-spawn e2e flake) is covered by the `defaultEnv`
  env-read test + the createProject shim tests.

**Placeholder scan:** none — every code + test step contains full source.

**Type consistency:** `buildRootOverrides`, `rootOverrides`, `softGateMessage`,
`buildSoftGateMessage`, `startServer({ rootFlags })`, `defaultEnv(flagRoots)`
are used with identical names/signatures across tasks. Mocks (`mockProject`,
`gatedProject`) and shims (`makeEnv`, `wrappedEnv`) all gain the required
members.
