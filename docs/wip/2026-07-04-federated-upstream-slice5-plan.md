# Federated Upstream Resolution — Slice 5: LSP + MCP Surfaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the already-resolved, already-seeded locked-upstream entries
(slice 4) in the LSP and MCP the same way project entries are surfaced — minus
the write paths that do not apply to read-only citizens — so an author sees an
`— from product@v2.1.0` badge on an upstream ID, hover works, go-to-definition
is a documented no-op, and the MCP `entry_show`/`entry_context` tools render the
upstream origin correctly.

**Architecture:** Slice 5 of the federated-upstream design
(`docs/wip/2026-07-04-federated-upstream-resolution-design.md`, §4.6 read-only
semantics, §4.8 surface table). Slice 4 already did the heavy lifting: upstream
entries are seeded into the LSP index (`seedUpstreamCorpus`) and the MCP compile
cache (`runCompile`), carry `Entry.origin = { kind: "upstream", … }`, and are
covered by every existing `Entry.origin`-keyed read-only guard (diagnostics
publish, rename block, format skip). This slice is the thin surface polish on
top of that: one genuinely new rule (go-to-definition no-op for upstream), two
MCP render fixes (origin wording + upstream location annotation), and tests
proving the free behaviour.

**Tech Stack:** Deno/TypeScript strict, `@std/assert`, colocated unit tests,
Conventional Commits. No new dependencies.

## Global Constraints

- **Worktree:** all work in
  `/Users/sebastientasson/Workspace/driftsys/markspec/.worktrees/745-lsp-mcp-surfaces`
  (branch `story/745-lsp-mcp-surfaces`, off `main@97d78f2` — slices 2+4 present;
  9 `grammars/*.wasm` already copied in). Bash cwd resets between calls — `cd`
  into the worktree at the start of every Bash call; use absolute paths with
  file tools.
- Core stays Node-compatible: no `Deno.*` in `packages/markspec/core/` library
  code. `Deno.*` is fine in `lsp/`, `mcp/` entry points and tests. (This slice
  touches only `lsp/`, `mcp/`, and `docs/` — no core library files.)
- Zero warnings from `deno check` / `deno lint` / tests. `deno check` entry
  points:
  `deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts`
- Format before committing: `deno fmt` (TS); `dprint fmt` for edited `.md`.
- Conventional Commits, imperative mood. Allowed scopes (git-std commit-msg
  hook): auto, repo, ci, spec, core, cli, lsp, mcp, render, book, deck, docs,
  deps. Use `lsp`, `mcp`, `docs(docs)` here — bare `docs:` and `docs(wip)` are
  REJECTED.
- Commit messages containing backticks: write to a scratch file,
  `git commit -F <file>` (this harness mangles literal backticks in `-m`).
- **Upstream entries are read-only, permanently.** No write-path support is in
  scope; every change here is read-side surfacing.

## Plan-time scope decisions

- **Already free from slice 4 — this slice only adds tests for it:**
  - LSP completion badge: `getAllDisplayIds()` already maps
    `origin: formatEntryOrigin(entry.origin)`, and `formatEntryOrigin` already
    renders the `upstream` kind as `product@v2.1.0`; `buildIdReferenceItems`
    already appends `— from <origin>` (tested for the corpus case at
    `completions_test.ts:758`). Upstream IDs light up for free.
  - LSP hover: works via display-ID lookup (upstream entries are indexed). **Per
    the design §4.8 and the approved brainstorm, hover stays unchanged — no
    origin badge added.**
  - LSP rename / prepareRename: already `return null` on `targetEntry?.origin`;
    upstream entries carry `origin`, so they are already blocked.
  - LSP document-highlight: `findOccurrencesInFile` highlights local references
    to any token, including a project reference to an upstream ID; the upstream
    entry itself has no local buffer to cursor into. No code change.
  - Diagnostics never published for upstream files (`corpusFilePaths` guard).
- **The one genuinely new rule:** go-to-definition is a **no-op for upstream
  entries only** (their `location.file` is an upstream-repo path that does not
  exist locally). Delivered corpus (`kind:"profile"`) keeps working — its file
  is a real local `.markspec/cache/…` path — so the guard keys on
  `isUpstreamEntry`, NOT on any `origin`.
- **MCP `entry_show` origin wording** was hardcoded to the ADR-030 phrasing
  ("delivered by …"), which is wrong for an upstream entry. Branch it on
  `origin.kind`.
- **MCP location annotation (approved decision):** annotate an upstream entry's
  Location line as `(in upstream <upstreamId>)` so the reader does not mistake
  the upstream-repo-relative path for a local file.
- **MCP `entry_context` origin badge:** thread an optional `origin` onto
  `WalkNode` (populated only when present, via conditional spread, so existing
  `walk_test`/`neighborhood_test` exact-equality assertions are unaffected) and
  render it in `renderContext`. `entry_neighborhood` is out of the issue's scope
  and stays visually unchanged (it simply ignores the optional field).
- **No new e2e.** Slice 4's `tests/e2e/federated_resolve_test.ts` (scenario 5,
  `markspec show SYS_0001` → `Origin: producta@…`) already proves upstream
  entries surface through the shared compile cache end-to-end; MCP `entry_show`
  reuses the same `renderEntry`. This slice's rendering deltas are unit-tested.

---

### Task 1: LSP go-to-definition no-op for upstream entries

**Files:**

- Modify: `packages/markspec/lsp/definition.ts` (add
  `resolveDefinitionLocation`)
- Modify: `packages/markspec/lsp/definition_test.ts` (new tests)
- Modify: `packages/markspec/lsp/server.ts` (`onDefinition` uses the new helper;
  import it)

**Interfaces:**

- Consumes: `isUpstreamEntry` from `../core/mod.ts` (barrel value import —
  precedent: `rename.ts` / `highlights.ts` import `walkProseLines` from the same
  barrel); `entryToLspLocation`, `LspLocation` already in `definition.ts`.
- Produces:

  ```ts
  export function resolveDefinitionLocation(entry: Entry): LspLocation | null;
  ```

  Returns `entryToLspLocation(entry)` for project- and profile-corpus entries;
  `null` for upstream entries. `onReferences` KEEPS calling `entryToLspLocation`
  directly — a project entry that references an upstream ID is a real local
  reference and must still navigate.

- [ ] **Step 1: Write the failing tests** — append to
      `packages/markspec/lsp/definition_test.ts`:

```ts
import { entryToLspLocation, resolveDefinitionLocation } from "./definition.ts";

function makeUpstreamEntry(file: string): Entry {
  return {
    ...makeEntry(file, 12, 1),
    origin: { kind: "upstream", upstreamId: "product", version: "v2.1.0" },
  };
}

Deno.test("resolveDefinitionLocation: project entry resolves to its location", () => {
  const entry = makeEntry("/abs/req.md", 5, 1);
  const loc = resolveDefinitionLocation(entry);
  assertEquals(loc, entryToLspLocation(entry));
});

Deno.test("resolveDefinitionLocation: upstream entry is a no-op (null)", () => {
  const entry = makeUpstreamEntry("docs/product/stk.md");
  assertEquals(resolveDefinitionLocation(entry), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run:
`cd /Users/sebastientasson/Workspace/driftsys/markspec/.worktrees/745-lsp-mcp-surfaces && deno test packages/markspec/lsp/definition_test.ts --allow-read`
Expected: FAIL — `resolveDefinitionLocation` is not exported.

- [ ] **Step 3: Implement `resolveDefinitionLocation`** — in
      `packages/markspec/lsp/definition.ts`, add the import and the function:

```ts
import { isUpstreamEntry } from "../core/mod.ts";
```

```ts
/**
 * Resolve the go-to-definition target for an entry. Returns the entry's
 * LSP `Location` for project- and delivered-corpus-authored entries;
 * `null` for a locked upstream entry (federated-upstream slice 5) whose
 * `location.file` is a path inside the upstream repo that does not exist
 * in this workspace — navigating there would open a non-existent file.
 * Delivered corpus (`kind:"profile"`) keeps working: its file is a real
 * local `.markspec/cache/…` path.
 */
export function resolveDefinitionLocation(entry: Entry): LspLocation | null {
  if (isUpstreamEntry(entry)) return null;
  return entryToLspLocation(entry);
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `deno test packages/markspec/lsp/definition_test.ts --allow-read` Expected:
PASS (all definition tests).

- [ ] **Step 5: Wire `onDefinition`** — in `packages/markspec/lsp/server.ts`:

Change the import `import { entryToLspLocation } from "./definition.ts";` to
`import { entryToLspLocation, resolveDefinitionLocation } from "./definition.ts";`

In the `connection.onDefinition(...)` handler, change the final line
`return entryToLspLocation(entry);` to
`return resolveDefinitionLocation(entry);`. Leave `onReferences` untouched (it
still maps referencing entries through `entryToLspLocation`).

- [ ] **Step 6: Type-check + commit**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec/.worktrees/745-lsp-mcp-surfaces
deno check packages/markspec/lsp/server.ts
deno fmt packages/markspec/lsp/definition.ts packages/markspec/lsp/definition_test.ts packages/markspec/lsp/server.ts
deno test packages/markspec/lsp/definition_test.ts --allow-read
git add -A packages/markspec/lsp/
git commit -m "feat(lsp): go-to-definition is a no-op for upstream entries"
```

### Task 2: LSP completion badge + read-only coverage for upstream (tests only)

**Files:**

- Modify: `packages/markspec/lsp/workspace_test.ts` (new tests)

No production change — slice 4 already routes `Entry.origin` through
`getAllDisplayIds()` and the rename guard reads
`getEntryByDisplayId(...).origin` directly. These tests pin the upstream-origin
plumbing so a future refactor can't silently drop the badge or the rename block.

**Interfaces:**

- Consumes: `WorkspaceIndex`, the local `entry(displayId, opts)` helper
  (`workspace_test.ts:13`), `getAllDisplayIds()`, `getEntryByDisplayId()`.

- [ ] **Step 1: Write the failing tests** — append to
      `packages/markspec/lsp/workspace_test.ts`. The local `entry()` helper does
      not set `origin`, so build the upstream entry by spreading it:

```ts
function upstreamEntry(displayId: string): Entry {
  return {
    ...entry(displayId, { file: "docs/product/stk.md", title: "Product req" }),
    origin: { kind: "upstream", upstreamId: "product", version: "v2.1.0" },
  };
}

Deno.test("getAllDisplayIds: upstream entry carries the origin badge (completion)", () => {
  const index = new WorkspaceIndex();
  index.updateFile("docs/product/stk.md", [upstreamEntry("PRODUCT_STK_0001")]);
  const all = index.getAllDisplayIds();
  const row = all.find((e) => e.displayId === "PRODUCT_STK_0001");
  assertEquals(row?.origin, "product@v2.1.0");
});

Deno.test("getEntryByDisplayId: upstream entry exposes origin (rename read-only guard input)", () => {
  const index = new WorkspaceIndex();
  index.updateFile("docs/product/stk.md", [upstreamEntry("PRODUCT_STK_0001")]);
  // The server's onPrepareRename / onRenameRequest block on
  // `targetEntry?.origin`; proving the indexed entry carries `origin`
  // proves the guard fires for upstream entries.
  assertEquals(
    index.getEntryByDisplayId(makeDisplayId("PRODUCT_STK_0001"))?.origin?.kind,
    "upstream",
  );
});
```

- [ ] **Step 2: Run to verify they pass** (this is characterization — the
      behaviour already exists):

Run: `deno test packages/markspec/lsp/workspace_test.ts --allow-read` Expected:
PASS. If either FAILS, STOP — slice 4 wiring regressed; report, do not weaken
the test.

- [ ] **Step 3: Commit**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec/.worktrees/745-lsp-mcp-surfaces
deno fmt packages/markspec/lsp/workspace_test.ts
git add -A packages/markspec/lsp/workspace_test.ts
git commit -m "test(lsp): upstream entries carry origin badge and stay rename-blocked"
```

### Task 3: MCP `entry_show` — upstream origin wording + location annotation

**Files:**

- Modify: `packages/markspec/mcp/resources/entry.ts` (`renderEntry`)
- Modify: `packages/markspec/mcp/resources/entry_test.ts` (new tests)
- Modify: `packages/markspec/mcp/tools/show_test.ts` (new test)

**Interfaces:**

- `renderEntry(entry, forwardLinks, reverseLinks, titles, projectRoot?)` —
  unchanged signature. Two output lines change **only when
  `entry.origin.kind === "upstream"`**:
  - Origin: `**Origin**: from upstream product@v2.1.0 (read-only)` (was, and
    stays for `kind:"profile"`: `**Origin**: delivered by … (read-only)`).
  - Location: `**Location**: docs/product/stk.md:12 (in upstream product)` (the
    `(in upstream <id>)` suffix; project + corpus entries: unchanged).

- [ ] **Step 1: Write the failing tests** — append to
      `packages/markspec/mcp/resources/entry_test.ts`:

```ts
Deno.test("renderEntry: upstream entry shows 'from upstream' origin (slice 5)", () => {
  const upstream: Entry = {
    ...ENTRY,
    origin: { kind: "upstream", upstreamId: "product", version: "v2.1.0" },
    location: { file: "docs/product/stk.md", line: 12, column: 1 },
  };
  const md = renderEntry(upstream, [], [], TITLES);
  assertStringIncludes(md, "**Origin**: from upstream product@v2.1.0 (read-only)");
});

Deno.test("renderEntry: upstream entry annotates its Location as upstream (slice 5)", () => {
  const upstream: Entry = {
    ...ENTRY,
    origin: { kind: "upstream", upstreamId: "product", version: "v2.1.0" },
    location: { file: "docs/product/stk.md", line: 12, column: 1 },
  };
  // projectRoot undefined → relativeToRoot returns the (already relative)
  // upstream path unchanged; the annotation marks it as non-local.
  const md = renderEntry(upstream, [], [], TITLES);
  assertStringIncludes(md, "**Location**: docs/product/stk.md:12 (in upstream product)");
});
```

Append to `packages/markspec/mcp/tools/show_test.ts`:

```ts
Deno.test("renderShow: upstream entry surfaces the 'from upstream' origin", () => {
  const upstream = {
    ...entry("PRODUCT_STK_0001", "Product req"),
    origin: { kind: "upstream", upstreamId: "product", version: "v2.1.0" },
    location: { file: "docs/product/stk.md", line: 12, column: 1 },
  } as unknown as Entry;
  const result = compiled([upstream], []);
  const md = renderShow(result, "PRODUCT_STK_0001", undefined);
  assertStringIncludes(md, "**Origin**: from upstream product@v2.1.0 (read-only)");
});
```

- [ ] **Step 2: Run to verify failure**

Run:
`deno test packages/markspec/mcp/resources/entry_test.ts packages/markspec/mcp/tools/show_test.ts --allow-read`
Expected: FAIL — the new tests assert "from upstream …" but the code emits
"delivered by …", and the Location line has no `(in upstream …)` suffix.

- [ ] **Step 3: Implement the render branch** — in
      `packages/markspec/mcp/resources/entry.ts`, replace the current origin +
      location block (lines ~30-40) with:

```ts
if (entry.origin) {
  const verb = entry.origin.kind === "upstream"
    ? "from upstream"
    : "delivered by";
  lines.push(
    `**Origin**: ${verb} ${formatEntryOrigin(entry.origin)} (read-only)`,
  );
}
if (entry.id) lines.push(`**Id**: \`${entry.id}\``);
const location = `${
  relativeToRoot(entry.location.file, projectRoot)
}:${entry.location.line}`;
lines.push(
  entry.origin?.kind === "upstream"
    ? `**Location**: ${location} (in upstream ${entry.origin.upstreamId})`
    : `**Location**: ${location}`,
);
lines.push("");
```

(The `entry.origin.kind === "upstream"` narrowing gives TypeScript access to
`entry.origin.upstreamId`. No import change — `formatEntryOrigin` and
`relativeToRoot` are already imported.)

- [ ] **Step 4: Run to verify the tests pass**

Run:
`deno test packages/markspec/mcp/resources/entry_test.ts packages/markspec/mcp/tools/show_test.ts --allow-read`
Expected: PASS. The existing corpus test
(`renderEntry: shows Origin when the entry is corpus-delivered`) must still pass
— confirm "delivered by platform-arch@1.2.0" is untouched.

- [ ] **Step 5: Type-check + commit**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec/.worktrees/745-lsp-mcp-surfaces
deno check packages/markspec/mcp/server.ts
deno fmt packages/markspec/mcp/resources/entry.ts packages/markspec/mcp/resources/entry_test.ts packages/markspec/mcp/tools/show_test.ts
git add -A packages/markspec/mcp/
git commit -m "feat(mcp): entry_show renders upstream origin and annotates upstream location"
```

### Task 4: MCP `entry_context` — carry the origin badge into the chain

**Files:**

- Modify: `packages/markspec/mcp/tools/walk.ts` (`WalkNode` gains optional
  `origin`; populate at both push sites)
- Modify: `packages/markspec/mcp/tools/context.ts` (`renderContext` appends the
  badge)
- Modify: `packages/markspec/mcp/tools/context_test.ts` (new test)

**Interfaces:**

- `WalkNode` gains `readonly origin?: string;` (the `formatEntryOrigin` label).
  It is set via **conditional spread** — the key is absent when the node has no
  origin — so existing `walk_test` / `neighborhood_test` exact-equality
  assertions on `{ displayId, title, depth }` are unaffected.
- `renderContext(chain, startId)` — unchanged signature; each rendered node
  gains a trailing `— from <origin>` when `node.origin` is set.
- `entry_neighborhood` (`neighborhood.ts`) is deliberately left rendering
  `{ displayId, title, depth }` only — out of this issue's scope.

- [ ] **Step 1: Write the failing test** — append to
      `packages/markspec/mcp/tools/context_test.ts`, reusing that file's
      existing `entry` / `link` / `compiled` helpers. Build a chain whose
      depth-1 parent is an upstream entry:

```ts
Deno.test("renderContext: upstream parent in the chain shows its origin badge (slice 5)", () => {
  const upstreamParent = {
    ...entry("PRODUCT_SYS_0001", "Product system req"),
    origin: { kind: "upstream", upstreamId: "product", version: "v2.1.0" },
  } as unknown as Entry;
  const result = compiled(
    [entry("SWE_0001", "Local child"), upstreamParent],
    [link("SWE_0001", "PRODUCT_SYS_0001")],
  );
  const chain = walkContext(result, "SWE_0001", 10);
  const md = renderContext(chain, "SWE_0001");
  assertStringIncludes(md, "PRODUCT_SYS_0001");
  assertStringIncludes(md, "— from product@v2.1.0");
});
```

(Import `walkContext` and `renderContext` from `./context.ts` at the top of the
test file if not already imported.)

- [ ] **Step 2: Run to verify failure**

Run: `deno test packages/markspec/mcp/tools/context_test.ts --allow-read`
Expected: FAIL — `WalkNode` has no `origin`, so no badge is rendered.

- [ ] **Step 3: Thread `origin` through `walk.ts`** — in
      `packages/markspec/mcp/tools/walk.ts`:

Add `formatEntryOrigin` to the core import:

```ts
import { formatEntryOrigin, makeDisplayId } from "../../core/mod.ts";
```

Add the optional field to the interface:

```ts
/** One visited node — display ID, title, and hops from the start (0 = start). */
export interface WalkNode {
  readonly displayId: string;
  readonly title: string;
  readonly depth: number;
  /** `"<id>@<version>"` when the node was hydrated from a profile-delivered
   * corpus (ADR-030) or a locked upstream (federated-upstream slice 5).
   * Absent for project-authored nodes. */
  readonly origin?: string;
}
```

Populate at the start-node push:

```ts
if (includeStart) {
  out.push({
    displayId: startId,
    title: start.title,
    depth: 0,
    ...(start.origin ? { origin: formatEntryOrigin(start.origin) } : {}),
  });
}
```

Populate at the neighbour push:

```ts
out.push({
  displayId: neighbour,
  title: target.title,
  depth: depth + 1,
  ...(target.origin ? { origin: formatEntryOrigin(target.origin) } : {}),
});
```

- [ ] **Step 4: Render the badge in `context.ts`** — replace the
      `for (const
      node of chain)` loop body in `renderContext`
      (`packages/markspec/mcp/tools/context.ts:41-52`) with:

```ts
for (const node of chain) {
  const indent = "  ".repeat(node.depth);
  const originSuffix = node.origin ? ` — from ${node.origin}` : "";
  if (node.depth === 0) {
    lines.push(`${indent}- **${node.displayId}** — ${node.title}${originSuffix}`);
  } else {
    lines.push(
      `${indent}- satisfies → [${node.displayId}](${
        entryUri(node.displayId)
      }) — ${node.title}${originSuffix}`,
    );
  }
}
```

- [ ] **Step 5: Run the new test + the regression guards**

Run:
`deno test packages/markspec/mcp/tools/context_test.ts packages/markspec/mcp/tools/walk_test.ts packages/markspec/mcp/tools/neighborhood_test.ts --allow-read`
Expected: PASS on all three. `walk_test` / `neighborhood_test` must stay green —
the conditional spread leaves origin-less nodes byte-identical. If either
regresses, STOP and report (do not blanket-add `origin: undefined`).

- [ ] **Step 6: Type-check + commit**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec/.worktrees/745-lsp-mcp-surfaces
deno check packages/markspec/mcp/server.ts
deno fmt packages/markspec/mcp/tools/walk.ts packages/markspec/mcp/tools/context.ts packages/markspec/mcp/tools/context_test.ts
git add -A packages/markspec/mcp/tools/
git commit -m "feat(mcp): entry_context surfaces upstream origin badges in the chain"
```

### Task 5: Docs + full gate

**Files:**

- Modify: `docs/guide/editor-vscode.md` (LSP behaviour for upstream entries)
- Modify: `docs/guide/ai-agents.md` (MCP behaviour for upstream entries)

The ADR + `language.md` §3.2 rewrites are slice 6, NOT this slice — keep the doc
edits to short surface notes.

- [ ] **Step 1: Add the LSP note** — in `docs/guide/editor-vscode.md`, add a
      short subsection near the completion/navigation content:

```markdown
### Upstream entries (federated projects)

When a project locks upstream repositories (`dependencies:` / `references:` in
`project.yaml`, resolved by `markspec lock`), the imported entries appear in the
editor as read-only citizens:

- **Completion** offers their display IDs with an `— from <name>@<version>`
  badge, so you can see an ID is imported, not local.
- **Hover** renders the imported entry the same as a local one.
- **Go-to-definition is a no-op** — an upstream entry lives in another
  repository and has no file in this workspace to open.
- **Rename and formatting never touch them**, and no diagnostics are published
  against them; their validation happened in their own repository.
```

- [ ] **Step 2: Add the MCP note** — in `docs/guide/ai-agents.md`, add a short
      note where the MCP read tools are described:

```markdown
Upstream entries (imported from locked `dependencies:` / `references:`) are
visible to `entry_show`, `entry_list`, and `entry_context` through the shared
compile cache — no separate tool. `entry_show` and `entry_context` mark them
with a `from upstream <name>@<version> (read-only)` origin badge, and
`entry_show` annotates their location as `(in upstream <name>)` because the file
lives in another repository.
```

- [ ] **Step 3: Format the docs**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec/.worktrees/745-lsp-mcp-surfaces
dprint fmt docs/guide/editor-vscode.md docs/guide/ai-agents.md
```

- [ ] **Step 4: Full gate**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec/.worktrees/745-lsp-mcp-surfaces
just build          # lint + test + type-check + compile
deno fmt --check    # separate CI gate
dprint check        # separate CI gate
```

Expected: all green. If a source-parsing e2e fails with a grammar error, verify
`ls grammars/*.wasm` lists 9 files.

- [ ] **Step 5: Commit**

```bash
git add -A docs/guide/
git commit -m "docs(docs): upstream entries in the editor (LSP) and for AI agents (MCP)"
```

### Task 6: PR

- [ ] **Step 1: Garden the wip, then push + open the PR**

Before pushing a `main`-targeting PR, `docs/wip/` must not carry ungardened
work. This slice's plan is epic working memory (like slices 2/4); the epic's
gardening (ADR-031 + guide) is slice 6's deliverable, so the slice-5 plan may
remain in `docs/wip/` as accepted debt — declare it in the PR body (mirroring PR
#740's declaration) rather than gardening mid-epic.

Write the PR body to a scratch file (backtick-safe), then:

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec/.worktrees/745-lsp-mcp-surfaces
git push -u origin story/745-lsp-mcp-surfaces   # ≥300s timeout: pre-push runs full just check
gh pr create --base main \
  --title "feat(lsp): federated upstream slice 5 — LSP + MCP surfaces" \
  --body-file <scratch>/pr-body.md
```

PR body: slice 5 of the design (§4.6/§4.8); `Closes #745`; enumerate the change
— go-to-definition no-op (`resolveDefinitionLocation`), MCP `entry_show` origin
wording + upstream location annotation, `entry_context` origin badge
(`WalkNode.origin`); the free-from-slice-4 behaviours proven by tests
(completion badge, rename block, hover); the explicit non-features (no hover
badge, no `entry_neighborhood` change, no new MCP tool/resource kind, no write
paths); note the deliberately-retained `docs/wip/…-slice5-plan.md` as accepted
debt (gardening → slice 6). Link the epic #741.

- [ ] **Step 2: Review** — run `/review` on the PR and post findings as a PR
      comment. Watch CI to green (esp. the Windows job — federated cache path
      handling bit slices 2 and 4); fix any failure. Per slice 4's lesson, run
      the real `/review` skill (not only a whole-branch skim) before claiming
      the PR is reviewed.

## Self-review notes (plan vs design + issue)

- **Issue Scope → Tasks:**
  - LSP completion origin badge → Task 2 (already free; test).
  - LSP hover works for upstream → free (indexed); no task, no badge (design
    §4.8 + approved decision).
  - LSP go-to-definition no-op → Task 1 (the one new rule).
  - Read-only decorations (rename blocked, no fmt/insert, diagnostics never
    published) → free from slice 4; rename block characterized in Task 2.
  - LSP document-highlight no-op/local-refs → free; no upstream-specific code
    path (documented in scope decisions).
  - MCP `entry_show`/`entry_list`/`entry_context` see upstream via compile cache
    → free from slice 4; origin surfacing added in Tasks 3 (show) + 4 (context).
    `entry_list` intentionally left without a badge (out of issue's stated
    render deltas; its index rows never carried origin).
- **Issue Testing → Tasks:** completion badge (Task 2), hover renders upstream
  (free — covered by existing hover lookup path; no new code to test),
  document-highlight/rename no-op-or-block (Task 2), go-to-definition returns
  null without throwing (Task 1), MCP `entry_show`/`entry_context` render the
  hydrated upstream entry with origin badge (Tasks 3 + 4).
- **Out of scope (issue + design §4.6/§5):** new MCP tools/resource kinds; any
  write path for upstream; transitive federation. None appear in any task.
- **No placeholders:** every code step shows complete code; every run step shows
  the command + expected result.
- **Type consistency:** `resolveDefinitionLocation(entry): LspLocation | null`
  (Task 1) is the only new LSP signature; `WalkNode.origin?: string` (Task 4) is
  the only new MCP type field; both are referenced exactly as defined. Origin
  label strings all come from the one `formatEntryOrigin` (`product@v2.1.0`).
