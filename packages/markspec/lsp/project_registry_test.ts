/**
 * @module lsp/project_registry_test
 *
 * Unit tests for ProjectRegistry and ProjectContext (#840, #694), run
 * against an in-memory file system.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { dirname, join, normalize, resolve } from "@std/path";
import type { DiscoveryDirEntry } from "../core/mod.ts";
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

function entry(displayId: string, idSuffix: string): string {
  return `- [${displayId}] A requirement

  The system shall work.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDE${idSuffix}
`;
}

/** In-memory file system, server notification log, and registry. */
class Fixture {
  readonly files = new Map<string, string>();
  readonly notifications: Array<{ method: string; params: unknown }> = [];
  rebuilds = 0;
  readonly registry: ProjectRegistry;
  private readonly contextHost: ProjectContextHost;

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
      createContext: (root) => new ProjectContext(root, this.contextHost),
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

Deno.test("ProjectRegistry: project.yaml is the fallback when no .markspec.yaml exists", async () => {
  const fx = new Fixture({
    "p/project.yaml": "name: p\nversion: 0.1.0\n",
    "p/docs/req.md": entry("REQ_0001", "A"),
  });
  await fx.start("p/docs");
  assertEquals(fx.registry.primary?.root, abs("p"));
});

Deno.test("ProjectRegistry: .markspec.yaml wins over a nearer project.yaml", async () => {
  const fx = new Fixture({
    ".markspec.yaml": "profiles: []\n",
    "sub/project.yaml": "name: sub\nversion: 0.1.0\n",
    "sub/req.md": entry("REQ_0001", "A"),
  });
  await fx.start("sub");
  assertEquals(fx.registry.primary?.root, abs(""));
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

// ---------------------------------------------------------------------------
// Watched-file routing
// ---------------------------------------------------------------------------

Deno.test("ProjectRegistry: a lockfile change reloads only its own project, without a profile push", async () => {
  const fx = new Fixture({
    "a/.markspec.yaml": "profiles: []\n",
    "b/.markspec.yaml": "profiles: []\n",
  });
  await fx.start("");
  const a = fx.registry.contextFor(abs("a/x.md"));
  const b = fx.registry.contextFor(abs("b/x.md"));
  assertExists(a);
  assertExists(b);

  const batch: WatchedFileChange[] = [{
    uri: pathToUri(abs("b/markspec.lock")),
    path: abs("b/markspec.lock"),
    type: 2,
  }];
  assert(fx.registry.noteWatchedChanges(batch));
  assert(b.hasPendingWatchedChange());
  assert(!a.hasPendingWatchedChange());
  await fx.registry.enqueueWatchedReload();
  assert(!b.hasPendingWatchedChange());
  assertEquals(
    fx.notifications.filter((n) => n.method === "markspec/profileChanged"),
    [],
  );
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
