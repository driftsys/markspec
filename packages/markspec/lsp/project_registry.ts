/**
 * @module lsp/project_registry
 *
 * Maps documents to the MarkSpec project that owns them (#840, #694).
 *
 * The registry holds one {@linkcode ProjectContext} per config root. A
 * document belongs to the context whose root is its nearest ancestor
 * among the known roots. The known roots are:
 *
 * - the primary root, found by walking UP from the editor's workspace
 *   root to the nearest `project.yaml`, else the nearest
 *   `.markspec.yaml`, else the workspace root itself (#694). The CLI and
 *   the MCP server use the same order (core `resolveConfigRoot`, #845), so
 *   `markspec.lock`, the upstream cache and `project.yaml` are read from
 *   the same folder in all three;
 * - every directory BELOW the primary root that a document walk-up would
 *   resolve to (gitignore-aware discovery of `project.yaml` and
 *   `.markspec.yaml`), so a workspace that is a parent folder of several
 *   projects validates each one against its own profile (#840);
 * - a root found on demand by walking up from a document that lies
 *   outside every known root (see {@linkcode ProjectRegistry.ensureContextFor}).
 *
 * Each file belongs to exactly one context: a parent context's file walk
 * skips the subtrees of nested projects, so no file is indexed twice.
 * A document outside every known root, with no config above it, falls
 * back to the primary context.
 *
 * A config file that sits in a gitignored, excluded or hidden directory
 * below a known root is not discovered; documents there belong to the
 * enclosing known root.
 *
 * Every mutation of the root set — startup, on-demand creation, rebuild,
 * watched-file reload — runs on one serial lane
 * ({@linkcode createSerialRunner}), so two mutations never interleave and
 * a document is never routed against a half-built root set.
 */

import { basename, dirname } from "@std/path";
import {
  type DiscoveryDirEntry,
  findNestedProjectRoots,
  isWithin,
  nearestRoot,
  resolveConfigRoot,
} from "../core/mod.ts";
// The LSP tests and callers historically import these from here.
export { isWithin, nearestRoot, resolveConfigRoot };

import type { ProjectContext } from "./project_context.ts";
import { createSerialRunner } from "./util.ts";
import { isLockfileOnlyChange } from "./watched_files.ts";

/** The file names whose directory can be a project root. */
const CONFIG_BASENAMES: ReadonlySet<string> = new Set([
  "project.yaml",
  ".markspec.yaml",
]);

/** The activator file name (ADR-008); gates the event log. */
const MARKSPEC_YAML = ".markspec.yaml";

/** LSP `FileChangeType` values. */
const FILE_CREATED = 1;
const FILE_DELETED = 3;

/** I/O and callbacks the registry needs from the server. */
export interface ProjectRegistryHost {
  /** Read a file; resolves `undefined` when it does not exist. */
  readFile(path: string): Promise<string | undefined>;
  /** List a directory (nested root discovery). */
  readDir(path: string): AsyncIterable<DiscoveryDirEntry>;
  /** The text of the editor buffer open at `path`, or `undefined` when
   * the file is not open. Indexing parses this instead of the file on
   * disk, so an unsaved edit is never overwritten by stale disk content. */
  openText(path: string): string | undefined;
  /** Construct an unloaded context for `root`. */
  createContext(root: string): ProjectContext;
  /** Called after the registry was rebuilt (a `project.yaml` or
   * `.markspec.yaml` was created or deleted, or an `exclude:` list
   * changed). Runs outside the serial lane, so it may call
   * {@linkcode ProjectRegistry.ensureContextFor}. */
  afterRebuild(): Promise<void>;
  /** Called when a serialized watched-file reload throws. */
  onReloadError(err: unknown): void;
}

/** One watched-file event, with its URI also converted to a path. */
export interface WatchedFileChange {
  readonly uri: string;
  readonly path: string;
  /** LSP `FileChangeType`: 1 created, 2 changed, 3 deleted. */
  readonly type: number;
}

/**
 * The set of {@linkcode ProjectContext}s for one LSP session, and the
 * rules that route a document to its context.
 */
export class ProjectRegistry {
  private readonly host: ProjectRegistryHost;
  private readonly contexts = new Map<string, ProjectContext>();
  private primaryRoot: string | undefined;
  private workspaceRoot: string | undefined;
  /** Directory → nearest known root. Cleared whenever the root set
   * changes. */
  private readonly ownerCache = new Map<string, string | undefined>();
  /** Directory → result of {@linkcode resolveConfigRoot} for documents
   * outside every known root. Cleared on rebuild. */
  private readonly walkUpCache = new Map<string, string | undefined>();
  /** Watched-file changes recorded by {@linkcode noteWatchedChanges} and
   * not yet classified. Classification happens on the lane, against the
   * settled root set, so a change that arrives during a rebuild is
   * neither lost nor attributed to a context the rebuild discards. */
  private pendingChanges: WatchedFileChange[] = [];
  /**
   * The serial lane. Startup, on-demand root creation, rebuilds and
   * watched-file reloads all run here, one at a time (#797 review: the
   * seeders' shared-set mutations are safe only when `seedDeliveredCorpus`
   * and `seedUpstreamCorpus` run back to back, an invariant a concurrent
   * run breaks; and a root created while a rebuild is clearing the map
   * would leak or vanish).
   */
  private readonly lane = createSerialRunner();
  /**
   * Resolves when the root set is settled: startup discovery and indexing
   * ({@linkcode init} + {@linkcode indexAll}) has finished, and no rebuild
   * is in progress. {@linkcode ensureContextFor} waits for it, because a
   * document routed before the nested projects are known would land in
   * the wrong index. Trade-off: the first diagnostics for a document
   * opened during a cold start wait for the whole startup index.
   */
  private startup: Promise<void> = Promise.resolve();
  private finishStartup: () => void = () => {};
  /** `false` while the gate above is armed. */
  private startupOpen = true;
  /** Set by {@linkcode shutdown} so a lane task queued behind an
   * in-flight one never starts after the final event-log flush. */
  private shuttingDown = false;

  constructor(host: ProjectRegistryHost) {
    this.host = host;
  }

  // -------------------------------------------------------------------------
  // Startup
  // -------------------------------------------------------------------------

  /**
   * Create and load the primary context for `workspaceRoot`. The primary
   * root is the nearest `project.yaml` at or above the workspace root,
   * else the nearest `.markspec.yaml`, else the workspace root itself.
   * Does not index files; call {@linkcode indexAll} for that. Arms the
   * startup gate until {@linkcode indexAll} finishes.
   */
  init(workspaceRoot: string): Promise<ProjectContext> {
    this.armStartupGate();
    return this.lane(() => this.initInner(workspaceRoot));
  }

  /**
   * Discover the projects nested below the primary root, load them, and
   * index every context that has not been indexed yet. Publishes
   * diagnostics for each newly indexed context, then releases the
   * startup gate.
   */
  indexAll(): Promise<void> {
    return this.lane(async () => {
      try {
        await this.indexAllInner();
      } finally {
        this.finishStartup();
      }
    });
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** The primary context, or `undefined` before {@linkcode init} ran (or
   * when the client sent no workspace root and no document was opened). */
  get primary(): ProjectContext | undefined {
    return this.primaryRoot === undefined
      ? undefined
      : this.contexts.get(this.primaryRoot);
  }

  /** The editor's workspace root passed to {@linkcode init}, or
   * `undefined` when the client sent none. */
  get workspace(): string | undefined {
    return this.workspaceRoot;
  }

  /** Every context, primary first. */
  all(): ProjectContext[] {
    const primary = this.primary;
    const rest = [...this.contexts.values()].filter((c) => c !== primary);
    return primary ? [primary, ...rest] : rest;
  }

  /** Roots of the contexts whose directory holds a `.markspec.yaml`,
   * primary first. Used to pick the single event-log location. */
  async markspecRoots(): Promise<string[]> {
    const out: string[] = [];
    for (const ctx of this.all()) {
      const raw = await this.host.readFile(`${ctx.root}/${MARKSPEC_YAML}`);
      if (raw !== undefined) out.push(ctx.root);
    }
    return out;
  }

  /**
   * The context that owns `filePath`, without I/O. A delivered or
   * upstream corpus file belongs to the context that seeded it. Any other
   * file belongs to its nearest known root, else to the primary context.
   */
  contextFor(filePath: string): ProjectContext | undefined {
    for (const ctx of this.contexts.values()) {
      if (ctx.isCorpusFile(filePath)) return ctx;
    }
    const owner = this.ownerRoot(filePath);
    return owner === undefined ? this.primary : this.contexts.get(owner);
  }

  /**
   * Like {@linkcode contextFor}, but waits for the root set to settle
   * (startup indexing or a rebuild in progress), and a document outside
   * every known root walks up to its own `project.yaml` (else
   * `.markspec.yaml`). When one is found, a context is created, loaded and
   * indexed for that root before this resolves. When none is found the
   * document falls back to the primary context; when there is no primary
   * context either (the client sent no workspace root), a context rooted
   * at the document's directory is created without indexing its tree.
   *
   * The wait is deliberate: a document opened during a cold start gets
   * its first diagnostics only after the startup index has finished,
   * rather than being validated against the wrong project.
   */
  async ensureContextFor(
    filePath: string,
  ): Promise<ProjectContext | undefined> {
    await this.startup;
    const known = this.contextFor(filePath);
    if (known && this.ownerRoot(filePath) !== undefined) return known;
    if (known?.isCorpusFile(filePath)) return known;
    // The document lies outside every known root. Creating its context
    // mutates the root set, so it runs on the lane. The lane task checks
    // the root set again: a concurrent call for the same root, or a
    // rebuild that ran in between, may already have created it.
    return await this.lane(() => this.createFor(filePath));
  }

  /** Total project files and entries across every context. */
  totals(): { files: number; entries: number } {
    let files = 0;
    let entries = 0;
    for (const ctx of this.contexts.values()) {
      files += ctx.index.getFilePaths().filter((p) => !ctx.isCorpusFile(p))
        .length;
      entries += ctx.index.getAllEntries().length;
    }
    return { files, entries };
  }

  // -------------------------------------------------------------------------
  // Watched files
  // -------------------------------------------------------------------------

  /**
   * Record a batch of watched-file changes for the next
   * {@linkcode enqueueWatchedReload}. Classification is deferred to the
   * lane so it sees a settled root set. Creating or deleting a
   * `project.yaml` or `.markspec.yaml` changes file ownership and rebuilds
   * the registry; any other change (`.markspec.yaml` edited,
   * `project.yaml` edited, `markspec.lock`) reloads only the context that
   * owns the changed file.
   *
   * @returns `true` when there is a reload to run.
   */
  noteWatchedChanges(changes: readonly WatchedFileChange[]): boolean {
    this.pendingChanges.push(...changes);
    return changes.length > 0;
  }

  /**
   * Queue the reload for the changes recorded by
   * {@linkcode noteWatchedChanges} behind any lane task already in
   * flight. Errors are reported through `host.onReloadError` and never
   * reject the returned promise. When the reload rebuilt the registry,
   * `host.afterRebuild` runs after the lane task, outside the lane.
   */
  enqueueWatchedReload(): Promise<void> {
    return this.lane(() => this.runWatchedReload())
      .then((rebuilt) => rebuilt ? this.host.afterRebuild() : undefined)
      .catch((err) => this.host.onReloadError(err));
  }

  /** Stop all future reloads and cancel scheduled validations. */
  shutdown(): void {
    this.shuttingDown = true;
    for (const ctx of this.contexts.values()) ctx.dispose();
  }

  // -------------------------------------------------------------------------
  // Internal — every method below runs on the lane
  // -------------------------------------------------------------------------

  /**
   * Arm the startup gate, unless it is armed already. Returns `true` when
   * this call armed it, so the caller knows whether it must release it.
   * Arming twice would replace the resolver and strand the earlier
   * waiters.
   */
  private armStartupGate(): boolean {
    if (!this.startupOpen) return false;
    this.startupOpen = false;
    let release: () => void = () => {};
    this.startup = new Promise((done) => release = done);
    this.finishStartup = () => {
      this.startupOpen = true;
      release();
    };
    return true;
  }

  private async initInner(workspaceRoot: string): Promise<ProjectContext> {
    this.workspaceRoot = workspaceRoot;
    const root = await resolveConfigRoot(workspaceRoot, this.host.readFile) ??
      workspaceRoot;
    this.primaryRoot = root;
    return await this.createAndLoad(root);
  }

  private async indexAllInner(): Promise<void> {
    if (this.shuttingDown || this.primaryRoot === undefined) return;
    const primary = this.contexts.get(this.primaryRoot);
    if (primary) await this.addTree(primary);
  }

  /** `true` when the reload rebuilt the registry. */
  private async runWatchedReload(): Promise<boolean> {
    // A queued lane task can start after shutdown ran (cancelling the
    // debounce only clears the un-fired timer, not an already-queued
    // task) — bail instead of writing to the log or a dead connection
    // (#799 review).
    if (this.shuttingDown) return false;
    const changes = this.pendingChanges;
    this.pendingChanges = [];
    let rebuild = false;
    const urisByContext = new Map<ProjectContext, string[]>();
    for (const change of changes) {
      if (
        CONFIG_BASENAMES.has(basename(change.path)) &&
        (change.type === FILE_CREATED || change.type === FILE_DELETED)
      ) {
        rebuild = true;
        continue;
      }
      const ctx = this.contextFor(change.path);
      if (!ctx) continue;
      const uris = urisByContext.get(ctx) ?? [];
      uris.push(change.uri);
      urisByContext.set(ctx, uris);
    }
    if (!rebuild) {
      // A context whose batch holds only `markspec.lock` changes takes the
      // cheap upstream re-seed path (#771).
      for (const [ctx, uris] of urisByContext) {
        ctx.markWatchedChange(isLockfileOnlyChange(uris));
      }
      for (const ctx of this.all()) {
        if (!ctx.hasPendingWatchedChange()) continue;
        // A changed `exclude:` list can drop files from a project or
        // change which nested directories are roots; the rebuild path
        // re-discovers and re-indexes everything with the new list.
        if (await ctx.reloadWatchedFiles()) rebuild = true;
      }
    }
    if (!rebuild) return false;
    await this.rebuild();
    return true;
  }

  /** Discard every context and discover them again from the workspace
   * root. A context created on demand for a document outside the
   * workspace is recreated by `host.afterRebuild` when that document is
   * still open. */
  private async rebuild(): Promise<void> {
    if (this.workspaceRoot === undefined) return;
    this.armStartupGate();
    try {
      for (const ctx of this.contexts.values()) {
        ctx.dispose();
        ctx.clearPublishedDiagnostics();
      }
      this.contexts.clear();
      this.ownerCache.clear();
      this.walkUpCache.clear();
      this.primaryRoot = undefined;
      await this.initInner(this.workspaceRoot);
      await this.indexAllInner();
    } finally {
      this.finishStartup();
    }
  }

  /** Nearest known root of `filePath`'s directory, cached per directory. */
  private ownerRoot(filePath: string): string | undefined {
    const dir = dirname(filePath);
    if (this.ownerCache.has(dir)) return this.ownerCache.get(dir);
    const owner = nearestRoot(dir, this.contexts.keys());
    this.ownerCache.set(dir, owner);
    return owner;
  }

  private async createAndLoad(root: string): Promise<ProjectContext> {
    const ctx = this.host.createContext(root);
    await ctx.load();
    // A shutdown that arrived during the load must not leave a live
    // context behind: a disposed one never publishes.
    if (this.shuttingDown) ctx.dispose();
    this.contexts.set(root, ctx);
    this.ownerCache.clear();
    return ctx;
  }

  /**
   * The lane task behind {@linkcode ensureContextFor} for a document
   * outside every known root. Re-resolves against the current root set
   * first: a concurrent call for the same document, or a rebuild queued
   * ahead of this task, may already have created the context, and a
   * second one for the same root would orphan the first.
   *
   * While it creates or extends a tree, the startup gate is armed: the
   * new root is in the map before its nested roots are discovered, and a
   * document under one of those nested roots must not take the fast path
   * to the anchor in the meantime. Returns `undefined` after shutdown.
   */
  private async createFor(
    filePath: string,
  ): Promise<ProjectContext | undefined> {
    if (this.shuttingDown) return undefined;
    const dir = dirname(filePath);
    const owner = this.ownerRoot(filePath);
    if (owner !== undefined) return this.contexts.get(owner)!;

    let found: string | undefined;
    if (this.walkUpCache.has(dir)) {
      found = this.walkUpCache.get(dir);
    } else {
      found = await resolveConfigRoot(dir, this.host.readFile);
      this.walkUpCache.set(dir, found);
    }
    if (found === undefined && this.primary) return this.primary;

    const armed = this.armStartupGate();
    try {
      if (found !== undefined) {
        const anchor = this.contexts.get(found) ??
          await this.createAndLoad(found);
        await this.addTree(anchor);
        return this.shuttingDown ? undefined : anchor;
      }
      // No workspace root and no config above the document: create a
      // fallback primary at the document's directory. Its tree is not
      // walked — only opened documents are indexed, as before #840.
      const ctx = await this.createAndLoad(dir);
      ctx.indexed = true;
      this.primaryRoot = dir;
      return this.shuttingDown ? undefined : ctx;
    } finally {
      if (armed) this.finishStartup();
    }
  }

  /**
   * Make sure `anchor` and every project nested below it have a loaded
   * and indexed context. Indexing starts only after every root is known,
   * so file ownership is final when the walks run.
   */
  private async addTree(anchor: ProjectContext): Promise<void> {
    if (this.shuttingDown) return;
    const knownBefore = new Set(this.contexts.keys());
    for (const nested of await this.findNestedRoots(anchor)) {
      if (this.contexts.has(nested)) continue;
      // A nested root that already lies under another known project is
      // that project's business, not this tree's.
      const owner = nearestRoot(nested, knownBefore);
      if (owner !== undefined && owner !== anchor.root) continue;
      await this.createAndLoad(nested);
    }
    // Defence in depth: a file that reached an index before its nested
    // root was known now belongs to that nested root. Evict it from the
    // context that no longer owns it, so no file is indexed twice. Only
    // files under the tree just walked can have changed owner; a file
    // outside every root (owned by the primary through the fallback) is
    // left alone.
    const evicted: string[] = [];
    for (const ctx of this.contexts.values()) {
      evicted.push(
        ...ctx.evictForeignFiles((path) =>
          !isWithin(anchor.root, path) ||
          (this.ownerRoot(path) ?? this.primaryRoot) === ctx.root
        ),
      );
    }
    for (const ctx of [...this.contexts.values()]) {
      if (this.shuttingDown) return;
      if (ctx.indexed) continue;
      await ctx.indexProject(
        (path) => this.ownerRoot(path) === ctx.root,
        this.host.openText,
      );
      ctx.publishAllDiagnostics();
    }
    // An evicted file that is open in the editor but not on disk (never
    // saved) is invisible to the new owner's walk; hand it over from the
    // buffer so it does not go dark until the next keystroke.
    const republish = new Set<ProjectContext>();
    for (const path of evicted) {
      const text = this.host.openText(path);
      const owner = this.contextFor(path);
      if (text === undefined || !owner || this.shuttingDown) continue;
      if (owner.index.getFilePaths().includes(path)) continue;
      await owner.index.parseAndUpdateFile(path, text);
      republish.add(owner);
    }
    for (const owner of republish) owner.publishAllDiagnostics();
  }

  /**
   * Directories strictly below `ctx.root` that a document walk-up would
   * resolve to, found with the gitignore-aware project walk (honouring
   * the context's `exclude:` list). Each discovered `project.yaml` or
   * `.markspec.yaml` is resolved with {@linkcode resolveConfigRoot} from
   * its own directory, so a `.markspec.yaml` below a `project.yaml` is not
   * a root of its own — the same answer the CLI gives for a file there.
   * A found root is also dropped when the `exclude:` list of another found
   * root between `ctx.root` and it covers it (patterns relative to that
   * intermediate project); see {@linkcode findNestedProjectRoots}.
   */
  private async findNestedRoots(ctx: ProjectContext): Promise<string[]> {
    return await findNestedProjectRoots(
      ctx.root,
      {
        readDir: (p: string) => this.host.readDir(p),
        readFile: this.host.readFile,
      },
      ctx.toolConfig.exclude,
    );
  }
}
