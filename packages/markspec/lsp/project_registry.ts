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
 *   root to the nearest `.markspec.yaml`, else the nearest
 *   `project.yaml`, else the workspace root itself (#694);
 * - every directory BELOW the primary root that holds a `.markspec.yaml`
 *   (gitignore-aware discovery), so a workspace that is a parent folder
 *   of several projects validates each one against its own profile
 *   (#840);
 * - a root found on demand by walking up from a document that lies
 *   outside every known root (see {@linkcode ProjectRegistry.ensureContextFor}).
 *
 * Each file belongs to exactly one context: a parent context's file walk
 * skips the subtrees of nested projects, so no file is indexed twice.
 * A document outside every known root, with no config above it, falls
 * back to the primary context.
 *
 * A `.markspec.yaml` that sits in a gitignored or hidden directory below
 * a known root is not discovered; documents there belong to the
 * enclosing known root.
 */

import { basename, dirname, isAbsolute, relative, SEPARATOR } from "@std/path";
import {
  discoverFiles,
  discoverMarkspecRoot,
  discoverProjectRoot,
  type DiscoveryDirEntry,
} from "../core/mod.ts";
import type { ProjectContext } from "./project_context.ts";
import { isLockfileOnlyChange } from "./watched_files.ts";

/** The activator file name that marks a directory as a MarkSpec root. */
const MARKSPEC_YAML = ".markspec.yaml";

/** LSP `FileChangeType` values. */
const FILE_CREATED = 1;
const FILE_DELETED = 3;

/** `true` when `path` is `root` itself or lies below it. */
export function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  // A child directory may itself start with `..` (e.g. `..cache`), so
  // compare whole path segments, not a string prefix.
  return rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${SEPARATOR}`) && !isAbsolute(rel));
}

/**
 * Return the deepest root in `roots` that is `dir` itself or an ancestor
 * of `dir`, or `undefined` when none is.
 */
export function nearestRoot(
  dir: string,
  roots: Iterable<string>,
): string | undefined {
  let best: string | undefined;
  for (const root of roots) {
    if (!isWithin(root, dir)) continue;
    if (best === undefined || root.length > best.length) best = root;
  }
  return best;
}

/**
 * Walk up from `startDir` to the nearest `.markspec.yaml`, else the
 * nearest `project.yaml`. Returns `undefined` when neither exists.
 */
export async function resolveConfigRoot(
  startDir: string,
  readFile: (path: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  return await discoverMarkspecRoot(startDir, readFile) ??
    await discoverProjectRoot(startDir, readFile);
}

/** I/O and callbacks the registry needs from the server. */
export interface ProjectRegistryHost {
  /** Read a file; resolves `undefined` when it does not exist. */
  readFile(path: string): Promise<string | undefined>;
  /** List a directory (nested `.markspec.yaml` discovery). */
  readDir(path: string): AsyncIterable<DiscoveryDirEntry>;
  /** Construct an unloaded context for `root`. */
  createContext(root: string): ProjectContext;
  /** Called after the registry was rebuilt because a `.markspec.yaml` was
   * created or deleted. */
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
  /** In-flight {@linkcode addTree} calls, so two documents from the same
   * new project do not create it twice. */
  private readonly pendingTrees = new Map<string, Promise<ProjectContext>>();
  /** Contexts whose indexing has started, so two overlapping
   * {@linkcode addTree} calls never index the same context twice. */
  private readonly indexingStarted = new Set<ProjectContext>();
  /** Set when a `.markspec.yaml` was created or deleted since the last
   * watched-file reload: file ownership may have changed. */
  private rebuildPending = false;
  /** Serializes watched-file reloads (#797 review): the debounce fires
   * and forgets, so a second window expiring while a reload is still in
   * flight would otherwise interleave the seeders' shared-set mutations
   * (`seedDeliveredCorpus`'s clear pass is safe only because
   * `seedUpstreamCorpus` runs immediately after it — an invariant a
   * concurrent run breaks). Run-next-after-current closes the class,
   * including a reload that overlaps a registry rebuild. */
  private watchedReloadChain: Promise<void> = Promise.resolve();
  /** Resolves when the startup discovery and indexing started by
   * {@linkcode init} has finished ({@linkcode indexAll}). Until then the
   * nested projects are not known yet, and a document routed early would
   * land in the wrong index. */
  private startup: Promise<void> = Promise.resolve();
  private finishStartup: () => void = () => {};
  /** Set by {@linkcode shutdown} so a chain link queued behind an
   * in-flight reload never starts after the final event-log flush. */
  private shuttingDown = false;

  constructor(host: ProjectRegistryHost) {
    this.host = host;
  }

  // -------------------------------------------------------------------------
  // Startup
  // -------------------------------------------------------------------------

  /**
   * Create and load the primary context for `workspaceRoot`. The primary
   * root is the nearest `.markspec.yaml` at or above the workspace root,
   * else the nearest `project.yaml`, else the workspace root itself.
   * Does not index files; call {@linkcode indexAll} for that.
   */
  async init(workspaceRoot: string): Promise<ProjectContext> {
    this.startup = new Promise((done) => this.finishStartup = done);
    this.workspaceRoot = workspaceRoot;
    const root = await resolveConfigRoot(workspaceRoot, this.host.readFile) ??
      workspaceRoot;
    this.primaryRoot = root;
    return await this.createAndLoad(root);
  }

  /**
   * Discover the projects nested below the primary root, load them, and
   * index every context that has not been indexed yet. Publishes
   * diagnostics for each newly indexed context.
   */
  async indexAll(): Promise<void> {
    try {
      if (this.primaryRoot !== undefined) await this.addTree(this.primaryRoot);
    } finally {
      this.finishStartup();
    }
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
   * Like {@linkcode contextFor}, but waits for startup indexing to finish,
   * and a document outside every known root
   * walks up to its own `.markspec.yaml` (else `project.yaml`). When one
   * is found, a context is created, loaded and indexed for that root
   * before this resolves. When none is found the document falls back to
   * the primary context; when there is no primary context either (the
   * client sent no workspace root), a context rooted at the document's
   * directory is created without indexing its tree.
   */
  async ensureContextFor(
    filePath: string,
  ): Promise<ProjectContext | undefined> {
    await this.startup;
    for (const ctx of this.contexts.values()) {
      if (ctx.isCorpusFile(filePath)) return ctx;
    }
    const owner = this.ownerRoot(filePath);
    if (owner !== undefined) return this.contexts.get(owner);

    const dir = dirname(filePath);
    let found: string | undefined;
    if (this.walkUpCache.has(dir)) {
      found = this.walkUpCache.get(dir);
    } else {
      found = await resolveConfigRoot(dir, this.host.readFile);
      this.walkUpCache.set(dir, found);
    }
    if (found !== undefined) return await this.addTree(found);
    if (this.primary) return this.primary;

    // No workspace root and no config above the document: create a
    // fallback primary at the document's directory. Its tree is not
    // walked — only opened documents are indexed, as before #840.
    const ctx = await this.createAndLoad(dir);
    ctx.indexed = true;
    this.primaryRoot = dir;
    return ctx;
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
   * Record a batch of watched-file changes. Creating or deleting a
   * `.markspec.yaml` changes file ownership and schedules a full rebuild.
   * Any other change (`.markspec.yaml` edited, `project.yaml`,
   * `markspec.lock`) marks only the context that owns the changed file —
   * the context whose root is the file's directory when there is one.
   *
   * @returns `true` when there is a reload to run.
   */
  noteWatchedChanges(changes: readonly WatchedFileChange[]): boolean {
    const urisByContext = new Map<ProjectContext, string[]>();
    for (const change of changes) {
      if (
        basename(change.path) === MARKSPEC_YAML &&
        (change.type === FILE_CREATED || change.type === FILE_DELETED)
      ) {
        this.rebuildPending = true;
        continue;
      }
      const ctx = this.contextFor(change.path);
      if (!ctx) continue;
      const uris = urisByContext.get(ctx) ?? [];
      uris.push(change.uri);
      urisByContext.set(ctx, uris);
    }
    // A context whose batch holds only `markspec.lock` changes takes the
    // cheap upstream re-seed path (#771).
    for (const [ctx, uris] of urisByContext) {
      ctx.markWatchedChange(isLockfileOnlyChange(uris));
    }
    return this.rebuildPending || urisByContext.size > 0;
  }

  /**
   * Queue the reload for the changes recorded by
   * {@linkcode noteWatchedChanges} behind any reload already in flight.
   * Errors are reported through `host.onReloadError` and never reject
   * the returned promise.
   */
  enqueueWatchedReload(): Promise<void> {
    this.watchedReloadChain = this.watchedReloadChain
      .then(() => this.runWatchedReload())
      .catch((err) => this.host.onReloadError(err));
    return this.watchedReloadChain;
  }

  /** Stop all future reloads and cancel scheduled validations. */
  shutdown(): void {
    this.shuttingDown = true;
    for (const ctx of this.contexts.values()) ctx.dispose();
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async runWatchedReload(): Promise<void> {
    // A queued chain link can start after shutdown ran (cancelling the
    // debounce only clears the un-fired timer, not an already-appended
    // link) — bail instead of writing to the log or a dead connection
    // (#799 review).
    if (this.shuttingDown) return;
    if (this.rebuildPending) {
      this.rebuildPending = false;
      await this.rebuild();
      return;
    }
    for (const ctx of this.all()) {
      if (ctx.hasPendingWatchedChange()) await ctx.reloadWatchedFiles();
    }
  }

  /** Discard every context and discover them again from the workspace
   * root. Used when a `.markspec.yaml` is created or deleted. */
  private async rebuild(): Promise<void> {
    for (const ctx of this.contexts.values()) {
      ctx.dispose();
      ctx.clearPublishedDiagnostics();
    }
    this.contexts.clear();
    this.indexingStarted.clear();
    this.ownerCache.clear();
    this.walkUpCache.clear();
    this.primaryRoot = undefined;
    if (this.workspaceRoot !== undefined) {
      await this.init(this.workspaceRoot);
      await this.indexAll();
    }
    await this.host.afterRebuild();
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
    this.contexts.set(root, ctx);
    this.ownerCache.clear();
    return ctx;
  }

  /**
   * Make sure `root` and every project nested below it have a loaded and
   * indexed context. Deduplicates concurrent calls for the same root.
   */
  private addTree(root: string): Promise<ProjectContext> {
    const existing = this.contexts.get(root);
    if (existing?.indexed) return Promise.resolve(existing);
    const pending = this.pendingTrees.get(root);
    if (pending) return pending;
    const work = this.doAddTree(root).finally(() =>
      this.pendingTrees.delete(root)
    );
    this.pendingTrees.set(root, work);
    return work;
  }

  private async doAddTree(root: string): Promise<ProjectContext> {
    const knownBefore = new Set(this.contexts.keys());
    const anchor = this.contexts.get(root) ?? await this.createAndLoad(root);

    for (const nested of await this.findNestedRoots(anchor)) {
      if (this.contexts.has(nested)) continue;
      // A nested root that already lies under another known project is
      // that project's business, not this tree's.
      const owner = nearestRoot(nested, knownBefore);
      if (owner !== undefined && owner !== root) continue;
      await this.createAndLoad(nested);
    }

    // Index only after every root is known, so ownership is final.
    for (const ctx of [...this.contexts.values()]) {
      if (ctx.indexed || this.indexingStarted.has(ctx)) continue;
      this.indexingStarted.add(ctx);
      await ctx.indexProject((path) => this.ownerRoot(path) === ctx.root);
      ctx.publishAllDiagnostics();
    }
    return anchor;
  }

  /** Directories strictly below `ctx.root` that hold a `.markspec.yaml`,
   * found with the gitignore-aware project walk. */
  private async findNestedRoots(ctx: ProjectContext): Promise<string[]> {
    const io = {
      readDir: (p: string) => this.host.readDir(p),
      readFile: this.host.readFile,
    };
    const out: string[] = [];
    for await (
      const path of discoverFiles(ctx.root, io, {
        extensions: new Set([".yaml"]),
        exclude: ctx.toolConfig.exclude,
      })
    ) {
      if (basename(path) !== MARKSPEC_YAML) continue;
      const dir = dirname(path);
      if (dir !== ctx.root) out.push(dir);
    }
    return out;
  }
}
