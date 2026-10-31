/**
 * @module lsp/project_registry_test
 *
 * Unit tests for ProjectRegistry and ProjectContext (#840, #694), run
 * against an in-memory file system.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { dirname, join, normalize, resolve } from "@std/path";
import type { DiscoveryDirEntry } from "../core/mod.ts";
import { parseFile } from "../core/mod.ts";
import { serializeEntry } from "../core/compiler/schema.ts";
import { ProjectContext, type ProjectContextHost } from "./project_context.ts";
import {
  isWithin,
  nearestRoot,
  ProjectRegistry,
  type WatchedFileChange,
} from "./project_registry.ts";
import { pathToUri } from "./util.ts";

/** Absolute base directory for the fake file system. */
const BASE = resolve("/ws-840");

/** Absolute path under {@linkcode BASE} from a `/`-separated relative path. */
function abs(rel: string): string {
  return rel === "" ? BASE : join(BASE, ...rel.split("/"));
}

const PROFILE_DECLARING_ALPHA = `id: "@acme/pa"
version: 0.1.0
markspec-schema: "1"
profile:
  attributes:
    - name: Alpha
      type: text
`;

const PROJECT_YAML = "name: p\nversion: 0.1.0\n";

/** A valid `markspec.lock` with one snapshot-carrying registry upstream
 * named `up`, whose cache lives at `.markspec/cache/upstreams/up/`. */
const LOCK_WITH_UPSTREAM = `schema = 1

[meta]
markspec-schema = 1
locked-at = "2026-05-25T12:00:00Z"

[[upstream.registry]]
id = "up"
api = "https://registry.example"
resolved-manifest-hash = "sha256:a"
markspec-schema = 1
version = "1.0.0"
snapshot = "sha256:b"

[generated-cache]
edges-hash = "sha256:0"
edges-count = 0
`;

/** The upstream entry's file, as recorded in the snapshot. */
const UPSTREAM_FILE = join("/up", "a.md");

/** Build the snapshot cache files for the `up` upstream of the project at
 * `projectRel`: one entry, `SYS_0001`, authored at {@linkcode UPSTREAM_FILE}. */
async function upstreamCacheFiles(
  projectRel: string,
): Promise<Record<string, string>> {
  const { entries } = await parseFile(
    `- [SYS_0001] Upstream requirement\n\n  Body.\n\n      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG\n`,
    { file: UPSTREAM_FILE },
  );
  const serialized = entries.map((e) => serializeEntry(e));
  const manifest = {
    markspecSchemaVersion: 1,
    generator: { release: "0.0.0-test", coreSchema: 1 },
    project: { name: "up", root: "/up" },
    counts: { entries: serialized.length, edges: 0, byType: {} },
    entries: { format: "inline", file: "compiled.json" },
    edges: { format: "inline", file: "compiled.json" },
    sqliteMirror: null,
    federation: [],
    reserved: {},
  };
  const compiled = {
    entries: Object.fromEntries(serialized.map((s) => [s.displayId, s])),
  };
  const dir = `${projectRel}/.markspec/cache/upstreams/up`;
  return {
    [`${dir}/manifest.json`]: JSON.stringify(manifest),
    [`${dir}/compiled.json`]: JSON.stringify(compiled),
  };
}

function entry(displayId: string, idSuffix: string): string {
  return `- [${displayId}] A requirement

  The system shall work.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDE${idSuffix}
`;
}

/** In-memory file system, server notification log, and registry. */
class Fixture {
  readonly files = new Map<string, string>();
  /** Editor buffers by absolute path — what `openText` returns. */
  readonly openTexts = new Map<string, string>();
  readonly notifications: Array<{ method: string; params: unknown }> = [];
  /** Roots passed to `createContext`, in order. */
  readonly created: string[] = [];
  rebuilds = 0;
  readonly registry: ProjectRegistry;
  private readonly contextHost: ProjectContextHost;
  /** When set, every `readDir` waits for it before listing. */
  private gate: Promise<void> | undefined;

  constructor(files: Record<string, string>) {
    for (const [rel, content] of Object.entries(files)) {
      this.files.set(abs(rel), content);
    }
    const readFile = (path: string) =>
      Promise.resolve(this.files.get(normalize(path)));
    const readDir = (path: string) => this.readDir(path);
    this.contextHost = {
      readFile,
      realPath: (p) => Promise.resolve(p),
      readDir,
      sendDiagnostics: () => {},
      sendNotification: (method, params) =>
        this.notifications.push({ method, params }),
      refreshLenses: () => {},
      log: () => {},
      warn: () => {},
      logEvent: () => {},
    };
    this.registry = new ProjectRegistry({
      readFile,
      readDir,
      openText: (path) => this.openTexts.get(normalize(path)),
      createContext: (root) => {
        this.created.push(root);
        return new ProjectContext(root, this.contextHost);
      },
      afterRebuild: () => {
        this.rebuilds++;
        return Promise.resolve();
      },
      onReloadError: (err) => {
        throw err;
      },
    });
  }

  async *readDir(path: string): AsyncIterable<DiscoveryDirEntry> {
    if (this.gate) await this.gate;
    const dir = normalize(path);
    const seen = new Map<string, boolean>();
    for (const file of this.files.keys()) {
      if (!isWithin(dir, file) || file === dir) continue;
      let child = file;
      while (dirname(child) !== dir) child = dirname(child);
      const name = child.slice(dir.length).replace(/^[\\/]/, "");
      seen.set(name, child !== file);
    }
    for (const [name, isDirectory] of seen) {
      yield { name, isDirectory, isFile: !isDirectory };
    }
  }

  /** Block every directory listing until the returned function is called. */
  holdReadDir(): () => void {
    let release: () => void = () => {};
    this.gate = new Promise((r) => release = r);
    return () => {
      this.gate = undefined;
      release();
    };
  }

  async start(workspaceRel: string): Promise<void> {
    await this.registry.init(abs(workspaceRel));
    await this.registry.indexAll();
  }

  rootOf(rel: string): string | undefined {
    return this.registry.contextFor(abs(rel))?.root;
  }

  async change(changes: Array<[string, number]>): Promise<void> {
    const batch: WatchedFileChange[] = changes.map(([rel, type]) => ({
      uri: pathToUri(abs(rel)),
      path: abs(rel),
      type,
    }));
    if (this.registry.noteWatchedChanges(batch)) {
      await this.registry.enqueueWatchedReload();
    }
  }

  profileChangedCount(): number {
    return this.notifications.filter((n) =>
      n.method === "markspec/profileChanged"
    ).length;
  }
}

/** Resolve to `"pending"` when `p` has not settled within `ms`. */
function settledWithin(p: Promise<unknown>, ms: number): Promise<string> {
  return Promise.race([
    p.then(() => "settled", () => "settled"),
    new Promise<string>((r) => setTimeout(() => r("pending"), ms)),
  ]);
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

Deno.test("isWithin: same path, descendant, sibling with shared prefix", () => {
  assert(isWithin(abs("a"), abs("a")));
  assert(isWithin(abs("a"), abs("a/b/c")));
  assert(!isWithin(abs("a"), abs("ab")));
  assert(!isWithin(abs("a/b"), abs("a")));
});

Deno.test("isWithin: a child directory whose name starts with '..' is inside", () => {
  assert(isWithin(abs("a"), abs("a/..cache")));
  assert(isWithin(abs("a"), abs("a/..cache/x.md")));
  assert(!isWithin(abs("a/b"), abs("a/c")));
});

Deno.test("nearestRoot: deepest ancestor wins; undefined outside", () => {
  const roots = [abs(""), abs("a"), abs("a/b")];
  assertEquals(nearestRoot(abs("a/b/c"), roots), abs("a/b"));
  assertEquals(nearestRoot(abs("a/x"), roots), abs("a"));
  assertEquals(nearestRoot(abs("z"), roots), abs(""));
  assertEquals(nearestRoot(resolve("/elsewhere"), [abs("a")]), undefined);
});

// ---------------------------------------------------------------------------
// Startup discovery and ownership
// ---------------------------------------------------------------------------

Deno.test("ProjectRegistry: nested .markspec.yaml projects own their subtrees (#840)", async () => {
  const fx = new Fixture({
    "root.md": entry("REQ_0001", "A"),
    "a/.markspec.yaml": "profiles: []\n",
    "a/req.md": entry("REQ_0001", "B"),
    "a/inner/.markspec.yaml": "profiles: []\n",
    "a/inner/req.md": entry("REQ_0001", "C"),
    "b/.markspec.yaml": "profiles: []\n",
    "b/docs/req.md": entry("REQ_0001", "D"),
  });
  await fx.start("");

  // No config above the workspace: the primary is the workspace root.
  assertEquals(fx.registry.primary?.root, abs(""));
  assertEquals(
    fx.registry.all().map((c) => c.root).sort(),
    [abs(""), abs("a"), abs("a/inner"), abs("b")].sort(),
  );
  assertEquals(fx.rootOf("root.md"), abs(""));
  assertEquals(fx.rootOf("a/req.md"), abs("a"));
  assertEquals(fx.rootOf("a/inner/req.md"), abs("a/inner"));
  assertEquals(fx.rootOf("b/docs/req.md"), abs("b"));

  // Every file is indexed by exactly one context.
  const indexed = fx.registry.all().flatMap((c) => c.index.getFilePaths());
  assertEquals(
    indexed.sort(),
    [
      abs("a/inner/req.md"),
      abs("a/req.md"),
      abs("b/docs/req.md"),
      abs("root.md"),
    ].sort(),
  );
  assertEquals(
    fx.registry.contextFor(abs("a/req.md"))?.index.getFilePaths(),
    [abs("a/req.md")],
  );
  assertEquals(fx.registry.totals(), { files: 4, entries: 4 });
});

Deno.test("ProjectRegistry: a project.yaml-only directory is a nested root too", async () => {
  const fx = new Fixture({
    ".markspec.yaml": "profiles: []\n",
    "a/.markspec.yaml": "profiles: []\n",
    "a/req.md": entry("REQ_0001", "A"),
    "b/project.yaml": PROJECT_YAML,
    "b/req.md": entry("REQ_0001", "B"),
  });
  await fx.start("");
  assertEquals(
    fx.registry.all().map((c) => c.root).sort(),
    [abs(""), abs("a"), abs("b")].sort(),
  );
  assertEquals(fx.rootOf("a/req.md"), abs("a"));
  assertEquals(fx.rootOf("b/req.md"), abs("b"));
});

Deno.test("ProjectRegistry: gitignored .markspec.yaml is not a project root", async () => {
  const fx = new Fixture({
    ".markspec.yaml": "profiles: []\n",
    ".gitignore": "ignored/\n",
    "ignored/.markspec.yaml": "profiles: []\n",
    "ignored/req.md": entry("REQ_0001", "A"),
  });
  await fx.start("");
  assertEquals(fx.registry.all().map((c) => c.root), [abs("")]);
  assertEquals(fx.rootOf("ignored/req.md"), abs(""));
});

Deno.test("ProjectRegistry: exclude: in .markspec.yaml hides nested roots and their files", async () => {
  const fx = new Fixture({
    ".markspec.yaml": "profiles: []\nexclude:\n  - vendor/\n",
    "vendor/.markspec.yaml": "profiles: []\n",
    "vendor/req.md": entry("REQ_0001", "A"),
    "docs/req.md": entry("REQ_0002", "B"),
  });
  await fx.start("");
  assertEquals(fx.registry.all().map((c) => c.root), [abs("")]);
  assertEquals(fx.rootOf("vendor/req.md"), abs(""));
  assertEquals(fx.registry.primary?.index.getFilePaths(), [abs("docs/req.md")]);
});

Deno.test("ProjectRegistry: a nested project's exclude: hides the roots below it", async () => {
  // The primary excludes nothing; nested project a excludes its own
  // fixtures/ folder, so a/fixtures/x is not a root of its own.
  const fx = new Fixture({
    ".markspec.yaml": "profiles: []\n",
    "a/.markspec.yaml": "profiles: []\nexclude:\n  - fixtures/\n",
    "a/req.md": entry("REQ_0001", "A"),
    "a/fixtures/x/.markspec.yaml": "profiles: []\n",
    "a/fixtures/x/req.md": entry("REQ_0002", "B"),
  });
  await fx.start("");
  assertEquals(
    fx.registry.all().map((c) => c.root).sort(),
    [abs(""), abs("a")].sort(),
  );
  assertEquals(fx.rootOf("a/fixtures/x/req.md"), abs("a"));
  // Project a honours its own exclude: list, so the fixture is not indexed.
  assertEquals(
    fx.registry.contextFor(abs("a/req.md"))?.index.getFilePaths(),
    [abs("a/req.md")],
  );
});

Deno.test("ProjectRegistry: workspace below .markspec.yaml walks up (#694)", async () => {
  const fx = new Fixture({
    "proj/.markspec.yaml": "profiles:\n  - ./profiles/pa\n",
    "proj/profiles/pa/markspec.yaml": PROFILE_DECLARING_ALPHA,
    "proj/docs/req.md": entry("REQ_0001", "A"),
  });
  await fx.start("proj/docs");
  const primary = fx.registry.primary;
  assertExists(primary);
  assertEquals(primary.root, abs("proj"));
  assert(primary.profile !== undefined, "profile must be loaded");
  assertEquals(fx.rootOf("proj/docs/req.md"), abs("proj"));
});

Deno.test("ProjectRegistry: a project.yaml at or above the workspace is the root", async () => {
  const fx = new Fixture({
    "p/project.yaml": PROJECT_YAML,
    "p/docs/req.md": entry("REQ_0001", "A"),
  });
  await fx.start("p/docs");
  assertEquals(fx.registry.primary?.root, abs("p"));
});

Deno.test("ProjectRegistry: project.yaml wins over a nearer .markspec.yaml (CLI and MCP order)", async () => {
  // Same layout as the CLI resolves: `project.yaml` first, then
  // `.markspec.yaml`. The lockfile, the upstream cache and project.yaml are
  // read from the project.yaml folder, and the deeper `.markspec.yaml`
  // directory is not a root of its own.
  const fx = new Fixture({
    "p/project.yaml": PROJECT_YAML,
    "p/markspec.lock": LOCK_WITH_UPSTREAM,
    ...await upstreamCacheFiles("p"),
    "p/docs/.markspec.yaml": "profiles: []\n",
    "p/docs/sub/req.md": entry("REQ_0001", "A"),
  });
  await fx.start("p/docs/sub");
  const primary = fx.registry.primary;
  assertExists(primary);
  assertEquals(primary.root, abs("p"));
  assertEquals(fx.registry.all().map((c) => c.root), [abs("p")]);
  assertEquals(fx.rootOf("p/docs/sub/req.md"), abs("p"));
  // markspec.lock and the upstream cache were read from `p/`.
  assertEquals(primary.lockfile?.upstreams.length, 1);
  assertEquals(
    primary.index.getEntryByDisplayId("SYS_0001" as never)?.origin?.kind,
    "upstream",
  );
});

Deno.test("ProjectRegistry: a file outside every root falls back to the primary", async () => {
  const fx = new Fixture({
    "ws/req.md": entry("REQ_0001", "A"),
    "outside/loose.md": entry("REQ_0002", "B"),
  });
  await fx.start("ws");
  assertEquals(fx.registry.primary?.root, abs("ws"));
  assertEquals(fx.rootOf("outside/loose.md"), abs("ws"));
  const ctx = await fx.registry.ensureContextFor(abs("outside/loose.md"));
  assertEquals(ctx?.root, abs("ws"));
});

Deno.test("ProjectRegistry: a file outside every root with its own .markspec.yaml gets its own context", async () => {
  const fx = new Fixture({
    "ws/req.md": entry("REQ_0001", "A"),
    "other/.markspec.yaml": "profiles: []\n",
    "other/docs/req.md": entry("REQ_0001", "B"),
  });
  await fx.start("ws");
  const ctx = await fx.registry.ensureContextFor(abs("other/docs/req.md"));
  assertEquals(ctx?.root, abs("other"));
  assert(ctx?.indexed);
  assertEquals(ctx?.index.getFilePaths(), [abs("other/docs/req.md")]);
  assertEquals(fx.rootOf("other/docs/req.md"), abs("other"));
});

Deno.test("ProjectRegistry: concurrent ensureContextFor calls for one new root create one context", async () => {
  const fx = new Fixture({
    "ws/req.md": entry("REQ_0001", "A"),
    "other/.markspec.yaml": "profiles: []\n",
    "other/docs/a.md": entry("REQ_0001", "B"),
    "other/docs/b.md": entry("REQ_0002", "C"),
  });
  await fx.start("ws");
  const [first, second] = await Promise.all([
    fx.registry.ensureContextFor(abs("other/docs/a.md")),
    fx.registry.ensureContextFor(abs("other/docs/b.md")),
  ]);
  assertExists(first);
  assert(first === second, "both documents must share one context");
  assertEquals(fx.created.filter((r) => r === abs("other")).length, 1);
  assertEquals(fx.registry.contextFor(abs("other/docs/a.md")), first);
});

Deno.test("ProjectRegistry: without a workspace root, concurrent first opens create one fallback context", async () => {
  const fx = new Fixture({});
  const [first, second] = await Promise.all([
    fx.registry.ensureContextFor(abs("x/a.md")),
    fx.registry.ensureContextFor(abs("x/b.md")),
  ]);
  assertExists(first);
  assert(first === second, "both documents must share one context");
  assertEquals(fx.created, [abs("x")]);
  assertEquals(fx.registry.primary, first);
  assertEquals(fx.registry.contextFor(abs("x/a.md")), first);
});

Deno.test("ProjectRegistry: a document under a nested root is not routed to the anchor while on-demand discovery runs", async () => {
  // Editor restores two tabs of a project outside the workspace: `x` under
  // `other/` and `y` under the nested `other/sub/`. The first open creates
  // `other` and walks it for nested roots; while that walk runs, `y` must
  // wait rather than be handed `other` (and then be indexed twice).
  const fx = new Fixture({
    "ws/req.md": entry("REQ_0001", "A"),
    "other/.markspec.yaml": "profiles: []\n",
    "other/docs/x.md": entry("REQ_0002", "B"),
    "other/sub/.markspec.yaml": "profiles: []\n",
    "other/sub/y.md": entry("REQ_0003", "C"),
  });
  await fx.start("ws");

  const release = fx.holdReadDir();
  const first = fx.registry.ensureContextFor(abs("other/docs/x.md"));
  // Give createAndLoad(other) time to put `other` into the map.
  await new Promise((r) => setTimeout(r, 30));
  const second = fx.registry.ensureContextFor(abs("other/sub/y.md"));
  assertEquals(await settledWithin(second, 30), "pending");

  release();
  const other = await first;
  const sub = await second;
  assertEquals(other?.root, abs("other"));
  assertEquals(sub?.root, abs("other/sub"));
  assertEquals(other?.index.getFilePaths(), [abs("other/docs/x.md")]);
  assertEquals(sub?.index.getFilePaths(), [abs("other/sub/y.md")]);
});

Deno.test("ProjectRegistry: a file indexed before its nested root was known is evicted from the anchor", async () => {
  // Even if a file reached the anchor's index, discovering the nested
  // root moves it: the anchor drops it and clears its diagnostics.
  const fx = new Fixture({
    "ws/req.md": entry("REQ_0001", "A"),
    "other/.markspec.yaml": "profiles: []\n",
    "other/docs/x.md": entry("REQ_0002", "B"),
    "other/sub/.markspec.yaml": "profiles: []\n",
    "other/sub/y.md": entry("REQ_0003", "C"),
  });
  await fx.start("ws");
  const release = fx.holdReadDir();
  const first = fx.registry.ensureContextFor(abs("other/docs/x.md"));
  await new Promise((r) => setTimeout(r, 30));
  // Simulate a stale parse landing in `other` before `other/sub` exists.
  const other = fx.registry.contextFor(abs("other/docs/x.md"));
  assertExists(other);
  await other.index.parseAndUpdateFile(
    abs("other/sub/y.md"),
    entry("REQ_0003", "C"),
  );
  release();
  await first;
  assertEquals(other.index.getFilePaths(), [abs("other/docs/x.md")]);
  assertEquals(
    fx.registry.contextFor(abs("other/sub/y.md"))?.index.getFilePaths(),
    [abs("other/sub/y.md")],
  );
  assertEquals(fx.registry.totals(), { files: 3, entries: 3 });
});

Deno.test("ProjectRegistry: a fallback-owned file survives a later on-demand addTree", async () => {
  // A loose file with no config above it joins the primary. Opening a
  // document of another project afterwards walks that project's tree;
  // the eviction pass must not touch the loose file, which lies outside
  // the walked tree and is still owned by the primary.
  const fx = new Fixture({
    "ws/.markspec.yaml": "profiles: []\n",
    "ws/req.md": entry("REQ_0001", "A"),
    "loose/notes.md": entry("REQ_0005", "E"),
    "other/.markspec.yaml": "profiles: []\n",
    "other/x.md": entry("REQ_0002", "B"),
  });
  await fx.start("ws");
  const loose = abs("loose/notes.md");
  const ctx = await fx.registry.ensureContextFor(loose);
  assertEquals(ctx, fx.registry.primary);
  await ctx!.index.parseAndUpdateFile(loose, entry("REQ_0005", "E"));

  const other = await fx.registry.ensureContextFor(abs("other/x.md"));
  assertEquals(other?.root, abs("other"));
  assert(
    fx.registry.primary!.index.getFilePaths().includes(loose),
    "the loose file was evicted from the primary",
  );
  assertEquals(fx.registry.contextFor(loose), fx.registry.primary);
});

Deno.test("ProjectRegistry: an unsaved buffer evicted by an on-demand addTree is parsed into its new owner", async () => {
  // `ws/notes.md` exists only in the editor and joins the primary
  // (`ws/proj`) by fallback. A `.markspec.yaml` then appears at `ws/`
  // (outside the workspace, so unwatched) and a document under it is
  // opened: the walk of `ws/` cannot see the unsaved buffer, so after the
  // eviction from the primary the new owner must take it from the buffer.
  const fx = new Fixture({
    "ws/proj/.markspec.yaml": "profiles: []\n",
    "ws/proj/req.md": entry("REQ_0001", "A"),
    "ws/other/x.md": entry("REQ_0002", "B"),
  });
  await fx.start("ws/proj");
  const notes = abs("ws/notes.md");
  fx.openTexts.set(notes, entry("REQ_0005", "E"));
  const primary = await fx.registry.ensureContextFor(notes);
  assertEquals(primary, fx.registry.primary);
  await primary!.index.parseAndUpdateFile(notes, entry("REQ_0005", "E"));

  fx.files.set(abs("ws/.markspec.yaml"), "profiles: []\n");
  const ws = await fx.registry.ensureContextFor(abs("ws/other/x.md"));
  assertEquals(ws?.root, abs("ws"));
  assertEquals(fx.registry.contextFor(notes), ws);
  assert(!primary!.index.getFilePaths().includes(notes));
  assertEquals(
    ws?.index.getEntriesForFile(notes).map((e) => e.displayId),
    ["REQ_0005"],
  );
});

Deno.test("ProjectRegistry: a document opened during startup waits for the nested roots", async () => {
  const fx = new Fixture({
    ".markspec.yaml": "profiles: []\n",
    "a/.markspec.yaml": "profiles: []\n",
    "a/req.md": entry("REQ_0001", "A"),
  });
  // The primary exists, but the nested roots are not discovered yet.
  await fx.registry.init(abs(""));
  const release = fx.holdReadDir();
  const indexing = fx.registry.indexAll();
  const routed = fx.registry.ensureContextFor(abs("a/req.md"));
  assertEquals(await settledWithin(routed, 30), "pending");
  release();
  await indexing;
  assertEquals((await routed)?.root, abs("a"));
});

Deno.test("ProjectRegistry: an open editor buffer is indexed instead of the file on disk", async () => {
  const fx = new Fixture({
    ".markspec.yaml": "profiles: []\n",
    "req.md": entry("REQ_0001", "A"),
    "other/.markspec.yaml": "profiles: []\n",
    "other/req.md": entry("REQ_0001", "B"),
  });
  fx.openTexts.set(abs("req.md"), entry("REQ_0008", "C"));
  fx.openTexts.set(abs("other/req.md"), entry("REQ_0009", "D"));
  // Startup indexing.
  await fx.start("");
  assertEquals(
    fx.registry.primary?.index.getEntriesForFile(abs("req.md")).map((e) =>
      e.displayId
    ),
    ["REQ_0008"],
  );
  // On-demand indexing of a project outside the workspace.
  const other = await fx.registry.ensureContextFor(abs("other/req.md"));
  assertEquals(
    other?.index.getEntriesForFile(abs("other/req.md")).map((e) => e.displayId),
    ["REQ_0009"],
  );
});

// ---------------------------------------------------------------------------
// Watched-file routing
// ---------------------------------------------------------------------------

Deno.test("ProjectRegistry: a lockfile-only change reloads the lockfile and upstream corpus of its own project, without a profile push", async () => {
  const fx = new Fixture({
    "a/.markspec.yaml": "profiles: []\n",
    "b/.markspec.yaml": "profiles: []\n",
  });
  await fx.start("");
  const a = fx.registry.contextFor(abs("a/x.md"));
  const b = fx.registry.contextFor(abs("b/x.md"));
  assertExists(a);
  assertExists(b);
  assertEquals(a.lockfile, undefined);

  fx.files.set(abs("a/markspec.lock"), LOCK_WITH_UPSTREAM);
  for (const [rel, content] of Object.entries(await upstreamCacheFiles("a"))) {
    fx.files.set(abs(rel), content);
  }
  await fx.change([["a/markspec.lock", 2]]);

  assertEquals(a.lockfile?.upstreams.length, 1);
  assertEquals(
    a.index.getEntryByDisplayId("SYS_0001" as never)?.origin?.kind,
    "upstream",
  );
  assert(a.isCorpusFile(UPSTREAM_FILE));
  assertEquals(b.lockfile, undefined);
  assertEquals(b.index.getEntryByDisplayId("SYS_0001" as never), undefined);
  assertEquals(fx.profileChangedCount(), 0);
  assertEquals(fx.rebuilds, 0);
});

Deno.test("ProjectRegistry: an edited .markspec.yaml reloads the profile of its own project", async () => {
  const fx = new Fixture({
    "a/.markspec.yaml": "profiles: []\n",
    "a/profiles/pa/markspec.yaml": PROFILE_DECLARING_ALPHA,
    "b/.markspec.yaml": "profiles: []\n",
  });
  await fx.start("");
  const a = fx.registry.contextFor(abs("a/x.md"));
  assertExists(a);
  const alphaBefore = [...(a.profile?.attributes.keys() ?? [])];
  assert(!alphaBefore.includes("Alpha"));

  fx.files.set(abs("a/.markspec.yaml"), "profiles:\n  - ./profiles/pa\n");
  await fx.change([["a/.markspec.yaml", 2]]);

  assert([...(a.profile?.attributes.keys() ?? [])].includes("Alpha"));
  const changed = fx.notifications.filter((n) =>
    n.method === "markspec/profileChanged"
  );
  assertEquals(changed.length, 1);
  // The payload names the project whose profile changed.
  assertEquals(
    (changed[0].params as { root: string }).root,
    pathToUri(abs("a")),
  );
  assertEquals(fx.rebuilds, 0);
});

Deno.test("ProjectRegistry: an edited exclude: list re-discovers roots and drops excluded files", async () => {
  const fx = new Fixture({
    ".markspec.yaml": "profiles: []\n",
    "vendor/.markspec.yaml": "profiles: []\n",
    "vendor/req.md": entry("REQ_0001", "A"),
    "docs/req.md": entry("REQ_0002", "B"),
  });
  await fx.start("");
  assertEquals(fx.rootOf("vendor/req.md"), abs("vendor"));

  fx.files.set(abs(".markspec.yaml"), "profiles: []\nexclude:\n  - vendor/\n");
  await fx.change([[".markspec.yaml", 2]]);

  assertEquals(fx.rebuilds, 1);
  assertEquals(fx.registry.all().map((c) => c.root), [abs("")]);
  assertEquals(fx.rootOf("vendor/req.md"), abs(""));
  const indexed = fx.registry.all().flatMap((c) => c.index.getFilePaths());
  assertEquals(indexed, [abs("docs/req.md")]);
  assertEquals(fx.registry.primary?.toolConfig.exclude, ["vendor/"]);
});

Deno.test("ProjectRegistry: creating a .markspec.yaml rebuilds the registry", async () => {
  const fx = new Fixture({
    "a/req.md": entry("REQ_0001", "A"),
  });
  await fx.start("");
  assertEquals(fx.rootOf("a/req.md"), abs(""));

  fx.files.set(abs("a/.markspec.yaml"), "profiles: []\n");
  await fx.change([["a/.markspec.yaml", 1]]);

  assertEquals(fx.rebuilds, 1);
  assertEquals(fx.rootOf("a/req.md"), abs("a"));
  assertEquals(
    fx.registry.contextFor(abs("a/req.md"))?.index.getFilePaths(),
    [abs("a/req.md")],
  );
  assertEquals(fx.registry.primary?.index.getFilePaths(), []);
});

Deno.test("ProjectRegistry: creating a project.yaml rebuilds the registry", async () => {
  const fx = new Fixture({
    "b/req.md": entry("REQ_0001", "A"),
  });
  await fx.start("");
  assertEquals(fx.rootOf("b/req.md"), abs(""));

  fx.files.set(abs("b/project.yaml"), PROJECT_YAML);
  await fx.change([["b/project.yaml", 1]]);

  assertEquals(fx.rebuilds, 1);
  assertEquals(fx.rootOf("b/req.md"), abs("b"));
});

Deno.test("ProjectRegistry: deleting a .markspec.yaml rebuilds the registry", async () => {
  const fx = new Fixture({
    "a/.markspec.yaml": "profiles: []\n",
    "a/req.md": entry("REQ_0001", "A"),
  });
  await fx.start("");
  assertEquals(fx.rootOf("a/req.md"), abs("a"));

  fx.files.delete(abs("a/.markspec.yaml"));
  await fx.change([["a/.markspec.yaml", 3]]);

  assertEquals(fx.rebuilds, 1);
  assertEquals(fx.registry.all().map((c) => c.root), [abs("")]);
  assertEquals(fx.rootOf("a/req.md"), abs(""));
  assertEquals(fx.registry.primary?.index.getFilePaths(), [abs("a/req.md")]);
});

Deno.test("ProjectRegistry: a watched change recorded during a rebuild is applied to the new context", async () => {
  const fx = new Fixture({
    "a/.markspec.yaml": "profiles: []\n",
    "b/req.md": entry("REQ_0001", "A"),
  });
  await fx.start("");
  const oldA = fx.registry.contextFor(abs("a/x.md"));
  assertExists(oldA);

  // Start a rebuild and block it inside the directory walk.
  const release = fx.holdReadDir();
  fx.files.set(abs("b/.markspec.yaml"), "profiles: []\n");
  const rebuild = fx.change([["b/.markspec.yaml", 1]]);
  assertEquals(await settledWithin(rebuild, 30), "pending");

  // A lockfile change for `a` arrives while the rebuild runs.
  fx.files.set(abs("a/markspec.lock"), LOCK_WITH_UPSTREAM);
  const lockReload = fx.change([["a/markspec.lock", 2]]);
  release();
  await Promise.all([rebuild, lockReload]);

  const newA = fx.registry.contextFor(abs("a/x.md"));
  assertExists(newA);
  assert(newA !== oldA, "the rebuild must have replaced the context");
  assertEquals(newA.lockfile?.upstreams.length, 1);
  assertEquals(fx.rootOf("b/req.md"), abs("b"));
});

Deno.test("ProjectRegistry: no on-demand context is created or indexed after shutdown", async () => {
  const fx = new Fixture({
    "ws/req.md": entry("REQ_0001", "A"),
    "other/.markspec.yaml": "profiles: []\n",
    "other/docs/x.md": entry("REQ_0002", "B"),
    "late/.markspec.yaml": "profiles: []\n",
    "late/z.md": entry("REQ_0004", "D"),
  });
  await fx.start("ws");

  // Queued before shutdown, still running when it arrives.
  const release = fx.holdReadDir();
  const queued = fx.registry.ensureContextFor(abs("other/docs/x.md"));
  await new Promise((r) => setTimeout(r, 30));
  fx.registry.shutdown();
  release();
  assertEquals(await queued, undefined);

  // Requested after shutdown.
  assertEquals(await fx.registry.ensureContextFor(abs("late/z.md")), undefined);
  assert(!fx.created.includes(abs("late")));
  for (const ctx of fx.registry.all()) assert(ctx.isDisposed);
});

Deno.test("ProjectRegistry: no reload runs after shutdown", async () => {
  const fx = new Fixture({ "a/.markspec.yaml": "profiles: []\n" });
  await fx.start("");
  fx.registry.shutdown();
  await fx.change([["a/.markspec.yaml", 1]]);
  assertEquals(fx.rebuilds, 0);
});

// ---------------------------------------------------------------------------
// Disposed contexts
// ---------------------------------------------------------------------------

Deno.test("ProjectContext: a disposed context sends no diagnostics or notifications", async () => {
  const sent: string[] = [];
  const files = new Map<string, string>([
    [abs("p/.markspec.yaml"), "profiles: []\n"],
  ]);
  const host: ProjectContextHost = {
    readFile: (path) => Promise.resolve(files.get(normalize(path))),
    realPath: (p) => Promise.resolve(p),
    readDir: async function* () {},
    sendDiagnostics: (uri) => sent.push(`diagnostics ${uri}`),
    sendNotification: (method) => sent.push(method),
    refreshLenses: () => sent.push("refresh"),
    log: () => {},
    warn: () => {},
    logEvent: () => {},
  };
  const ctx = new ProjectContext(abs("p"), host);
  await ctx.load();
  await ctx.index.parseAndUpdateFile(abs("p/req.md"), entry("REQ_0001", "A"));

  ctx.dispose();
  ctx.scheduleValidateAll();
  ctx.validateAllNow();
  ctx.publishAllDiagnostics();
  ctx.markWatchedChange(false);
  await ctx.reloadWatchedFiles();
  await ctx.reloadProfile();
  // Let a re-armed 1000ms debounce fire, if anything re-armed it.
  await new Promise((r) => setTimeout(r, 1100));
  assertEquals(sent, []);
  assert(ctx.isDisposed);

  // The final cleanup is still allowed.
  ctx.clearPublishedDiagnostics();
  assertEquals(sent, [`diagnostics ${pathToUri(abs("p/req.md"))}`]);
});
