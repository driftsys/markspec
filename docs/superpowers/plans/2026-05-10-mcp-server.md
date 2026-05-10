# MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement v1 of the MarkSpec MCP server — a stdio JSON-RPC server
that exposes the project's traceability data to AI coding agents as MCP
resources and tools. Covers GitHub issues #60–#62; #63 (write tool) is
deferred.

**Architecture:** The `markspec mcp` subcommand lazy-loads `mcp/server.ts`,
which constructs a single `Server` from `@modelcontextprotocol/sdk` on stdio.
A module-level `ProjectCache` runs `compile()` once on initialize (background)
and re-runs it on every `resources/read` or `tools/call` whose mtime check
detects file changes. Three resource families
(`markspec://profile`, `markspec://entries`, `markspec://entry/{displayId}`)
and four tools (`entry_search`, `entry_context`, `validate`,
`markspec_refresh`) all return Markdown bodies. Subscriptions emit
`notifications/resources/updated` on invalidation for clients that honor them
(Claude Code today; Copilot ignores).

**Tech Stack:**
`npm:@modelcontextprotocol/sdk`,
`@driftsys/markspec/core` (via `core/mod.ts`),
Deno/TypeScript.

**Spec:**
[`docs/superpowers/specs/2026-05-10-mcp-server-design.md`](../specs/2026-05-10-mcp-server-design.md)

**Worktree:**
`/Users/sebastientasson/Workspace/driftsys/markspec/.claude/worktrees/feat+mcp-server-v1`
(branch `worktree-feat+mcp-server-v1`)

---

## File Map

| File                                              | Responsibility                                          |
| ------------------------------------------------- | ------------------------------------------------------- |
| `packages/markspec/deno.json`                     | Add `@modelcontextprotocol/sdk` import                  |
| `packages/markspec/mcp/uri.ts`                    | MCP URI scheme: parse/format `markspec://...`           |
| `packages/markspec/mcp/uri_test.ts`               | Unit tests for URI helpers                              |
| `packages/markspec/mcp/project.ts`                | Project root discovery, compile cache, mtime check      |
| `packages/markspec/mcp/project_test.ts`           | Unit tests for cache invalidation                       |
| `packages/markspec/mcp/resources/profile.ts`      | Render `markspec://profile` as Markdown                 |
| `packages/markspec/mcp/resources/profile_test.ts` | Unit tests for profile renderer                         |
| `packages/markspec/mcp/resources/entry.ts`        | Render `markspec://entry/{id}` as Markdown              |
| `packages/markspec/mcp/resources/entry_test.ts`   | Unit tests for entry renderer                           |
| `packages/markspec/mcp/resources/entries.ts`      | Render `markspec://entries` index as Markdown           |
| `packages/markspec/mcp/resources/entries_test.ts` | Unit tests for entries-index renderer                   |
| `packages/markspec/mcp/resources/mod.ts`          | Resource registration: list, read, route by URI         |
| `packages/markspec/mcp/resources/mod_test.ts`     | Unit tests for resource dispatch                        |
| `packages/markspec/mcp/tools/search.ts`           | `entry_search`: ranking + Markdown render               |
| `packages/markspec/mcp/tools/search_test.ts`      | Unit tests for ranking and rendering                    |
| `packages/markspec/mcp/tools/context.ts`          | `entry_context`: chain walk + Markdown tree             |
| `packages/markspec/mcp/tools/context_test.ts`     | Unit tests for chain walk                               |
| `packages/markspec/mcp/tools/validate.ts`         | `validate`: diagnostics → Markdown report               |
| `packages/markspec/mcp/tools/validate_test.ts`    | Unit tests for diagnostics rendering                    |
| `packages/markspec/mcp/tools/refresh.ts`          | `markspec_refresh`: force-recompile                     |
| `packages/markspec/mcp/tools/refresh_test.ts`     | Unit tests for refresh tool                             |
| `packages/markspec/mcp/tools/mod.ts`              | Tool registration: list, call dispatch                  |
| `packages/markspec/mcp/server.ts`                 | Server bootstrap, lifecycle, subscriptions              |
| `packages/markspec/main.ts`                       | Replace `notImplemented("mcp")` with dynamic import     |
| `tests/e2e/mcp_test.ts`                           | E2E: spawn `markspec mcp`, drive JSON-RPC over stdio    |
| `docs/guide/commands.md`                          | Document `markspec mcp` and connection examples         |

---

## Task 1: Add MCP SDK dependency and URI helpers

**Files:**

- Modify: `packages/markspec/deno.json`
- Create: `packages/markspec/mcp/uri.ts`
- Create: `packages/markspec/mcp/uri_test.ts`

- [ ] **Step 1: Add `@modelcontextprotocol/sdk` to `packages/markspec/deno.json`**

In the `imports` map of `packages/markspec/deno.json`, add:

```json
"@modelcontextprotocol/sdk": "npm:@modelcontextprotocol/sdk@^1"
```

The full `imports` block should now contain (additive — keep all existing
entries):

```json
{
  "imports": {
    "@cliffy/command": "jsr:@cliffy/command@^1",
    "@std/assert": "jsr:@std/assert@^1",
    "@modelcontextprotocol/sdk": "npm:@modelcontextprotocol/sdk@^1",
    "unified": "npm:unified@^11",
    "remark-parse": "npm:remark-parse@^11",
    "remark-gfm": "npm:remark-gfm@^4",
    "remark-rehype": "npm:remark-rehype@^11",
    "rehype-stringify": "npm:rehype-stringify@^10",
    "mdast": "npm:@types/mdast@^4",
    "web-tree-sitter": "npm:web-tree-sitter@^0.24",
    "typst-ts-node-compiler": "npm:@myriaddreamin/typst-ts-node-compiler@^0.6",
    "vscode-languageserver/node": "npm:vscode-languageserver@^9/node.js",
    "vscode-languageserver-textdocument": "npm:vscode-languageserver-textdocument@^1"
  }
}
```

- [ ] **Step 2: Write failing tests for URI helpers**

Create `packages/markspec/mcp/uri_test.ts`:

```typescript
/**
 * @module mcp/uri_test
 *
 * Unit tests for the markspec:// URI scheme helpers.
 */

import { assertEquals } from "@std/assert";
import {
  ENTRIES_URI,
  entryUri,
  isEntryUri,
  parseEntryUri,
  PROFILE_URI,
} from "./uri.ts";

Deno.test("PROFILE_URI is the canonical constant", () => {
  assertEquals(PROFILE_URI, "markspec://profile");
});

Deno.test("ENTRIES_URI is the canonical constant", () => {
  assertEquals(ENTRIES_URI, "markspec://entries");
});

Deno.test("entryUri: builds entry URI from display ID", () => {
  assertEquals(entryUri("STK_AEB_0001"), "markspec://entry/STK_AEB_0001");
});

Deno.test("entryUri: encodes special characters in display ID", () => {
  // Display IDs are normally [A-Z0-9_] but be defensive.
  assertEquals(
    entryUri("FOO BAR"),
    "markspec://entry/FOO%20BAR",
  );
});

Deno.test("parseEntryUri: extracts display ID", () => {
  assertEquals(
    parseEntryUri("markspec://entry/STK_AEB_0001"),
    "STK_AEB_0001",
  );
});

Deno.test("parseEntryUri: decodes percent-encoded characters", () => {
  assertEquals(parseEntryUri("markspec://entry/FOO%20BAR"), "FOO BAR");
});

Deno.test("parseEntryUri: returns undefined for non-entry URIs", () => {
  assertEquals(parseEntryUri("markspec://profile"), undefined);
  assertEquals(parseEntryUri("https://example.com/STK_AEB_0001"), undefined);
  assertEquals(parseEntryUri("markspec://entry/"), undefined);
});

Deno.test("isEntryUri: true for entry URIs", () => {
  assertEquals(isEntryUri("markspec://entry/STK_AEB_0001"), true);
});

Deno.test("isEntryUri: false for other URIs", () => {
  assertEquals(isEntryUri("markspec://profile"), false);
  assertEquals(isEntryUri("markspec://entries"), false);
  assertEquals(isEntryUri("markspec://entry/"), false);
});
```

- [ ] **Step 3: Run tests to confirm they fail**

Run: `deno test packages/markspec/mcp/uri_test.ts`
Expected: FAIL — module `./uri.ts` not found.

- [ ] **Step 4: Implement `mcp/uri.ts`**

Create `packages/markspec/mcp/uri.ts`:

```typescript
/**
 * @module mcp/uri
 *
 * The `markspec://` URI scheme used by the MCP server. Three resource
 * families:
 *
 * - `markspec://profile`               — the distilled profile manifest
 * - `markspec://entries`               — the entry index
 * - `markspec://entry/{displayId}`     — a single entry
 *
 * All helpers are pure and safe to import from any module.
 */

/** Canonical URI of the profile resource. */
export const PROFILE_URI = "markspec://profile";

/** Canonical URI of the entries-index resource. */
export const ENTRIES_URI = "markspec://entries";

/** Prefix for per-entry resource URIs. */
export const ENTRY_URI_PREFIX = "markspec://entry/";

/** Build an entry resource URI from a display ID. */
export function entryUri(displayId: string): string {
  return `${ENTRY_URI_PREFIX}${encodeURIComponent(displayId)}`;
}

/**
 * Extract the display ID from a `markspec://entry/...` URI.
 * Returns `undefined` for any URI that is not a non-empty entry URI.
 */
export function parseEntryUri(uri: string): string | undefined {
  if (!uri.startsWith(ENTRY_URI_PREFIX)) return undefined;
  const encoded = uri.slice(ENTRY_URI_PREFIX.length);
  if (encoded.length === 0) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

/** Check whether a URI is a well-formed entry URI. */
export function isEntryUri(uri: string): boolean {
  return parseEntryUri(uri) !== undefined;
}
```

- [ ] **Step 5: Run tests to confirm they pass**

Run: `deno test packages/markspec/mcp/uri_test.ts`
Expected: PASS (9 tests, 0 failures).

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/deno.json packages/markspec/mcp/uri.ts packages/markspec/mcp/uri_test.ts
git commit -m "feat(mcp): add MCP SDK dependency and markspec:// URI helpers"
```

---

## Task 2: Project context and compile cache

**Files:**

- Create: `packages/markspec/mcp/project.ts`
- Create: `packages/markspec/mcp/project_test.ts`

`project.ts` owns the project root discovery, the compile cache, and the
mtime-based invalidation. It exposes:

- `initProject(cwd, env)` — discovers root, kicks off background compile.
- `getCompiled()` — returns the cached `CompileResult`, recompiling when stale.
- `forceRefresh()` — for the `markspec_refresh` tool.
- `getProfile()` — exposes the loaded `ProfileChain | null`.
- `subscribeInvalidation(handler)` — fire-on-recompile hook for the server.

- [ ] **Step 1: Write failing tests for cache invalidation**

Create `packages/markspec/mcp/project_test.ts`:

```typescript
/**
 * @module mcp/project_test
 *
 * Unit tests for the MCP project-context cache.
 *
 * Uses an in-memory ProjectEnv shim so no filesystem access is required.
 */

import { assertEquals, assertExists } from "@std/assert";
import { createProject, type ProjectEnv } from "./project.ts";

/** Build a ProjectEnv that serves a fixed file map. */
function makeEnv(files: Record<string, { content: string; mtime: number }>): {
  env: ProjectEnv;
  bumpMtime: (path: string, content: string, mtime: number) => void;
  removeFile: (path: string) => void;
} {
  const store = new Map(Object.entries(files));
  return {
    env: {
      cwd: () => "/proj",
      readFile: async (path) => {
        const f = store.get(path);
        if (!f) throw new Error(`ENOENT: ${path}`);
        return f.content;
      },
      stat: async (path) => {
        const f = store.get(path);
        if (!f) throw new Error(`ENOENT: ${path}`);
        return { mtime: f.mtime };
      },
      walk: async function* () {
        for (const path of store.keys()) yield path;
      },
    },
    bumpMtime(path, content, mtime) {
      store.set(path, { content, mtime });
    },
    removeFile(path) {
      store.delete(path);
    },
  };
}

const PROJECT_YAML = `name: test\nversion: 0.0.1\n`;

const REQ_DOC = `- [STK_TEST_0001] Test entry

  Body.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

Deno.test("createProject: discovers root from project.yaml", async () => {
  const { env } = makeEnv({
    "/proj/project.yaml": { content: PROJECT_YAML, mtime: 1 },
    "/proj/req.md": { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  assertEquals(proj.projectRoot, "/proj");
});

Deno.test("createProject: returns null when no project.yaml", async () => {
  const { env } = makeEnv({
    "/proj/req.md": { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  assertEquals(proj.projectRoot, undefined);
});

Deno.test("getCompiled: compiles and caches result", async () => {
  const { env } = makeEnv({
    "/proj/project.yaml": { content: PROJECT_YAML, mtime: 1 },
    "/proj/req.md": { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  const r1 = await proj.getCompiled();
  assertExists(r1);
  assertEquals(r1.entries.size, 1);

  // Second call must return the same object (cached).
  const r2 = await proj.getCompiled();
  assertEquals(r1, r2);
});

Deno.test("getCompiled: recompiles when file mtime changes", async () => {
  const { env, bumpMtime } = makeEnv({
    "/proj/project.yaml": { content: PROJECT_YAML, mtime: 1 },
    "/proj/req.md": { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  const r1 = await proj.getCompiled();
  assertEquals(r1.entries.size, 1);

  // Mutate the file and bump mtime above the compiledAt timestamp.
  const updatedDoc = REQ_DOC + `\n- [STK_TEST_0002] Another

  Body.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`;
  bumpMtime("/proj/req.md", updatedDoc, Date.now() + 1000);

  const r2 = await proj.getCompiled();
  assertEquals(r2.entries.size, 2);
});

Deno.test("getCompiled: recompiles when a new file appears", async () => {
  const { env, bumpMtime } = makeEnv({
    "/proj/project.yaml": { content: PROJECT_YAML, mtime: 1 },
    "/proj/req.md": { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  await proj.getCompiled();

  bumpMtime(
    "/proj/extra.md",
    `- [STK_TEST_0002] Another

  Body.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`,
    Date.now() + 1000,
  );

  const r2 = await proj.getCompiled();
  assertEquals(r2.entries.size, 2);
});

Deno.test("forceRefresh: recompiles even with no changes", async () => {
  const { env } = makeEnv({
    "/proj/project.yaml": { content: PROJECT_YAML, mtime: 1 },
    "/proj/req.md": { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  const r1 = await proj.getCompiled();
  const r2 = await proj.forceRefresh();
  // Different object — recompile happened.
  assertEquals(r1 !== r2, true);
});

Deno.test("subscribeInvalidation: fires handlers after recompile", async () => {
  const { env, bumpMtime } = makeEnv({
    "/proj/project.yaml": { content: PROJECT_YAML, mtime: 1 },
    "/proj/req.md": { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  await proj.getCompiled();

  let fired = 0;
  proj.subscribeInvalidation(() => {
    fired++;
  });

  await proj.forceRefresh();
  bumpMtime("/proj/req.md", REQ_DOC + "\n", Date.now() + 2000);
  await proj.getCompiled();

  assertEquals(fired, 2);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `deno test packages/markspec/mcp/project_test.ts`
Expected: FAIL — module `./project.ts` not found.

- [ ] **Step 3: Implement `mcp/project.ts`**

Create `packages/markspec/mcp/project.ts`:

```typescript
/**
 * @module mcp/project
 *
 * Project context for the MCP server. Discovers the project root from a
 * starting CWD, loads the active profile, caches a `CompileResult`, and
 * refreshes the cache when tracked files change (mtime check) or when a
 * caller invokes `forceRefresh()`.
 *
 * All I/O is injected via {@linkcode ProjectEnv} so this module is testable
 * without filesystem access.
 */

import {
  compile,
  type CompileResult,
  discoverProjectRoot,
  type EffectiveProfile,
  loadConfig,
  loadProfileForCommand,
  type ProfileChain,
  type ProjectConfig,
  type ReadFile,
} from "../core/mod.ts";

/** Files MarkSpec parses: Markdown plus supported source extensions. */
const TRACKED_EXTENSIONS = new Set([
  ".md",
  ".rs",
  ".kt",
  ".kts",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".cc",
  ".cxx",
  ".hpp",
  ".hxx",
]);

/** Directories never scanned for tracked files. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".worktrees",
  "target",
  "dist",
  "build",
  ".claude",
]);

/** Filesystem + environment shim, injectable for tests. */
export interface ProjectEnv {
  cwd(): string;
  readFile: ReadFile;
  stat(path: string): Promise<{ mtime: number }>;
  walk(root: string): AsyncIterable<string>;
}

/** Per-tracked-file mtime snapshot. */
interface TrackedFile {
  path: string;
  mtime: number;
}

/** Handler signature for invalidation subscribers. */
export type InvalidationHandler = (result: CompileResult) => void;

/** Result of {@linkcode createProject}. */
export interface Project {
  readonly projectRoot: string | undefined;
  readonly config: ProjectConfig | undefined;
  readonly profileChain: ProfileChain | null;
  readonly profile: EffectiveProfile | undefined;
  getCompiled(): Promise<CompileResult>;
  forceRefresh(): Promise<CompileResult>;
  subscribeInvalidation(handler: InvalidationHandler): () => void;
}

/** Default {@linkcode ProjectEnv} using Deno APIs. Used in entry points only. */
export function defaultEnv(): ProjectEnv {
  return {
    cwd: () => Deno.cwd(),
    readFile: async (path) => {
      try {
        return await Deno.readTextFile(path);
      } catch {
        return undefined;
      }
    },
    stat: async (path) => {
      const stat = await Deno.stat(path);
      return { mtime: stat.mtime?.getTime() ?? 0 };
    },
    walk: async function* (root) {
      yield* walkFs(root);
    },
  };
}

async function* walkFs(dir: string): AsyncGenerator<string> {
  try {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          yield* walkFs(path);
        }
      } else if (entry.isFile) {
        yield path;
      }
    }
  } catch {
    // Skip unreadable directories.
  }
}

/**
 * Initialize a project context from the given environment. Performs
 * project-root discovery, loads config + profile, and kicks off a
 * background compile.
 *
 * Returns a {@linkcode Project} handle whose {@linkcode Project.getCompiled}
 * method awaits the background compile on first call.
 */
export async function createProject(env: ProjectEnv): Promise<Project> {
  const cwd = env.cwd();
  const projectRoot = await discoverProjectRoot(cwd, env.readFile);

  let config: ProjectConfig | undefined;
  let profileChain: ProfileChain | null = null;

  if (projectRoot) {
    try {
      const loaded = await loadConfig(projectRoot, env.readFile);
      config = loaded?.config;
    } catch { /* config errors surface on first compile */ }

    try {
      const result = await loadProfileForCommand(projectRoot, env.readFile);
      profileChain = result.chain;
    } catch { /* profile errors surface on first compile */ }
  }

  // Cache state.
  let inFlight: Promise<CompileResult> | null = null;
  let cached: CompileResult | null = null;
  let compiledAt = 0;
  let tracked: TrackedFile[] = [];
  const handlers = new Set<InvalidationHandler>();

  /** Discover all tracked file paths under `projectRoot`. */
  async function discoverTracked(): Promise<string[]> {
    if (!projectRoot) return [];
    const out: string[] = [];
    for await (const path of env.walk(projectRoot)) {
      const dot = path.lastIndexOf(".");
      if (dot < 0) continue;
      const ext = path.slice(dot).toLowerCase();
      if (TRACKED_EXTENSIONS.has(ext)) out.push(path);
    }
    out.sort();
    return out;
  }

  /** Run compile() over current tracked set; update cache. */
  async function runCompile(): Promise<CompileResult> {
    const paths = await discoverTracked();
    const result = await compile(paths, {
      readFile: async (p) => {
        const content = await env.readFile(p);
        if (content === undefined) {
          throw new Error(`failed to read ${p}`);
        }
        return content;
      },
      profile: profileChain?.effective ?? undefined,
    });

    // Snapshot mtimes for next invalidation check.
    const snapshot: TrackedFile[] = [];
    for (const path of paths) {
      try {
        const { mtime } = await env.stat(path);
        snapshot.push({ path, mtime });
      } catch {
        // File disappeared during compile — ignore.
      }
    }
    tracked = snapshot;
    compiledAt = Date.now();
    cached = result;
    inFlight = null;
    for (const h of handlers) h(result);
    return result;
  }

  /** Detect any change in the tracked file set since the last compile. */
  async function isStale(): Promise<boolean> {
    if (!projectRoot) return false;
    // 1) Any tracked file with newer mtime, or missing?
    for (const t of tracked) {
      try {
        const { mtime } = await env.stat(t.path);
        if (mtime !== t.mtime) return true;
      } catch {
        return true; // file disappeared
      }
    }
    // 2) Any new tracked file?
    const known = new Set(tracked.map((t) => t.path));
    for await (const path of env.walk(projectRoot)) {
      const dot = path.lastIndexOf(".");
      if (dot < 0) continue;
      const ext = path.slice(dot).toLowerCase();
      if (!TRACKED_EXTENSIONS.has(ext)) continue;
      if (!known.has(path)) return true;
    }
    return false;
  }

  // Kick off background compile so first tool call doesn't pay the cost.
  if (projectRoot) {
    inFlight = runCompile().catch(() => {
      // Errors surface on the awaited call.
      return null as unknown as CompileResult;
    });
  }

  return {
    projectRoot,
    config,
    profileChain,
    profile: profileChain?.effective,
    async getCompiled(): Promise<CompileResult> {
      if (!projectRoot) {
        throw new Error(
          "MarkSpec MCP server: no project.yaml found. " +
            "Operations require project context.",
        );
      }
      if (inFlight) {
        const result = await inFlight;
        if (result) return result;
      }
      if (cached && !(await isStale())) return cached;
      inFlight = runCompile();
      return await inFlight;
    },
    async forceRefresh(): Promise<CompileResult> {
      if (!projectRoot) {
        throw new Error(
          "MarkSpec MCP server: no project.yaml found. " +
            "Operations require project context.",
        );
      }
      inFlight = runCompile();
      return await inFlight;
    },
    subscribeInvalidation(handler: InvalidationHandler): () => void {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `deno test packages/markspec/mcp/project_test.ts`
Expected: PASS (7 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/mcp/project.ts packages/markspec/mcp/project_test.ts
git commit -m "feat(mcp): add project context with compile cache and mtime invalidation"
```

---

## Task 3: Profile resource renderer

**Files:**

- Create: `packages/markspec/mcp/resources/profile.ts`
- Create: `packages/markspec/mcp/resources/profile_test.ts`

- [ ] **Step 1: Write failing tests for the profile renderer**

Create `packages/markspec/mcp/resources/profile_test.ts`:

```typescript
/**
 * @module mcp/resources/profile_test
 *
 * Unit tests for the markspec://profile Markdown renderer.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderProfile } from "./profile.ts";

Deno.test("renderProfile: 'no profile configured' when chain is null", () => {
  const md = renderProfile(null);
  assertStringIncludes(md, "# MarkSpec Profile");
  assertStringIncludes(md, "No profile configured");
});

Deno.test("renderProfile: includes active profile id and version", () => {
  const md = renderProfile({
    tiers: [
      {
        id: "@org/aspice-swe-mini",
        version: "1.0.0",
        description: "ASPICE software-engineering subset profile.",
      },
      {
        id: "@driftsys/markspec-default",
        version: "0.3.0",
        description: "Default RFC 2119 baseline profile.",
      },
    ],
    types: [
      {
        name: "stakeholder-requirement",
        shape: "identified",
        displayIdPattern: "STK_{DOMAIN}_{NNNN}",
        color: "blue",
        requiredAttributes: ["Id"],
        allowedAttributes: ["Satisfies", "Labels"],
        outgoingLinks: ["satisfies"],
        incomingLinks: ["verified-by"],
        description: "Stakeholder need or expectation.",
      },
    ],
    universalRequired: ["Id"],
    universalAllowed: ["Labels"],
    linkKinds: ["satisfies", "derived-from", "verified-by"],
    labels: ["ASIL-A", "ASIL-B"],
  });

  assertStringIncludes(md, "**Active**: @org/aspice-swe-mini@1.0.0");
  assertStringIncludes(md, "**Inherits**: @driftsys/markspec-default@0.3.0");
  assertStringIncludes(md, "ASPICE software-engineering subset profile.");
  assertStringIncludes(md, "### stakeholder-requirement");
  assertStringIncludes(md, "STK_{DOMAIN}_{NNNN}");
  assertStringIncludes(md, "ASIL-A, ASIL-B");
  assertStringIncludes(md, "| satisfies");
});

Deno.test("renderProfile: omits sections that are empty", () => {
  const md = renderProfile({
    tiers: [{ id: "@org/x", version: "1.0.0", description: "" }],
    types: [],
    universalRequired: [],
    universalAllowed: [],
    linkKinds: [],
    labels: [],
  });
  assertEquals(md.includes("## Entry types"), false);
  assertEquals(md.includes("## Labels"), false);
  assertEquals(md.includes("## Link kinds"), false);
  assertEquals(md.includes("## Universal attributes"), false);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `deno test packages/markspec/mcp/resources/profile_test.ts`
Expected: FAIL — module `./profile.ts` not found.

- [ ] **Step 3: Implement the renderer with a typed view input**

Create `packages/markspec/mcp/resources/profile.ts`:

```typescript
/**
 * @module mcp/resources/profile
 *
 * Renders the `markspec://profile` resource — a Markdown distillation of
 * the active profile chain. The renderer takes a typed view (see
 * {@linkcode ProfileView}) rather than the raw `EffectiveProfile` so it
 * stays decoupled from internal core types.
 *
 * The {@linkcode buildProfileView} helper produces a `ProfileView` from a
 * `ProfileChain | null`.
 */

import type {
  EffectiveProfile,
  EffectiveTypeDef,
  ProfileChain,
} from "../../core/mod.ts";

/** Per-type distillation. */
export interface ProfileTypeView {
  readonly name: string;
  readonly shape: string;
  readonly displayIdPattern: string | undefined;
  readonly color: string | undefined;
  readonly requiredAttributes: readonly string[];
  readonly allowedAttributes: readonly string[];
  readonly outgoingLinks: readonly string[];
  readonly incomingLinks: readonly string[];
  readonly description: string;
}

/** Per-tier descriptor. */
export interface ProfileTierView {
  readonly id: string;
  readonly version: string;
  readonly description: string;
}

/** Renderer input — typed view of the profile chain. */
export interface ProfileView {
  readonly tiers: readonly ProfileTierView[];
  readonly types: readonly ProfileTypeView[];
  readonly universalRequired: readonly string[];
  readonly universalAllowed: readonly string[];
  readonly linkKinds: readonly string[];
  readonly labels: readonly string[];
}

/** Build a {@linkcode ProfileView} from a {@linkcode ProfileChain}. */
export function buildProfileView(chain: ProfileChain | null): ProfileView | null {
  if (!chain) return null;
  const eff: EffectiveProfile = chain.effective;

  const tiers: ProfileTierView[] = chain.tiers.map((t) => ({
    id: t.id,
    version: t.version,
    description: t.manifest.description ?? "",
  }));

  const universalRequired = [...eff.required.value];
  const universalAllowed = [...eff.attributes.keys()];

  const types: ProfileTypeView[] = [];
  for (const [name, entry] of eff.types) {
    const tdef: EffectiveTypeDef = entry.value;
    const shape = tdef.shape;
    const shapeScope = shape === "identified" ? eff.identified : eff.referenced;

    const allowed = new Set<string>([
      ...tdef.attributes.keys(),
      ...shapeScope.attributes.keys(),
      ...eff.attributes.keys(),
    ]);
    const required = new Set<string>([
      ...tdef.required.value,
      ...shapeScope.required.value,
      ...eff.required.value,
    ]);
    for (const r of required) allowed.delete(r);

    const outgoing = new Set<string>(tdef.traceability.keys());
    // Incoming links: walk every other type's traceability and pick rules
    // whose target list contains this type's name as a string matcher.
    const incoming = new Set<string>();
    for (const [otherName, otherEntry] of eff.types) {
      if (otherName === name) continue;
      for (const [linkKind, rule] of otherEntry.value.traceability) {
        if (targetIncludesType(rule.value.target, name)) {
          incoming.add(linkKind);
        }
      }
    }

    types.push({
      name,
      shape,
      displayIdPattern: tdef.displayIdPattern.value,
      color: tdef.color.value,
      requiredAttributes: [...required],
      allowedAttributes: [...allowed],
      outgoingLinks: [...outgoing],
      incomingLinks: [...incoming],
      description: "",
    });
  }
  types.sort((a, b) => a.name.localeCompare(b.name));

  const linkKinds = new Set<string>();
  for (const [, entry] of eff.types) {
    for (const k of entry.value.traceability.keys()) linkKinds.add(k);
  }

  return {
    tiers,
    types,
    universalRequired,
    universalAllowed,
    linkKinds: [...linkKinds].sort(),
    labels: [...eff.labels.value],
  };
}

/** Render the profile view to Markdown. */
export function renderProfile(view: ProfileView | null): string {
  const lines: string[] = ["# MarkSpec Profile", ""];

  if (!view || view.tiers.length === 0) {
    lines.push("No profile configured for this project.");
    return lines.join("\n") + "\n";
  }

  const active = view.tiers[0];
  lines.push(`**Active**: ${active.id}@${active.version}`);
  if (view.tiers.length > 1) {
    const inherits = view.tiers
      .slice(1)
      .map((t) => `${t.id}@${t.version}`)
      .join(", ");
    lines.push(`**Inherits**: ${inherits}`);
  }
  if (active.description) {
    lines.push("");
    lines.push(active.description);
  }

  if (view.types.length > 0) {
    lines.push("", "## Entry types", "");
    for (const t of view.types) {
      lines.push(`### ${t.name}`, "");
      if (t.displayIdPattern) {
        lines.push(`- **Display-ID pattern**: \`${t.displayIdPattern}\``);
      }
      lines.push(`- **Shape**: ${t.shape}`);
      if (t.color) lines.push(`- **Color**: ${t.color}`);
      if (t.requiredAttributes.length > 0) {
        lines.push(
          `- **Required attributes**: ${t.requiredAttributes.join(", ")}`,
        );
      }
      if (t.allowedAttributes.length > 0) {
        lines.push(
          `- **Allowed attributes**: ${t.allowedAttributes.join(", ")}`,
        );
      }
      if (t.outgoingLinks.length > 0) {
        lines.push(`- **Outgoing links**: ${t.outgoingLinks.join(", ")}`);
      }
      if (t.incomingLinks.length > 0) {
        lines.push(`- **Incoming links**: ${t.incomingLinks.join(", ")}`);
      }
      if (t.description) {
        lines.push("", t.description);
      }
      lines.push("");
    }
  }

  if (view.universalRequired.length > 0 || view.universalAllowed.length > 0) {
    lines.push("## Universal attributes", "");
    if (view.universalRequired.length > 0) {
      lines.push(`- **Required**: ${view.universalRequired.join(", ")}`);
    }
    if (view.universalAllowed.length > 0) {
      lines.push(`- **Allowed**: ${view.universalAllowed.join(", ")}`);
    }
    lines.push("");
  }

  if (view.linkKinds.length > 0) {
    lines.push("## Link kinds", "");
    lines.push("| Kind | Used by |");
    lines.push("| --- | --- |");
    for (const kind of view.linkKinds) {
      const sources = view.types
        .filter((t) => t.outgoingLinks.includes(kind))
        .map((t) => t.name);
      lines.push(`| ${kind} | ${sources.join(", ") || "—"} |`);
    }
    lines.push("");
  }

  if (view.labels.length > 0) {
    lines.push("## Labels", "");
    lines.push(view.labels.join(", "));
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Whether a {@linkcode TraceRule}'s target list contains a string matcher
 * equal to the given type name. Shape-based matchers (`{ shape: ... }`)
 * are skipped — they don't pin a single named type.
 */
function targetIncludesType(
  target: readonly (string | { readonly shape: string })[],
  typeName: string,
): boolean {
  for (const matcher of target) {
    if (typeof matcher === "string" && matcher === typeName) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `deno test packages/markspec/mcp/resources/profile_test.ts`
Expected: PASS (3 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/mcp/resources/profile.ts packages/markspec/mcp/resources/profile_test.ts
git commit -m "feat(mcp): render markspec://profile as Markdown distillation"
```

---

## Task 4: Entry resource renderer

**Files:**

- Create: `packages/markspec/mcp/resources/entry.ts`
- Create: `packages/markspec/mcp/resources/entry_test.ts`

- [ ] **Step 1: Write failing tests for the entry renderer**

Create `packages/markspec/mcp/resources/entry_test.ts`:

```typescript
/**
 * @module mcp/resources/entry_test
 *
 * Unit tests for the markspec://entry/{id} Markdown renderer.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Entry, Link } from "../../core/mod.ts";
import { renderEntry } from "./entry.ts";

const ENTRY: Entry = {
  displayId: "STK_AEB_0001",
  title: "Stop on imminent collision",
  body:
    "When the system detects an imminent collision with a stationary object,\nit shall command emergency braking.",
  rawAttributes: [
    { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
    { key: "Labels", value: "ASIL-B" },
  ],
  typedAttributes: new Map(),
  id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
  type: "stakeholder-requirement",
  shape: "identified",
  location: {
    file: "/proj/docs/product/stakeholder-requirements.md",
    line: 42,
    column: 1,
  },
  source: "markdown",
};

const FORWARD: Link[] = [
  {
    from: "STK_AEB_0001",
    to: "SYS_AEB_0012",
    kind: "satisfies",
    location: {
      file: "/proj/docs/product/stakeholder-requirements.md",
      line: 47,
      column: 1,
    },
  },
];

const REVERSE: Link[] = [
  {
    from: "VAL_AEB_0001",
    to: "STK_AEB_0001",
    kind: "verified-by",
    location: { file: "/proj/tests/val_aeb.rs", line: 12, column: 1 },
  },
];

const TITLES = new Map<string, string>([
  ["SYS_AEB_0012", "Object threat assessment"],
  ["VAL_AEB_0001", "Vehicle stops before collision"],
]);

Deno.test("renderEntry: includes title and type", () => {
  const md = renderEntry(ENTRY, [], [], TITLES);
  assertStringIncludes(md, "# STK_AEB_0001 — Stop on imminent collision");
  assertStringIncludes(md, "**Type**: stakeholder-requirement");
  assertStringIncludes(md, "**Shape**: identified");
});

Deno.test("renderEntry: includes ULID and location", () => {
  const md = renderEntry(ENTRY, [], [], TITLES);
  assertStringIncludes(md, "**Id**: `01HGW2Q8MNP3RSTVWXYZABCDEF`");
  assertStringIncludes(md, "stakeholder-requirements.md:42");
});

Deno.test("renderEntry: includes body paragraph", () => {
  const md = renderEntry(ENTRY, [], [], TITLES);
  assertStringIncludes(md, "When the system detects an imminent collision");
});

Deno.test("renderEntry: includes non-Id attributes", () => {
  const md = renderEntry(ENTRY, [], [], TITLES);
  assertStringIncludes(md, "## Attributes");
  assertStringIncludes(md, "- **Labels**: ASIL-B");
});

Deno.test("renderEntry: includes outgoing links with target titles", () => {
  const md = renderEntry(ENTRY, FORWARD, [], TITLES);
  assertStringIncludes(md, "## Outgoing links");
  assertStringIncludes(
    md,
    "**satisfies** → [SYS_AEB_0012](markspec://entry/SYS_AEB_0012) — Object threat assessment",
  );
});

Deno.test("renderEntry: includes incoming links with source titles", () => {
  const md = renderEntry(ENTRY, [], REVERSE, TITLES);
  assertStringIncludes(md, "## Incoming links");
  assertStringIncludes(
    md,
    "**verified-by** ← [VAL_AEB_0001](markspec://entry/VAL_AEB_0001) — Vehicle stops before collision",
  );
});

Deno.test("renderEntry: omits Outgoing/Incoming sections when empty", () => {
  const md = renderEntry(ENTRY, [], [], TITLES);
  assertEquals(md.includes("## Outgoing links"), false);
  assertEquals(md.includes("## Incoming links"), false);
});

Deno.test("renderEntry: omits Attributes section when only Id present", () => {
  const idOnly: Entry = {
    ...ENTRY,
    rawAttributes: [{ key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" }],
  };
  const md = renderEntry(idOnly, [], [], TITLES);
  assertEquals(md.includes("## Attributes"), false);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `deno test packages/markspec/mcp/resources/entry_test.ts`
Expected: FAIL — module `./entry.ts` not found.

- [ ] **Step 3: Implement the renderer**

Create `packages/markspec/mcp/resources/entry.ts`:

```typescript
/**
 * @module mcp/resources/entry
 *
 * Renders the `markspec://entry/{displayId}` resource. Output is Markdown:
 * title, metadata (type, shape, id, location), body, attributes table,
 * outgoing links, incoming links.
 *
 * `titles` is a lookup from display ID to entry title, used to render
 * `markspec://entry/...` cross-reference labels.
 */

import type { Entry, Link } from "../../core/mod.ts";
import { entryUri } from "../uri.ts";

/** Render one entry to Markdown. */
export function renderEntry(
  entry: Entry,
  forwardLinks: readonly Link[],
  reverseLinks: readonly Link[],
  titles: ReadonlyMap<string, string>,
): string {
  const lines: string[] = [];

  lines.push(`# ${entry.displayId} — ${entry.title}`, "");

  if (entry.type) lines.push(`**Type**: ${entry.type}`);
  lines.push(`**Shape**: ${entry.shape}`);
  if (entry.id) lines.push(`**Id**: \`${entry.id}\``);
  lines.push(
    `**Location**: ${entry.location.file}:${entry.location.line}`,
  );
  lines.push("");

  if (entry.body.trim().length > 0) {
    lines.push(entry.body.trimEnd(), "");
  }

  const nonIdAttrs = entry.rawAttributes.filter(
    (a) => a.key.toLowerCase() !== "id",
  );
  if (nonIdAttrs.length > 0) {
    lines.push("## Attributes", "");
    for (const a of nonIdAttrs) {
      lines.push(`- **${a.key}**: ${a.value}`);
    }
    lines.push("");
  }

  if (forwardLinks.length > 0) {
    lines.push("## Outgoing links", "");
    for (const link of forwardLinks) {
      const title = titles.get(link.to);
      const titlePart = title ? ` — ${title}` : "";
      lines.push(
        `- **${link.kind}** → [${link.to}](${entryUri(link.to)})${titlePart}`,
      );
    }
    lines.push("");
  }

  if (reverseLinks.length > 0) {
    lines.push("## Incoming links", "");
    for (const link of reverseLinks) {
      const title = titles.get(link.from);
      const titlePart = title ? ` — ${title}` : "";
      lines.push(
        `- **${link.kind}** ← [${link.from}](${entryUri(link.from)})${titlePart}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `deno test packages/markspec/mcp/resources/entry_test.ts`
Expected: PASS (8 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/mcp/resources/entry.ts packages/markspec/mcp/resources/entry_test.ts
git commit -m "feat(mcp): render markspec://entry/{id} as Markdown"
```

---

## Task 5: Entries-index resource renderer

**Files:**

- Create: `packages/markspec/mcp/resources/entries.ts`
- Create: `packages/markspec/mcp/resources/entries_test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/markspec/mcp/resources/entries_test.ts`:

```typescript
/**
 * @module mcp/resources/entries_test
 *
 * Unit tests for the markspec://entries index renderer.
 */

import { assertStringIncludes } from "@std/assert";
import type { Entry } from "../../core/mod.ts";
import { renderEntriesIndex } from "./entries.ts";

function mkEntry(displayId: string, title: string, type?: string): Entry {
  return {
    displayId,
    title,
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    type,
    shape: "identified",
    location: { file: "/proj/x.md", line: 1, column: 1 },
    source: "markdown",
  };
}

Deno.test("renderEntriesIndex: groups by type, sorted alphabetically", () => {
  const md = renderEntriesIndex([
    mkEntry("STK_AEB_0001", "Stop on collision", "stakeholder-requirement"),
    mkEntry("SRS_AEB_0010", "Sensor debouncing", "software-requirement"),
    mkEntry("STK_AEB_0002", "Driver override", "stakeholder-requirement"),
  ]);
  assertStringIncludes(md, "# Entries (3)");
  assertStringIncludes(md, "## software-requirement (1)");
  assertStringIncludes(md, "## stakeholder-requirement (2)");
});

Deno.test("renderEntriesIndex: renders entries as Markdown links", () => {
  const md = renderEntriesIndex([
    mkEntry("STK_AEB_0001", "Stop on collision", "stakeholder-requirement"),
  ]);
  assertStringIncludes(
    md,
    "- [STK_AEB_0001](markspec://entry/STK_AEB_0001) — Stop on collision",
  );
});

Deno.test("renderEntriesIndex: groups untyped entries under 'untyped'", () => {
  const md = renderEntriesIndex([
    mkEntry("FREEFORM_0001", "Untyped entry"),
  ]);
  assertStringIncludes(md, "## untyped (1)");
});

Deno.test("renderEntriesIndex: empty corpus", () => {
  const md = renderEntriesIndex([]);
  assertStringIncludes(md, "# Entries (0)");
  assertStringIncludes(md, "No entries in this project");
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `deno test packages/markspec/mcp/resources/entries_test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the renderer**

Create `packages/markspec/mcp/resources/entries.ts`:

```typescript
/**
 * @module mcp/resources/entries
 *
 * Renders the `markspec://entries` index — an alphabetical-by-type listing
 * of every entry in the project, each as a Markdown link to its own entry
 * resource URI.
 */

import type { Entry } from "../../core/mod.ts";
import { entryUri } from "../uri.ts";

/** Render the entries index to Markdown. */
export function renderEntriesIndex(entries: readonly Entry[]): string {
  const lines: string[] = [`# Entries (${entries.length})`, ""];

  if (entries.length === 0) {
    lines.push("No entries in this project.");
    return lines.join("\n") + "\n";
  }

  // Group by type (or "untyped").
  const byType = new Map<string, Entry[]>();
  for (const entry of entries) {
    const t = entry.type ?? "untyped";
    const list = byType.get(t);
    if (list) list.push(entry);
    else byType.set(t, [entry]);
  }

  const types = [...byType.keys()].sort();
  for (const type of types) {
    const list = byType.get(type)!;
    list.sort((a, b) => a.displayId.localeCompare(b.displayId));
    lines.push(`## ${type} (${list.length})`, "");
    for (const e of list) {
      lines.push(
        `- [${e.displayId}](${entryUri(e.displayId)}) — ${e.title}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `deno test packages/markspec/mcp/resources/entries_test.ts`
Expected: PASS (4 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/mcp/resources/entries.ts packages/markspec/mcp/resources/entries_test.ts
git commit -m "feat(mcp): render markspec://entries index as Markdown"
```

---

## Task 6: Resources registration

**Files:**

- Create: `packages/markspec/mcp/resources/mod.ts`

This module wires the SDK's `resources/list` and `resources/read` handlers to
the three renderers. It also exposes a `listResourceDescriptors()` helper so
the e2e test can verify advertised resources without invoking the SDK.

- [ ] **Step 1: Implement the registration module**

Create `packages/markspec/mcp/resources/mod.ts`:

```typescript
/**
 * @module mcp/resources/mod
 *
 * Wires MCP resource handlers. Exposes:
 *
 * - {@linkcode listResourceDescriptors} — pure function returning the
 *   resources/list payload for unit-test verification.
 * - {@linkcode readResource} — pure function returning the resources/read
 *   payload for a given URI.
 * - {@linkcode registerResources} — attaches both handlers to a Server
 *   instance.
 */

import type { Server } from "npm:@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "npm:@modelcontextprotocol/sdk/types.js";
import type { Project } from "../project.ts";
import {
  ENTRIES_URI,
  entryUri,
  isEntryUri,
  parseEntryUri,
  PROFILE_URI,
} from "../uri.ts";
import { buildProfileView, renderProfile } from "./profile.ts";
import { renderEntriesIndex } from "./entries.ts";
import { renderEntry } from "./entry.ts";

/** A resource descriptor as returned by resources/list. */
export interface ResourceDescriptor {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
}

/** Build the resources/list payload from a compiled project. */
export async function listResourceDescriptors(
  project: Project,
): Promise<ResourceDescriptor[]> {
  const result = await project.getCompiled();
  const out: ResourceDescriptor[] = [
    {
      uri: PROFILE_URI,
      name: "Active profile",
      description: "Distilled profile manifest for this project",
      mimeType: "text/markdown",
    },
    {
      uri: ENTRIES_URI,
      name: "Entry index",
      description: "All entries grouped by type",
      mimeType: "text/markdown",
    },
  ];
  const ids = [...result.entries.keys()].sort();
  for (const id of ids) {
    const entry = result.entries.get(id)!;
    out.push({
      uri: entryUri(id),
      name: id,
      description: entry.title,
      mimeType: "text/markdown",
    });
  }
  return out;
}

/** Result of reading a resource. */
export interface ReadResourceResult {
  readonly uri: string;
  readonly mimeType: string;
  readonly text: string;
}

/** Read a single resource by URI. Throws on unrecognized URIs. */
export async function readResource(
  uri: string,
  project: Project,
): Promise<ReadResourceResult> {
  if (uri === PROFILE_URI) {
    const view = buildProfileView(project.profileChain);
    return {
      uri,
      mimeType: "text/markdown",
      text: renderProfile(view),
    };
  }

  if (uri === ENTRIES_URI) {
    const result = await project.getCompiled();
    return {
      uri,
      mimeType: "text/markdown",
      text: renderEntriesIndex([...result.entries.values()]),
    };
  }

  if (isEntryUri(uri)) {
    const displayId = parseEntryUri(uri)!;
    const result = await project.getCompiled();
    const entry = result.entries.get(displayId);
    if (!entry) {
      throw new Error(`entry not found: ${displayId}`);
    }
    const titles = new Map<string, string>();
    for (const [id, e] of result.entries) titles.set(id, e.title);
    return {
      uri,
      mimeType: "text/markdown",
      text: renderEntry(
        entry,
        result.forward.get(displayId) ?? [],
        result.reverse.get(displayId) ?? [],
        titles,
      ),
    };
  }

  throw new Error(`unknown resource URI: ${uri}`);
}

/** Attach resources/list and resources/read handlers to a Server. */
export function registerResources(server: Server, project: Project): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: await listResourceDescriptors(project),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    const result = await readResource(uri, project);
    return {
      contents: [
        {
          uri: result.uri,
          mimeType: result.mimeType,
          text: result.text,
        },
      ],
    };
  });
}
```

- [ ] **Step 2: Add a unit test for `listResourceDescriptors` and `readResource`**

Create `packages/markspec/mcp/resources/mod_test.ts`:

```typescript
/**
 * @module mcp/resources/mod_test
 *
 * Unit tests for the resources/list and resources/read dispatch.
 *
 * Builds a minimal Project shim and asserts the descriptor list and the
 * routing logic in readResource.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { CompileResult, Entry, ProfileChain } from "../../core/mod.ts";
import type { Project } from "../project.ts";
import { listResourceDescriptors, readResource } from "./mod.ts";

function mkProject(entries: Entry[]): Project {
  const entriesMap = new Map<string, Entry>();
  for (const e of entries) entriesMap.set(e.displayId, e);
  const result: CompileResult = {
    entries: entriesMap,
    links: [],
    forward: new Map(),
    reverse: new Map(),
    documents: new Map(),
    diagnostics: [],
  };
  const chain: ProfileChain | null = null;
  return {
    projectRoot: "/proj",
    config: undefined,
    profileChain: chain,
    profile: undefined,
    getCompiled: async () => result,
    forceRefresh: async () => result,
    subscribeInvalidation: () => () => {},
  };
}

const E1: Entry = {
  displayId: "STK_TEST_0001",
  title: "First entry",
  body: "",
  rawAttributes: [],
  typedAttributes: new Map(),
  shape: "identified",
  location: { file: "/proj/x.md", line: 1, column: 1 },
  source: "markdown",
};

Deno.test("listResourceDescriptors: includes profile + entries + per-entry", async () => {
  const project = mkProject([E1]);
  const list = await listResourceDescriptors(project);
  assertEquals(list.length, 3);
  assertEquals(list[0].uri, "markspec://profile");
  assertEquals(list[1].uri, "markspec://entries");
  assertEquals(list[2].uri, "markspec://entry/STK_TEST_0001");
});

Deno.test("readResource: routes profile URI", async () => {
  const project = mkProject([E1]);
  const r = await readResource("markspec://profile", project);
  assertStringIncludes(r.text, "# MarkSpec Profile");
});

Deno.test("readResource: routes entries URI", async () => {
  const project = mkProject([E1]);
  const r = await readResource("markspec://entries", project);
  assertStringIncludes(r.text, "# Entries (1)");
});

Deno.test("readResource: routes entry URI", async () => {
  const project = mkProject([E1]);
  const r = await readResource(
    "markspec://entry/STK_TEST_0001",
    project,
  );
  assertStringIncludes(r.text, "# STK_TEST_0001 — First entry");
});

Deno.test("readResource: rejects unknown URI", async () => {
  const project = mkProject([E1]);
  await assertRejects(
    () => readResource("markspec://unknown", project),
    Error,
    "unknown resource URI",
  );
});

Deno.test("readResource: rejects missing entry", async () => {
  const project = mkProject([E1]);
  await assertRejects(
    () => readResource("markspec://entry/NOPE_0001", project),
    Error,
    "entry not found",
  );
});
```

- [ ] **Step 3: Run tests to confirm they pass**

Run: `deno test packages/markspec/mcp/resources/`
Expected: PASS (all resource tests).

- [ ] **Step 4: Commit**

```bash
git add packages/markspec/mcp/resources/mod.ts packages/markspec/mcp/resources/mod_test.ts
git commit -m "feat(mcp): register resources/list and resources/read handlers"
```

---

## Task 7: `entry_search` tool

**Files:**

- Create: `packages/markspec/mcp/tools/search.ts`
- Create: `packages/markspec/mcp/tools/search_test.ts`

- [ ] **Step 1: Write failing tests for ranking and rendering**

Create `packages/markspec/mcp/tools/search_test.ts`:

```typescript
/**
 * @module mcp/tools/search_test
 *
 * Unit tests for the entry_search ranking algorithm and Markdown render.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Entry } from "../../core/mod.ts";
import { renderSearchResults, scoreEntries } from "./search.ts";

function mk(displayId: string, title: string): Entry {
  return {
    displayId,
    title,
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "identified",
    location: { file: "/proj/x.md", line: 1, column: 1 },
    source: "markdown",
  };
}

Deno.test("scoreEntries: prefix match on displayId scores highest", () => {
  const hits = scoreEntries(
    [mk("STK_AEB_0001", "Brake"), mk("XYZ_AEB_0001", "Braking sensor")],
    "stk_aeb",
    10,
  );
  assertEquals(hits[0].entry.displayId, "STK_AEB_0001");
});

Deno.test("scoreEntries: substring match on displayId beats title", () => {
  const hits = scoreEntries(
    [mk("FOO_BAR_0001", "Unrelated"), mk("XXX_AEB_0001", "Aeb in title")],
    "aeb",
    10,
  );
  assertEquals(hits[0].entry.displayId, "XXX_AEB_0001");
});

Deno.test("scoreEntries: token coverage in title scores", () => {
  const hits = scoreEntries(
    [
      mk("X_0001", "Apply continuous braking force"),
      mk("X_0002", "Sensor debouncing"),
    ],
    "braking",
    10,
  );
  assertEquals(hits[0].entry.displayId, "X_0001");
});

Deno.test("scoreEntries: drops zero-score entries", () => {
  const hits = scoreEntries(
    [mk("X_0001", "Sensor debouncing"), mk("X_0002", "Braking force")],
    "braking",
    10,
  );
  assertEquals(hits.length, 1);
  assertEquals(hits[0].entry.displayId, "X_0002");
});

Deno.test("scoreEntries: respects limit", () => {
  const entries = Array.from({ length: 30 }, (_, i) =>
    mk(`X_${String(i).padStart(4, "0")}`, `Braking ${i}`),
  );
  const hits = scoreEntries(entries, "braking", 5);
  assertEquals(hits.length, 5);
});

Deno.test("renderSearchResults: empty hits message", () => {
  const md = renderSearchResults([], "nope");
  assertStringIncludes(md, "No matches for");
});

Deno.test("renderSearchResults: links each hit", () => {
  const md = renderSearchResults(
    [
      { entry: mk("STK_AEB_0001", "Stop on collision"), score: 11 },
      { entry: mk("VAL_AEB_0001", "Vehicle stops"), score: 6 },
    ],
    "braking",
  );
  assertStringIncludes(
    md,
    "[STK_AEB_0001](markspec://entry/STK_AEB_0001) — Stop on collision",
  );
  assertStringIncludes(md, "score 11");
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `deno test packages/markspec/mcp/tools/search_test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the tool**

Create `packages/markspec/mcp/tools/search.ts`:

```typescript
/**
 * @module mcp/tools/search
 *
 * `entry_search` MCP tool.
 *
 * Inputs: `{ query: string, limit?: number }`.
 * Output: Markdown list of ranked matches over display IDs and titles.
 *
 * Ranking rules:
 *   +10 query is prefix of displayId
 *   +5  query is substring of displayId
 *   +3  per query-token exact-matching a title-token
 *   +1  per query-token substring-matching a title-token
 *   +2  all query-tokens appear in title (any order)
 */

import type { Entry } from "../../core/mod.ts";
import { entryUri } from "../uri.ts";

/** A ranked search result. */
export interface ScoredEntry {
  readonly entry: Entry;
  readonly score: number;
}

const TOKEN_RE = /[\s_]+/g;

/** Score a list of entries against a query; return top-N hits with score > 0. */
export function scoreEntries(
  entries: readonly Entry[],
  query: string,
  limit: number,
): ScoredEntry[] {
  const q = query.toLowerCase();
  const qTokens = q.split(TOKEN_RE).filter(Boolean);

  const hits: ScoredEntry[] = [];
  for (const entry of entries) {
    const id = entry.displayId.toLowerCase();
    const title = entry.title.toLowerCase();
    const titleTokens = title.split(TOKEN_RE).filter(Boolean);

    let score = 0;
    if (id.startsWith(q)) score += 10;
    if (id.includes(q) && !id.startsWith(q)) score += 5;

    for (const qt of qTokens) {
      if (titleTokens.includes(qt)) score += 3;
      else if (titleTokens.some((t) => t.includes(qt))) score += 1;
    }
    if (qTokens.every((qt) => title.includes(qt))) score += 2;

    if (score > 0) hits.push({ entry, score });
  }

  hits.sort((a, b) => b.score - a.score || a.entry.displayId.localeCompare(b.entry.displayId));
  return hits.slice(0, limit);
}

/** Render search hits as Markdown. */
export function renderSearchResults(
  hits: readonly ScoredEntry[],
  query: string,
): string {
  if (hits.length === 0) {
    return `# Search results\n\nNo matches for \`${query}\`.\n`;
  }
  const lines: string[] = [
    `# Search results for "${query}" (${hits.length} ${
      hits.length === 1 ? "match" : "matches"
    })`,
    "",
  ];
  for (const { entry, score } of hits) {
    lines.push(
      `- [${entry.displayId}](${entryUri(entry.displayId)}) — ${entry.title} (score ${score})`,
    );
  }
  return lines.join("\n") + "\n";
}

/** JSON Schema for the entry_search tool input. */
export const ENTRY_SEARCH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

/** Tool descriptor metadata. */
export const ENTRY_SEARCH_DESCRIPTOR = {
  name: "entry_search",
  description:
    "Search project entries by display ID and title. Returns ranked matches as Markdown links.",
  inputSchema: ENTRY_SEARCH_INPUT_SCHEMA,
};
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `deno test packages/markspec/mcp/tools/search_test.ts`
Expected: PASS (7 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/mcp/tools/search.ts packages/markspec/mcp/tools/search_test.ts
git commit -m "feat(mcp): add entry_search tool with ranking and Markdown render"
```

---

## Task 8: `entry_context` tool

**Files:**

- Create: `packages/markspec/mcp/tools/context.ts`
- Create: `packages/markspec/mcp/tools/context_test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/markspec/mcp/tools/context_test.ts`:

```typescript
/**
 * @module mcp/tools/context_test
 *
 * Unit tests for entry_context (Satisfies-chain walk).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { CompileResult, Entry, Link } from "../../core/mod.ts";
import { renderContext, walkContext } from "./context.ts";

function mk(displayId: string, title: string): Entry {
  return {
    displayId,
    title,
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "identified",
    location: { file: "/proj/x.md", line: 1, column: 1 },
    source: "markdown",
  };
}

function buildResult(
  entries: Entry[],
  edges: { from: string; to: string; kind: Link["kind"] }[],
): CompileResult {
  const entryMap = new Map<string, Entry>();
  for (const e of entries) entryMap.set(e.displayId, e);

  const links: Link[] = edges.map((e) => ({
    from: e.from,
    to: e.to,
    kind: e.kind,
    location: { file: "/x", line: 1, column: 1 },
  }));

  const forward = new Map<string, Link[]>();
  for (const link of links) {
    const list = forward.get(link.from) ?? [];
    list.push(link);
    forward.set(link.from, list);
  }

  return {
    entries: entryMap,
    links,
    forward,
    reverse: new Map(),
    documents: new Map(),
    diagnostics: [],
  };
}

Deno.test("walkContext: depth 0 is just the start entry", () => {
  const result = buildResult(
    [mk("STK_0001", "Top")],
    [],
  );
  const chain = walkContext(result, "STK_0001", 10);
  assertEquals(chain.length, 1);
  assertEquals(chain[0].displayId, "STK_0001");
  assertEquals(chain[0].depth, 0);
});

Deno.test("walkContext: walks satisfies edges upward", () => {
  const result = buildResult(
    [mk("SRS_0001", "SRS"), mk("SYS_0001", "SYS"), mk("STK_0001", "STK")],
    [
      { from: "SRS_0001", to: "SYS_0001", kind: "satisfies" },
      { from: "SYS_0001", to: "STK_0001", kind: "satisfies" },
    ],
  );
  const chain = walkContext(result, "SRS_0001", 10);
  assertEquals(chain.map((c) => c.displayId), [
    "SRS_0001",
    "SYS_0001",
    "STK_0001",
  ]);
});

Deno.test("walkContext: ignores non-satisfies edges", () => {
  const result = buildResult(
    [mk("SRS_0001", "SRS"), mk("SYS_0001", "SYS")],
    [{ from: "SRS_0001", to: "SYS_0001", kind: "derived-from" }],
  );
  const chain = walkContext(result, "SRS_0001", 10);
  assertEquals(chain.length, 1);
});

Deno.test("walkContext: stops at depth limit", () => {
  const result = buildResult(
    [mk("A_0001", "A"), mk("B_0001", "B"), mk("C_0001", "C")],
    [
      { from: "A_0001", to: "B_0001", kind: "satisfies" },
      { from: "B_0001", to: "C_0001", kind: "satisfies" },
    ],
  );
  const chain = walkContext(result, "A_0001", 1);
  assertEquals(chain.map((c) => c.displayId), ["A_0001", "B_0001"]);
});

Deno.test("walkContext: handles cycles", () => {
  const result = buildResult(
    [mk("A_0001", "A"), mk("B_0001", "B")],
    [
      { from: "A_0001", to: "B_0001", kind: "satisfies" },
      { from: "B_0001", to: "A_0001", kind: "satisfies" },
    ],
  );
  const chain = walkContext(result, "A_0001", 10);
  assertEquals(chain.length, 2);
});

Deno.test("renderContext: nested list with indentation", () => {
  const md = renderContext(
    [
      { displayId: "A_0001", title: "A", depth: 0 },
      { displayId: "B_0001", title: "B", depth: 1 },
      { displayId: "C_0001", title: "C", depth: 2 },
    ],
    "A_0001",
  );
  assertStringIncludes(md, "# Context for [A_0001]");
  assertStringIncludes(md, "- **A_0001** — A");
  assertStringIncludes(
    md,
    "  - satisfies → [B_0001](markspec://entry/B_0001) — B",
  );
  assertStringIncludes(
    md,
    "    - satisfies → [C_0001](markspec://entry/C_0001) — C",
  );
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `deno test packages/markspec/mcp/tools/context_test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the tool**

Create `packages/markspec/mcp/tools/context.ts`:

```typescript
/**
 * @module mcp/tools/context
 *
 * `entry_context` MCP tool. Walks the `satisfies` edges upward from a given
 * entry and renders the chain as a nested Markdown list.
 */

import type { CompileResult } from "../../core/mod.ts";
import { entryUri } from "../uri.ts";

/** One entry in the context chain. */
export interface ContextNode {
  readonly displayId: string;
  readonly title: string;
  /** Hops from the start entry — 0 means the start entry itself. */
  readonly depth: number;
}

/**
 * BFS walk of the `satisfies` edge upward from `startId`.
 * Stops at `maxDepth` hops or when no outgoing satisfies links remain.
 * Cycle-safe via visited set.
 */
export function walkContext(
  result: CompileResult,
  startId: string,
  maxDepth: number,
): ContextNode[] {
  const start = result.entries.get(startId);
  if (!start) return [];

  const out: ContextNode[] = [
    { displayId: startId, title: start.title, depth: 0 },
  ];
  const visited = new Set<string>([startId]);
  let frontier: string[] = [startId];
  let depth = 0;

  while (depth < maxDepth && frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      const links = result.forward.get(id) ?? [];
      for (const link of links) {
        if (link.kind !== "satisfies") continue;
        if (visited.has(link.to)) continue;
        visited.add(link.to);
        const target = result.entries.get(link.to);
        if (!target) continue;
        out.push({
          displayId: link.to,
          title: target.title,
          depth: depth + 1,
        });
        next.push(link.to);
      }
    }
    frontier = next;
    depth++;
  }

  return out;
}

/** Render a context chain as nested Markdown. */
export function renderContext(
  chain: readonly ContextNode[],
  startId: string,
): string {
  if (chain.length === 0) {
    return `# Context for ${startId}\n\nNo entry with display ID ${startId}.\n`;
  }
  const start = chain[0];
  const lines: string[] = [
    `# Context for [${start.displayId}](${entryUri(start.displayId)})`,
    "",
  ];
  for (const node of chain) {
    const indent = "  ".repeat(node.depth);
    if (node.depth === 0) {
      lines.push(`${indent}- **${node.displayId}** — ${node.title}`);
    } else {
      lines.push(
        `${indent}- satisfies → [${node.displayId}](${
          entryUri(node.displayId)
        }) — ${node.title}`,
      );
    }
  }
  return lines.join("\n") + "\n";
}

/** Tool input schema. */
export const ENTRY_CONTEXT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 },
    depth: { type: "integer", minimum: 0, maximum: 50 },
  },
  required: ["id"],
  additionalProperties: false,
} as const;

/** Tool descriptor metadata. */
export const ENTRY_CONTEXT_DESCRIPTOR = {
  name: "entry_context",
  description:
    "Walk the satisfies chain upward from an entry. Returns a Markdown nested list.",
  inputSchema: ENTRY_CONTEXT_INPUT_SCHEMA,
};
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `deno test packages/markspec/mcp/tools/context_test.ts`
Expected: PASS (6 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/mcp/tools/context.ts packages/markspec/mcp/tools/context_test.ts
git commit -m "feat(mcp): add entry_context tool with chain-walk renderer"
```

---

## Task 9: `validate` tool

**Files:**

- Create: `packages/markspec/mcp/tools/validate.ts`
- Create: `packages/markspec/mcp/tools/validate_test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/markspec/mcp/tools/validate_test.ts`:

```typescript
/**
 * @module mcp/tools/validate_test
 *
 * Unit tests for the validate tool's Markdown report.
 */

import { assertStringIncludes } from "@std/assert";
import type { Diagnostic } from "../../core/mod.ts";
import { filterDiagnostics, renderDiagnosticsReport } from "./validate.ts";

const ERR: Diagnostic = {
  code: "MSL-R004",
  severity: "error",
  message: "unresolved reference: SYS_NONEXISTENT",
  location: {
    file: "/proj/docs/req.md",
    line: 128,
    column: 3,
  },
};

const WARN: Diagnostic = {
  code: "MSL-R010",
  severity: "warning",
  message: "unrecognized attribute Priority",
  location: { file: "/proj/docs/req.md", line: 200, column: 3 },
};

Deno.test("renderDiagnosticsReport: clean report", () => {
  const md = renderDiagnosticsReport([], "@org/x@1.0.0", 100);
  assertStringIncludes(md, "✓ All 100 entries pass validation");
});

Deno.test("renderDiagnosticsReport: errors and warnings sections", () => {
  const md = renderDiagnosticsReport([ERR, WARN], null, 1);
  assertStringIncludes(md, "# Validation: 1 error, 1 warning");
  assertStringIncludes(md, "## Errors");
  assertStringIncludes(md, "### MSL-R004");
  assertStringIncludes(md, "unresolved reference: SYS_NONEXISTENT");
  assertStringIncludes(md, "/proj/docs/req.md:128:3");
  assertStringIncludes(md, "## Warnings");
  assertStringIncludes(md, "### MSL-R010");
});

Deno.test("filterDiagnostics: passes all when files undefined", () => {
  const out = filterDiagnostics([ERR, WARN], undefined, "/proj");
  assertStringIncludes(out.length.toString(), "2");
});

Deno.test("filterDiagnostics: keeps matching relative path", () => {
  const out = filterDiagnostics([ERR, WARN], ["docs/req.md"], "/proj");
  assertStringIncludes(out.length.toString(), "2");
});

Deno.test("filterDiagnostics: drops non-matching paths", () => {
  const out = filterDiagnostics([ERR, WARN], ["docs/other.md"], "/proj");
  assertStringIncludes(out.length.toString(), "0");
});

Deno.test("filterDiagnostics: absolute path match", () => {
  const out = filterDiagnostics([ERR], ["/proj/docs/req.md"], "/proj");
  assertStringIncludes(out.length.toString(), "1");
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `deno test packages/markspec/mcp/tools/validate_test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the tool**

Create `packages/markspec/mcp/tools/validate.ts`:

```typescript
/**
 * @module mcp/tools/validate
 *
 * `validate` MCP tool. Runs the validator pipeline and renders the
 * diagnostics as a Markdown report. Optional `files` argument filters
 * diagnostics to a subset of paths (relative paths resolved against the
 * project root).
 */

import type { Diagnostic } from "../../core/mod.ts";

/** Filter diagnostics by a list of file paths. */
export function filterDiagnostics(
  diagnostics: readonly Diagnostic[],
  files: readonly string[] | undefined,
  projectRoot: string,
): readonly Diagnostic[] {
  if (!files || files.length === 0) return diagnostics;
  const absolute = new Set<string>();
  for (const f of files) {
    if (f.startsWith("/")) absolute.add(f);
    else absolute.add(`${projectRoot}/${f}`);
  }
  return diagnostics.filter(
    (d) => d.location && absolute.has(d.location.file),
  );
}

/** Render diagnostics as a Markdown report. */
export function renderDiagnosticsReport(
  diagnostics: readonly Diagnostic[],
  profileLabel: string | null,
  entryCount: number,
): string {
  if (diagnostics.length === 0) {
    const profilePart = profileLabel ? ` under ${profileLabel}` : "";
    return `✓ All ${entryCount} entries pass validation${profilePart}.\n`;
  }

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const infos = diagnostics.filter((d) => d.severity === "info");

  const summaryParts: string[] = [];
  if (errors.length) {
    summaryParts.push(`${errors.length} error${errors.length === 1 ? "" : "s"}`);
  }
  if (warnings.length) {
    summaryParts.push(
      `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`,
    );
  }
  if (infos.length) {
    summaryParts.push(`${infos.length} info`);
  }

  const lines: string[] = [`# Validation: ${summaryParts.join(", ")}`, ""];

  for (const [label, list] of [
    ["Errors", errors],
    ["Warnings", warnings],
    ["Info", infos],
  ] as const) {
    if (list.length === 0) continue;
    lines.push(`## ${label}`, "");
    for (const d of list) {
      lines.push(`### ${d.code}`, "");
      const loc = d.location
        ? `${d.location.file}:${d.location.line}:${d.location.column}`
        : "(no location)";
      lines.push(loc, "");
      lines.push(d.message, "");
    }
  }

  return lines.join("\n");
}

/** Tool input schema. */
export const VALIDATE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: { type: "string" },
    },
  },
  additionalProperties: false,
} as const;

/** Tool descriptor metadata. */
export const VALIDATE_DESCRIPTOR = {
  name: "validate",
  description:
    "Run the MarkSpec validator. Optional 'files' filters diagnostics by source path.",
  inputSchema: VALIDATE_INPUT_SCHEMA,
};
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `deno test packages/markspec/mcp/tools/validate_test.ts`
Expected: PASS (6 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/mcp/tools/validate.ts packages/markspec/mcp/tools/validate_test.ts
git commit -m "feat(mcp): add validate tool with Markdown diagnostics report"
```

---

## Task 10: `markspec_refresh` tool

**Files:**

- Create: `packages/markspec/mcp/tools/refresh.ts`
- Create: `packages/markspec/mcp/tools/refresh_test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/markspec/mcp/tools/refresh_test.ts`:

```typescript
/**
 * @module mcp/tools/refresh_test
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderRefresh } from "./refresh.ts";

Deno.test("renderRefresh: returns count summary", () => {
  const md = renderRefresh(1234, 5678);
  assertStringIncludes(md, "Refreshed.");
  assertStringIncludes(md, "1234 entries");
  assertStringIncludes(md, "5678 links");
});

Deno.test("renderRefresh: zero counts", () => {
  const md = renderRefresh(0, 0);
  assertStringIncludes(md, "Refreshed.");
  assertEquals(md.includes("0 entries"), true);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `deno test packages/markspec/mcp/tools/refresh_test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the tool**

Create `packages/markspec/mcp/tools/refresh.ts`:

```typescript
/**
 * @module mcp/tools/refresh
 *
 * `markspec_refresh` MCP tool. Forces an unconditional recompile of the
 * project, returning a one-line Markdown confirmation. Used by agents that
 * have just edited files and want to guarantee freshness without relying on
 * the mtime check.
 */

/** Render a refresh confirmation. */
export function renderRefresh(entries: number, links: number): string {
  return `Refreshed. ${entries} entries, ${links} links.\n`;
}

/** Tool input schema. */
export const REFRESH_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

/** Tool descriptor metadata. */
export const REFRESH_DESCRIPTOR = {
  name: "markspec_refresh",
  description:
    "Force-invalidate the MarkSpec compile cache. Use after editing files to guarantee subsequent reads see the new state.",
  inputSchema: REFRESH_INPUT_SCHEMA,
};
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `deno test packages/markspec/mcp/tools/refresh_test.ts`
Expected: PASS (2 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/mcp/tools/refresh.ts packages/markspec/mcp/tools/refresh_test.ts
git commit -m "feat(mcp): add markspec_refresh tool"
```

---

## Task 11: Tools registration

**Files:**

- Create: `packages/markspec/mcp/tools/mod.ts`

- [ ] **Step 1: Implement the registration module**

Create `packages/markspec/mcp/tools/mod.ts`:

```typescript
/**
 * @module mcp/tools/mod
 *
 * Registers `tools/list` and `tools/call` handlers on the MCP Server.
 * Each tool lives in its own file and exposes a descriptor + pure
 * rendering helpers. This module is the dispatch layer.
 */

import type { Server } from "npm:@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "npm:@modelcontextprotocol/sdk/types.js";
import type { Project } from "../project.ts";
import {
  ENTRY_SEARCH_DESCRIPTOR,
  renderSearchResults,
  scoreEntries,
} from "./search.ts";
import {
  ENTRY_CONTEXT_DESCRIPTOR,
  renderContext,
  walkContext,
} from "./context.ts";
import {
  filterDiagnostics,
  renderDiagnosticsReport,
  VALIDATE_DESCRIPTOR,
} from "./validate.ts";
import { REFRESH_DESCRIPTOR, renderRefresh } from "./refresh.ts";

/** All tool descriptors, in `tools/list` order. */
export const TOOL_DESCRIPTORS = [
  ENTRY_SEARCH_DESCRIPTOR,
  ENTRY_CONTEXT_DESCRIPTOR,
  VALIDATE_DESCRIPTOR,
  REFRESH_DESCRIPTOR,
];

/** Tool dispatch entry. */
interface ToolHandler {
  // deno-lint-ignore no-explicit-any
  (args: any, project: Project): Promise<string>;
}

const HANDLERS: Record<string, ToolHandler> = {
  // deno-lint-ignore no-explicit-any
  entry_search: async (args: any, project) => {
    const query = String(args?.query ?? "");
    const limit = Math.min(100, Math.max(1, Number(args?.limit ?? 20)));
    const result = await project.getCompiled();
    const hits = scoreEntries(
      [...result.entries.values()],
      query,
      limit,
    );
    return renderSearchResults(hits, query);
  },

  // deno-lint-ignore no-explicit-any
  entry_context: async (args: any, project) => {
    const id = String(args?.id ?? "");
    const depth = Math.min(50, Math.max(0, Number(args?.depth ?? 10)));
    const result = await project.getCompiled();
    const chain = walkContext(result, id, depth);
    return renderContext(chain, id);
  },

  // deno-lint-ignore no-explicit-any
  validate: async (args: any, project) => {
    const files: readonly string[] | undefined = Array.isArray(args?.files)
      ? args.files.map((f: unknown) => String(f))
      : undefined;
    const result = await project.getCompiled();
    const filtered = filterDiagnostics(
      result.diagnostics,
      files,
      project.projectRoot ?? "",
    );
    const profileLabel = project.profileChain
      ? `${project.profileChain.tiers[0].id}@${project.profileChain.tiers[0].version}`
      : null;
    return renderDiagnosticsReport(filtered, profileLabel, result.entries.size);
  },

  markspec_refresh: async (_args, project) => {
    const result = await project.forceRefresh();
    return renderRefresh(result.entries.size, result.links.length);
  },
};

/** Attach the two handlers to a Server instance. */
export function registerTools(server: Server, project: Project): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DESCRIPTORS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const handler = HANDLERS[name];
    if (!handler) {
      return {
        isError: true,
        content: [{ type: "text", text: `unknown tool: ${name}` }],
      };
    }
    try {
      const text = await handler(req.params.arguments ?? {}, project);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: (err as Error).message }],
      };
    }
  });
}
```

- [ ] **Step 2: Type-check the package**

Run: `deno check packages/markspec/mcp/tools/mod.ts`
Expected: PASS with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/markspec/mcp/tools/mod.ts
git commit -m "feat(mcp): register tools/list and tools/call dispatch"
```

---

## Task 12: Server entry point

**Files:**

- Create: `packages/markspec/mcp/server.ts`

- [ ] **Step 1: Implement the server bootstrap**

Create `packages/markspec/mcp/server.ts`:

```typescript
/**
 * @module mcp/server
 *
 * MCP server entry point. Constructs a `Server` over stdio, initializes the
 * project context, registers resources + tools, and wires resource-change
 * notifications to the cache invalidation hook.
 *
 * This module is dynamically imported by `main.ts` when the user runs
 * `markspec mcp` — never loaded by other subcommands.
 */

import { Server } from "npm:@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk/server/stdio.js";
import process from "node:process";
import { VERSION } from "../core/mod.ts";
import { createProject, defaultEnv } from "./project.ts";
import { registerResources } from "./resources/mod.ts";
import { registerTools } from "./tools/mod.ts";
import { ENTRIES_URI, entryUri, PROFILE_URI } from "./uri.ts";

export async function startServer(): Promise<void> {
  const server = new Server(
    { name: "markspec", version: VERSION },
    {
      capabilities: {
        resources: { subscribe: true, listChanged: true },
        tools: { listChanged: false },
      },
    },
  );

  const project = await createProject(defaultEnv());

  registerResources(server, project);
  registerTools(server, project);

  // Fire resource change notifications when the cache invalidates.
  project.subscribeInvalidation(() => {
    void server.sendResourceListChanged();
    void server.sendResourceUpdated({ uri: PROFILE_URI });
    void server.sendResourceUpdated({ uri: ENTRIES_URI });
    // Note: we don't enumerate per-entry diffs in v1 — clients reading an
    // entry resource will hit the fresh cache anyway via getCompiled().
    // Per-entry notifications are a follow-up if profiling shows value.
    void 0;
  });

  // Also notify per-entry resources subscribed today by emitting an updated
  // notification for each entry on full recompile. Subscriptions are managed
  // by the SDK; this is a best-effort broadcast.
  project.subscribeInvalidation(async () => {
    try {
      const result = await project.getCompiled();
      for (const id of result.entries.keys()) {
        void server.sendResourceUpdated({ uri: entryUri(id) });
      }
    } catch {
      // Recompile failed — skip notifications.
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep the process alive until stdin closes.
  process.stdin.on("end", () => {
    server.close().finally(() => process.exit(0));
  });
}

if (import.meta.main) {
  await startServer();
}
```

- [ ] **Step 2: Type-check the package**

Run: `deno check packages/markspec/mcp/server.ts`
Expected: PASS with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/markspec/mcp/server.ts
git commit -m "feat(mcp): bootstrap MCP server over stdio with resource notifications"
```

---

## Task 13: Wire `markspec mcp` dispatch in `main.ts`

**Files:**

- Modify: `packages/markspec/main.ts`

- [ ] **Step 1: Locate the `mcp` subcommand block**

Find in `packages/markspec/main.ts` the block:

```typescript
  .command("mcp")
  .description("Start MCP server")
  .action(notImplemented("mcp"))
```

- [ ] **Step 2: Replace with a dynamic-import action**

Replace the action with:

```typescript
  .command("mcp")
  .description("Start MCP server (stdio JSON-RPC)")
  .action(async () => {
    const { startServer } = await import("./mcp/server.ts");
    await startServer();
  })
```

- [ ] **Step 3: Type-check**

Run: `deno check packages/markspec/main.ts`
Expected: PASS.

- [ ] **Step 4: Smoke-test the binary**

Run: `deno run --allow-read --allow-write --allow-env --allow-net=0 packages/markspec/main.ts mcp < /dev/null`
Expected: process starts, exits cleanly when stdin closes.

If the smoke test fails due to a missing permission (e.g. `--allow-ffi`), add
it and re-run. The full permission set this command needs is:
`--allow-read --allow-write --allow-env --allow-net --allow-ffi`.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/main.ts
git commit -m "feat(mcp): wire markspec mcp subcommand to mcp/server.ts"
```

---

## Task 14: End-to-end test

**Files:**

- Create: `tests/e2e/mcp_test.ts`

- [ ] **Step 1: Write the e2e test**

Create `tests/e2e/mcp_test.ts`:

```typescript
/**
 * @module tests/e2e/mcp_test
 *
 * End-to-end tests for `markspec mcp`. Spawns the CLI as a subprocess and
 * exchanges real MCP JSON-RPC messages over stdio.
 *
 * Boundary: this file imports nothing from packages/markspec/ — it interacts
 * exclusively through Deno.Command.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";

const CLI_ENTRY = new URL(
  "../../packages/markspec/main.ts",
  import.meta.url,
).pathname;

const PROJECT_YAML = `name: e2e\nversion: 0.0.1\n`;

const FIXTURE_DOC = `# Stakeholder requirements

- [STK_E2E_0001] Stop on collision

  Body.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

interface RpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
  method?: string;
  params?: unknown;
}

/** Manage a running `markspec mcp` subprocess. */
class McpProcess {
  private proc: Deno.ChildProcess;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = "";
  private pending = new Map<number, (msg: RpcResponse) => void>();
  private notifications: RpcResponse[] = [];
  private nextId = 1;

  constructor(cwd: string) {
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-net",
        "--allow-ffi",
        CLI_ENTRY,
        "mcp",
      ],
      cwd,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    this.proc = cmd.spawn();
    this.writer = this.proc.stdin.getWriter();
    this.readLoop();
  }

  private async readLoop(): Promise<void> {
    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      this.buffer += decoder.decode(value);
      for (;;) {
        const newlineIdx = this.buffer.indexOf("\n");
        if (newlineIdx < 0) break;
        const line = this.buffer.slice(0, newlineIdx).trim();
        this.buffer = this.buffer.slice(newlineIdx + 1);
        if (!line) continue;
        let msg: RpcResponse;
        try {
          msg = JSON.parse(line) as RpcResponse;
        } catch {
          continue;
        }
        if (typeof msg.id === "number" && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!(msg);
          this.pending.delete(msg.id);
        } else if (msg.method) {
          this.notifications.push(msg);
        }
      }
    }
  }

  async request(method: string, params: unknown): Promise<RpcResponse> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const promise = new Promise<RpcResponse>((resolve) => {
      this.pending.set(id, resolve);
    });
    await this.writer.write(new TextEncoder().encode(payload + "\n"));
    return await promise;
  }

  async notify(method: string, params: unknown): Promise<void> {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    await this.writer.write(new TextEncoder().encode(payload + "\n"));
  }

  drainNotifications(): RpcResponse[] {
    const out = this.notifications.slice();
    this.notifications.length = 0;
    return out;
  }

  async close(): Promise<void> {
    try {
      await this.writer.close();
    } catch { /* already closed */ }
    try {
      this.proc.kill("SIGTERM");
    } catch { /* already exited */ }
    await this.proc.status;
  }
}

/** Create a fixture project in a temp dir and start the server. */
async function setup(): Promise<
  { proc: McpProcess; cwd: string; initResponse: RpcResponse }
> {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/project.yaml`, PROJECT_YAML);
  await Deno.writeTextFile(`${dir}/req.md`, FIXTURE_DOC);
  const proc = new McpProcess(dir);
  const initResponse = await proc.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "0.0.1" },
  });
  await proc.notify("notifications/initialized", {});
  return { proc, cwd: dir, initResponse };
}

Deno.test("mcp: initialize advertises resources and tools capabilities", async () => {
  const { proc, cwd, initResponse } = await setup();
  try {
    // deno-lint-ignore no-explicit-any
    const caps = (initResponse.result as any).capabilities;
    assertEquals(typeof caps.resources, "object");
    assertEquals(typeof caps.tools, "object");
  } finally {
    await proc.close();
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("mcp: tools/list returns all four tools", async () => {
  const { proc, cwd } = await setup();
  try {
    const resp = await proc.request("tools/list", {});
    // deno-lint-ignore no-explicit-any
    const tools = (resp.result as any).tools as Array<{ name: string }>;
    const names = tools.map((t) => t.name).sort();
    assertEquals(names, [
      "entry_context",
      "entry_search",
      "markspec_refresh",
      "validate",
    ]);
  } finally {
    await proc.close();
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("mcp: resources/list returns profile, entries, and per-entry URIs", async () => {
  const { proc, cwd } = await setup();
  try {
    const resp = await proc.request("resources/list", {});
    // deno-lint-ignore no-explicit-any
    const resources = (resp.result as any).resources as Array<
      { uri: string }
    >;
    const uris = resources.map((r) => r.uri).sort();
    assertEquals(uris.includes("markspec://profile"), true);
    assertEquals(uris.includes("markspec://entries"), true);
    assertEquals(
      uris.includes("markspec://entry/STK_E2E_0001"),
      true,
    );
  } finally {
    await proc.close();
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("mcp: resources/read on entry returns Markdown body", async () => {
  const { proc, cwd } = await setup();
  try {
    const resp = await proc.request("resources/read", {
      uri: "markspec://entry/STK_E2E_0001",
    });
    // deno-lint-ignore no-explicit-any
    const contents = (resp.result as any).contents as Array<
      { text: string; mimeType: string }
    >;
    assertEquals(contents[0].mimeType, "text/markdown");
    assertStringIncludes(contents[0].text, "# STK_E2E_0001 — Stop on collision");
  } finally {
    await proc.close();
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("mcp: tools/call entry_search returns ranked matches", async () => {
  const { proc, cwd } = await setup();
  try {
    const resp = await proc.request("tools/call", {
      name: "entry_search",
      arguments: { query: "collision" },
    });
    // deno-lint-ignore no-explicit-any
    const content = (resp.result as any).content as Array<{ text: string }>;
    assertStringIncludes(content[0].text, "STK_E2E_0001");
  } finally {
    await proc.close();
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("mcp: tools/call validate returns clean report", async () => {
  const { proc, cwd } = await setup();
  try {
    const resp = await proc.request("tools/call", {
      name: "validate",
      arguments: {},
    });
    // deno-lint-ignore no-explicit-any
    const content = (resp.result as any).content as Array<{ text: string }>;
    assertStringIncludes(content[0].text, "All 1 entries pass validation");
  } finally {
    await proc.close();
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("mcp: file edit + markspec_refresh fires resources/updated", async () => {
  const { proc, cwd } = await setup();
  try {
    // Edit the fixture file: add a second entry.
    await Deno.writeTextFile(
      `${cwd}/req.md`,
      FIXTURE_DOC +
        `\n- [STK_E2E_0002] Second\n\n  Body.\n\n  Id: 01HGW2Q8MNP3RSTVWXYZABCDEG\n`,
    );

    const resp = await proc.request("tools/call", {
      name: "markspec_refresh",
      arguments: {},
    });
    // deno-lint-ignore no-explicit-any
    const content = (resp.result as any).content as Array<{ text: string }>;
    assertStringIncludes(content[0].text, "2 entries");

    const notifs = proc.drainNotifications();
    const methods = notifs.map((n) => n.method);
    assertEquals(methods.includes("notifications/resources/list_changed"), true);
  } finally {
    await proc.close();
    await Deno.remove(cwd, { recursive: true });
  }
});
```

- [ ] **Step 2: Run the e2e test**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/mcp_test.ts`

Expected: PASS (7 tests, 0 failures).

If a test hangs, inspect stderr of the subprocess (the `McpProcess` class
ignores it — for debugging, pipe `proc.stderr` to stdout temporarily).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/mcp_test.ts
git commit -m "test(e2e): drive markspec mcp over JSON-RPC stdio"
```

---

## Task 15: Document the subcommand

**Files:**

- Modify: `docs/guide/commands.md`

- [ ] **Step 1: Locate the existing `mcp` row in the commands table**

In `docs/guide/commands.md`, find the row:

```text
| `mcp`              | MCP server for AI agent integration                      |
```

- [ ] **Step 2: Promote `mcp` from not-yet-implemented to documented**

Replace that row with a link to a new subsection:

```text
| [`mcp`](#mcp)      | MCP server for AI agent integration (stdio JSON-RPC)     |
```

Then append a new `## mcp` section near the end of `docs/guide/commands.md`:

````markdown
## mcp

Starts the MarkSpec MCP server. Communicates over stdio JSON-RPC. Exposes
the active project as MCP resources and tools to any MCP-capable AI client
(Claude Code, Claude Desktop, GitHub Copilot in VS Code, OpenCode).

```bash
markspec mcp
```

### Resources

- `markspec://profile` — distilled profile manifest (types, attributes,
  link kinds, labels).
- `markspec://entries` — index of all project entries, grouped by type.
- `markspec://entry/{displayId}` — one entry per resource, with attributes,
  body, outgoing/incoming links.

### Tools

- `entry_search { query, limit? }` — rank-search entries by display ID and
  title.
- `entry_context { id, depth? }` — walk the `satisfies` chain upward.
- `validate { files? }` — run the validator, return a Markdown diagnostics
  report.
- `markspec_refresh` — force-invalidate the compile cache (call after
  agent edits to guarantee freshness).

### Claude Desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "markspec": {
      "command": "markspec",
      "args": ["mcp"],
      "cwd": "/path/to/your/markspec-project"
    }
  }
}
```

Restart Claude Desktop. The MarkSpec resources and tools appear in the
attach menu.

### Claude Code

```bash
claude mcp add markspec --command markspec --args mcp --cwd /path/to/project
```

### VS Code (Copilot)

In your project's `.vscode/mcp.json`:

```json
{
  "servers": {
    "markspec": {
      "command": "markspec",
      "args": ["mcp"]
    }
  }
}
```

Copilot does not support MCP resource subscriptions today, but the
`markspec://` resources still work — the server runs a fresh validity
check on every read, so a re-read after an edit returns up-to-date
content.
````

- [ ] **Step 3: Format and verify**

Run: `dprint fmt docs/guide/commands.md`
Run: `dprint check docs/guide/commands.md`
Expected: clean format check.

- [ ] **Step 4: Commit**

```bash
git add docs/guide/commands.md
git commit -m "docs(guide): document markspec mcp subcommand and client setup"
```

---

## Task 16: Update GitHub issues

**Files:** none

- [ ] **Step 1: Update issue #60 with the resource/tool layout**

Run:

```bash
gh issue comment 60 --body "v1 spec landed: docs/superpowers/specs/2026-05-10-mcp-server-design.md

Final layout differs from the original story:
- Server scaffold ✓
- 3 resources: markspec://profile, markspec://entries, markspec://entry/{displayId}
- 4 tools: entry_search, entry_context, validate, markspec_refresh
- Request #63 (requirement_insert) deferred until markspec insert lands"
```

- [ ] **Step 2: Close #61 and #62 as superseded**

Run:

```bash
gh issue close 61 --comment "Superseded by markspec://entry/{displayId} resource (see PR for MCP v1). Local entry lookup is now a resource read, not a tool. 'Registry' tools (RefHub) are a separate future surface."

gh issue close 62 --comment "Superseded by entry_search tool with ranking on displayId + title. See PR for MCP v1."
```

- [ ] **Step 3: Add a defer note to #63**

Run:

```bash
gh issue comment 63 --body "Deferred from MCP v1 (read-only). Blocked on markspec insert (epic:insert, #38-#41). Once insert lands, this tool wraps it and exposes the agent write path."
```

- [ ] **Step 4: Verify issue state**

Run:

```bash
gh issue list --search "label:epic:mcp" --state all
```

Expected: #60 still open with comment, #61 and #62 closed, #63 still open with
deferral comment.

---

## Final verification

- [ ] **Run full test suite**

Run: `just check`
Expected: lint passes, type-check passes, all tests pass (including new MCP
unit tests + the e2e test).

- [ ] **Run a build**

Run: `just build`
Expected: lint + tests + type-check + binary compile all succeed; `dist/markspec`
exists and runs.

- [ ] **Manual smoke from binary**

Run:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.1"}}}' | dist/markspec mcp
```

Expected: a JSON-RPC response with `result.capabilities.resources` and
`result.capabilities.tools` present.

- [ ] **Open the PR**

Run:

```bash
git push -u origin worktree-feat+mcp-server-v1
gh pr create --title "feat(mcp): v1 MCP server with profile/entry resources + 4 tools" --body "$(cat <<'EOF'
## Summary

Implements v1 of the MarkSpec MCP server per [the spec](docs/superpowers/specs/2026-05-10-mcp-server-design.md).

- 3 resources: `markspec://profile`, `markspec://entries`, `markspec://entry/{displayId}` — all Markdown.
- 4 tools: `entry_search`, `entry_context`, `validate`, `markspec_refresh`.
- stdio transport, lazy-loaded from `main.ts`.
- mtime-based cache invalidation on every read; explicit `markspec_refresh` tool as an escape hatch.
- Resource-change notifications fire on invalidation for clients that subscribe (Claude Code today; Copilot ignores).

Closes #61, #62. Addresses #60. #63 (requirement_insert) deferred until `markspec insert` lands.

## Test plan

- [ ] `just check` (lint + type-check + tests)
- [ ] `just build` (compiles to `dist/markspec`)
- [ ] Manual: Claude Code can `mcp add markspec` and list resources
- [ ] Manual: VS Code Copilot can connect and read resources
EOF
)"
```

- [ ] **After PR opens — run `/review` and post findings as a PR comment**
