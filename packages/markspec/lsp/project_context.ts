/**
 * @module lsp/project_context
 *
 * Per-project state for the LSP server (#840, #694).
 *
 * One {@linkcode ProjectContext} exists for each config root — a
 * directory that holds a `.markspec.yaml` (or, as a fallback, a
 * `project.yaml`, or the editor's workspace root when neither exists).
 * The context owns everything that used to be module-level state in
 * `server.ts`: the loaded `project.yaml` and `.markspec.yaml` tool
 * config, the effective profile, the `markspec.lock`, the workspace
 * index, the delivered and upstream corpus bookkeeping, the cached
 * cross-file diagnostics, and the watched-file reload state.
 *
 * All I/O and all connection-facing calls go through an injected
 * {@linkcode ProjectContextHost}, so the class is unit-testable without
 * a live LSP connection.
 */

import {
  DEFAULT_PROJECT_CONFIG,
  DEFAULT_TOOL_CONFIG,
  type Diagnostic as CoreDiagnostic,
  discoverFiles,
  type DiscoveryDirEntry,
  type EffectiveProfile,
  type Entry,
  loadConfig,
  loadDeliveredCorpus,
  loadProfileForCommand,
  loadProjectUpstreams,
  loadToolConfig,
  type Lockfile,
  parseDisplayIdPattern,
  parseLockfile,
  type ProjectConfig,
  type ToolConfig,
  validateDisplayIdPattern,
} from "../core/mod.ts";
import { extendsTransitively } from "../core/profile/discipline_mode.ts";
import { WorkspaceIndex } from "./workspace.ts";
import {
  groupDiagnosticsByFile,
  type LspDiagnostic,
  toLspDiagnostic,
} from "./diagnostics.ts";
import { buildDiagnosticsHistogram } from "./diagnostics_histogram.ts";
import {
  buildProfileResponse,
  EMPTY_PROFILE_RESPONSE,
  type MarkspecProfileChangedParams,
  type MarkspecProfileResponse,
} from "./profile_request.ts";
import type { EntryTypeInfo } from "./completions.ts";
import { release } from "./id_reservations.ts";
import { debounce, type DebouncedFunction, pathToUri } from "./util.ts";
import type { EventFields, Level } from "./event_log.ts";
import { time, timeAsync } from "./timing.ts";

/**
 * Cap on the number of distinct MSL codes the `kind=diagnostics`
 * histogram surfaces by name. Anything past the cap is summed into a
 * synthetic `other` field — see {@linkcode buildDiagnosticsHistogram}.
 * 20 keeps the event-log line under a couple hundred bytes even when
 * the project fires every catalogue rule.
 */
const DIAGNOSTICS_HISTOGRAM_TOP_N = 20;

/** Number of files read and parsed at the same time during indexing. */
const INDEX_CONCURRENCY = 8;

/**
 * I/O and connection surface a {@linkcode ProjectContext} needs. The
 * server supplies Deno and `vscode-languageserver` implementations;
 * unit tests supply in-memory fakes.
 */
export interface ProjectContextHost {
  /** Read a file; resolves `undefined` when it does not exist. */
  readFile(path: string): Promise<string | undefined>;
  /** Resolve symbolic links (delivered-corpus loader). */
  realPath(path: string): Promise<string>;
  /** List a directory (project file discovery). */
  readDir(path: string): AsyncIterable<DiscoveryDirEntry>;
  /** Publish diagnostics for one document URI. */
  sendDiagnostics(uri: string, diagnostics: LspDiagnostic[]): void;
  /** Send a server-to-client notification. */
  sendNotification(method: string, params: unknown): void;
  /** Ask the client to re-request code lenses and inlay hints. */
  refreshLenses(): void;
  /** Write an informational line to the client's output channel. */
  log(message: string): void;
  /** Write a warning line to the client's output channel. */
  warn(message: string): void;
  /** Append an event to the LSP event log. */
  logEvent(level: Level, kind: string, fields: EventFields): void;
}

/**
 * The state and behaviour of one MarkSpec project inside the LSP server.
 */
export class ProjectContext {
  /** Absolute path of the config root this context represents. */
  readonly root: string;
  /** `project.yaml` org-schema fields. */
  config: ProjectConfig = DEFAULT_PROJECT_CONFIG;
  /** Markspec tool config (`exclude`, `caption-conventions`) from
   * `.markspec.yaml` — distinct from `config`, which holds
   * `project.yaml`'s org-schema fields. */
  toolConfig: ToolConfig = DEFAULT_TOOL_CONFIG;
  /** The effective profile, or `undefined` when none is loaded. */
  profile: EffectiveProfile | undefined;
  /** Cached `markspec/profile` response for this project. */
  profileResponse: MarkspecProfileResponse = EMPTY_PROFILE_RESPONSE;
  /** The loaded `markspec.lock`, or `undefined` when there is none. The
   * LSP never writes the lockfile; drift detection stays in the CLI. */
  lockfile: Lockfile | undefined;
  /** In-memory entry index for the files this project owns. */
  readonly index = new WorkspaceIndex();
  /** Cached cross-file validation result. Updated by
   * {@linkcode publishAllDiagnostics} and read by request handlers (e.g.
   * `markspec/entryRanges`) so they don't re-run `validateAll()` on every
   * keystroke. */
  lastDiagnostics: readonly CoreDiagnostic[] = [];
  /** `true` once {@linkcode indexProject} has run. */
  indexed = false;
  /** `true` once {@linkcode dispose} has run. A disposed context was
   * replaced by a registry rebuild; it must never send diagnostics or
   * notifications again, or it would overwrite the new contexts' results
   * with the old profile and ownership. */
  private disposed = false;

  /** Absolute paths of delivered-corpus (ADR-030) and locked-upstream
   * (federated-upstream slice 4) files currently seeded into the index.
   * Diagnostics for these files are never published and the files are
   * re-seeded, not watched. Shared by {@linkcode seedDeliveredCorpus} and
   * {@linkcode seedUpstreamCorpus} so every existing read-only guard
   * (diagnostics publish, buffer edit/open/close, rename, format) covers
   * both origins without change; each seeder also tracks its own files in
   * a private set (`upstreamFilePaths` for the latter) so one seeder's
   * clear pass never drops the other's entries — see
   * {@linkcode seedUpstreamCorpus}'s doc comment for why that matters. */
  private readonly corpusFilePaths = new Set<string>();

  /** Absolute paths of locked-upstream corpus files currently seeded into
   * the index (federated-upstream slice 4). Tracked separately from the
   * shared `corpusFilePaths` guard set so `seedUpstreamCorpus`'s own clear
   * pass never removes delivered-corpus (ADR-030) files that happen to
   * share the set — each file is still added to `corpusFilePaths` too, so
   * the existing read-only guards cover upstream files for free. */
  private readonly upstreamFilePaths = new Set<string>();

  /** `true` when a profile-affecting file (`.markspec.yaml`,
   * `project.yaml`) changed since the last watched-files reload ran.
   * Accumulates across the debounce window so a lock-only change
   * followed by a profile change escalates to the full reload. */
  private pendingProfileFileChange = false;
  /** `true` when any watched file of this project changed since the last
   * watched-files reload ran. */
  private pendingWatchedChange = false;

  private readonly host: ProjectContextHost;
  /** Debounced cross-file validation (1000ms). */
  private readonly debouncedValidateAll: DebouncedFunction<() => void>;

  constructor(root: string, host: ProjectContextHost) {
    this.root = root;
    this.host = host;
    this.debouncedValidateAll = debounce(
      () => this.publishAllDiagnostics(),
      1000,
    );
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * Load `project.yaml`, the `.markspec.yaml` tool config, the profile,
   * and `markspec.lock` for this root. Every step soft-fails: a missing
   * or malformed file leaves the default value and logs a warning.
   */
  async load(): Promise<void> {
    const { host } = this;
    try {
      const configResult = await loadConfig(this.root, host.readFile);
      if (configResult) this.config = configResult.config;
    } catch {
      host.warn("Failed to load project.yaml");
    }

    // loadToolConfig never throws — a malformed file just yields
    // DEFAULT_TOOL_CONFIG plus diagnostics, which are logged here.
    try {
      const toolConfigResult = await loadToolConfig(this.root, host.readFile);
      this.toolConfig = toolConfigResult.config;
      for (const diag of toolConfigResult.diagnostics) {
        if (diag.severity === "error") {
          host.warn(`${diag.code}: ${diag.message}`);
        }
      }
    } catch {
      host.warn("Failed to load .markspec.yaml tool config");
    }

    try {
      const profileResult = await loadProfileForCommand(
        this.root,
        host.readFile,
      );
      if (profileResult.chain) this.profile = profileResult.chain.effective;
      this.profileResponse = buildProfileResponse(
        profileResult.chain,
        this.profile,
      );
    } catch {
      host.warn("Failed to load profile");
    }

    // markspec.lock feeds the locked upstream corpus (federated-upstream
    // slice 4) via seedUpstreamCorpus(), plus the `markspec/version`
    // notification's stale-pin hints.
    await this.reloadLockfile();
  }

  /**
   * (Re-)load `markspec.lock` from disk. A missing file sets `lockfile`
   * to `undefined` — including on reload, so a deleted lockfile drops the
   * upstream corpus on the next {@linkcode seedUpstreamCorpus} call. A
   * malformed lockfile logs its parse diagnostics and leaves `lockfile`
   * at its previous value.
   */
  async reloadLockfile(): Promise<void> {
    try {
      const lockRaw = await this.host.readFile(`${this.root}/markspec.lock`);
      if (lockRaw === undefined) {
        this.lockfile = undefined;
        return;
      }
      const parsed = parseLockfile(lockRaw);
      if (parsed.lockfile) {
        this.lockfile = parsed.lockfile;
        this.host.log(
          `Loaded markspec.lock: ${this.lockfile.upstreams.length} upstreams, locked at ${this.lockfile.meta.lockedAt}`,
        );
      } else {
        for (const d of parsed.diagnostics) {
          this.host.warn(`Lockfile parse: ${d.code}: ${d.message}`);
        }
      }
    } catch {
      /* no lockfile is fine */
    }
  }

  // -------------------------------------------------------------------------
  // Corpus seeding
  // -------------------------------------------------------------------------

  /** `true` when `path` is a delivered-corpus or upstream-corpus file
   * seeded into this project's index. Such files are read-only. */
  isCorpusFile(path: string): boolean {
    return this.corpusFilePaths.has(path);
  }

  /**
   * (Re-)seed the index with the active profile's delivered corpus
   * (ADR-030). Removes any previously-seeded corpus files first so a
   * profile reload that drops or changes `delivers:` doesn't leave stale
   * corpus entries behind, then loads the current `profile.delivers` list
   * and indexes each corpus file under its own file path — entries carry
   * `Entry.origin` from {@linkcode loadDeliveredCorpus}, which
   * {@linkcode publishAllDiagnostics} and the rename handlers use to treat
   * corpus files/entries as read-only. Called before the project file walk
   * in {@linkcode indexProject} (so corpus display IDs win "first entry
   * wins" collisions deterministically) and again in
   * {@linkcode reloadProfile} after `profile` is reassigned.
   */
  async seedDeliveredCorpus(): Promise<void> {
    // Always drop the old corpus first — even if the reload below fails,
    // stale entries from a previous profile must not linger in the index.
    for (const path of this.corpusFilePaths) this.index.removeFile(path);
    this.corpusFilePaths.clear();
    const delivers = this.profile?.delivers ?? [];
    if (delivers.length === 0) return;
    try {
      const corpus = await loadDeliveredCorpus(
        delivers,
        this.host.readFile,
        (p) => this.host.realPath(p),
      );
      for (const d of corpus.diagnostics) {
        this.host.warn(`${d.code}: ${d.message}`);
      }
      for (const [file, entries] of groupEntriesByFile(corpus.entries)) {
        this.index.updateFile(file, entries);
        this.corpusFilePaths.add(file);
      }
    } catch (err) {
      // Cold-cache soft-fail (design spec §4): the index proceeds without
      // corpus rather than aborting initialization or profile reload.
      this.host.warn(`Failed to load delivered corpus: ${err}`);
    }
  }

  /**
   * (Re-)seed the index with the locked upstream corpus
   * (federated-upstream slice 4; see ADR-031,
   * docs/architecture/adr-031-federated-upstream-resolution.md).
   * Mirrors {@linkcode seedDeliveredCorpus}: always drops the previously
   * seeded upstream files first (so a re-lock that drops or replaces an
   * upstream doesn't leave stale entries behind), then hydrates the loaded
   * `markspec.lock`'s snapshot-carrying upstream rows via the shared core
   * {@linkcode loadProjectUpstreams} (#771) — the same loader the CLI
   * compiler, `check`, and the MCP server use. Entries carry
   * `Entry.origin = { kind: "upstream", ... }`; adding their file to the
   * shared `corpusFilePaths` set makes every existing read-only guard
   * (diagnostics publish, buffer edit/open/close, rename, format) treat
   * them as read-only, same as delivered corpus.
   *
   * Called after `seedDeliveredCorpus()` at both call sites
   * ({@linkcode indexProject}, {@linkcode reloadProfile}) so upstream
   * entries lose "first entry wins" ties to delivered corpus but still win
   * over the project walk that follows.
   *
   * Clear/re-seed interaction with `seedDeliveredCorpus` (the subtle
   * part): `seedDeliveredCorpus` clears by iterating the *shared*
   * `corpusFilePaths` set, so its clear pass also calls
   * `index.removeFile` on any upstream file already tracked there —
   * transiently dropping upstream entries from the index. That is safe
   * only because `seedUpstreamCorpus` always runs immediately afterward
   * at both call sites and re-adds them. `seedUpstreamCorpus` itself
   * clears via its *own* `upstreamFilePaths` set, never the shared one,
   * so the reverse never happens: re-seeding upstream (e.g. on a
   * `markspec.lock`-only change) cannot remove delivered-corpus entries.
   */
  async seedUpstreamCorpus(): Promise<void> {
    // Always drop the previously-seeded upstream files first — even if
    // the reload below fails or the lockfile now declares no upstreams,
    // stale entries from a previous lockfile must not linger in the index.
    for (const path of this.upstreamFilePaths) {
      this.index.removeFile(path);
      this.corpusFilePaths.delete(path);
    }
    this.upstreamFilePaths.clear();
    try {
      const corpus = await loadProjectUpstreams(
        this.root,
        this.lockfile,
        this.host.readFile,
      );
      for (const d of corpus.diagnostics) {
        this.host.warn(`${d.code}: ${d.message}`);
      }
      for (const [file, entries] of groupEntriesByFile(corpus.entries)) {
        this.index.updateFile(file, entries);
        this.upstreamFilePaths.add(file);
        this.corpusFilePaths.add(file);
      }
    } catch (err) {
      // Cold-cache soft-fail, mirroring seedDeliveredCorpus: the index
      // proceeds without the upstream corpus rather than aborting
      // initialization or a profile/lockfile reload.
      this.host.warn(`Failed to load upstream corpus: ${err}`);
    }
  }

  // -------------------------------------------------------------------------
  // Indexing
  // -------------------------------------------------------------------------

  /**
   * Seed the corpora, then discover and parse every project file this
   * context owns. `owns` decides ownership: a file under a nested
   * project's root belongs to that nested project, so this walk skips it
   * and no file is indexed by two contexts.
   *
   * @returns The number of project files parsed.
   */
  async indexProject(owns: (path: string) => boolean): Promise<number> {
    // Seed the delivered corpus (ADR-030), then the locked upstream
    // corpus (federated-upstream slice 4), before the project walk so
    // corpus/upstream display IDs win "first entry wins" collisions
    // deterministically, regardless of project-file parse order.
    await this.seedDeliveredCorpus();
    await this.seedUpstreamCorpus();

    // Discover all relevant files (core/discovery: gitignore-aware,
    // honors .markspec.yaml `exclude:`).
    const files: string[] = [];
    const io = {
      readDir: (p: string) => this.host.readDir(p),
      readFile: this.host.readFile,
    };
    for await (
      const path of discoverFiles(this.root, io, {
        exclude: this.toolConfig.exclude,
      })
    ) {
      if (owns(path)) files.push(path);
    }

    // Parse all files with bounded concurrency. The serial loop spent
    // most of its wall time waiting on file I/O while CPU was idle —
    // overlapping reads + parses cuts cold-start dramatically. Side
    // effect: when duplicate display IDs exist across files, the
    // "first entry wins" tiebreak now resolves to whichever parse
    // finishes first (previously: alphabetical file order). The
    // validator still flags the duplicate in either case; the
    // diagnostic location is the only thing that becomes
    // nondeterministic.
    await timeAsync("onInitialized/parseAll", async () => {
      let cursor = 0;
      await Promise.all(
        Array.from({ length: INDEX_CONCURRENCY }, async () => {
          while (cursor < files.length) {
            const filePath = files[cursor++];
            const content = await this.host.readFile(filePath);
            if (content === undefined) {
              this.host.warn(`Failed to parse: ${filePath}`);
              continue;
            }
            try {
              await timeAsync(
                "onInitialized/parseFile",
                () => this.index.parseAndUpdateFile(filePath, content),
              );
            } catch {
              this.host.warn(`Failed to parse: ${filePath}`);
            }
          }
        }),
      );
    });
    this.indexed = true;
    return files.length;
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  /** Run cross-file validation and publish diagnostics for all files. */
  publishAllDiagnostics(): void {
    if (this.disposed) return;
    const entryCount = this.index.getAllEntries().length;
    const allDiags = time(
      `validateAll/${entryCount}`,
      () => this.index.validateAll(this.profile ?? null),
    );
    this.lastDiagnostics = allDiags;

    // Emit a per-validateAll histogram of MSL codes that fired. Always
    // emitted (zero diagnostics is a valid analytics signal — "the
    // project validated cleanly"); the zero case carries just the
    // entry count.
    const histogram = buildDiagnosticsHistogram(
      allDiags,
      DIAGNOSTICS_HISTOGRAM_TOP_N,
    );
    this.host.logEvent("info", "diagnostics", {
      entries: entryCount,
      ...histogram,
    });

    const grouped = groupDiagnosticsByFile(allDiags);

    // Send diagnostics for files that have issues. Delivered corpus files
    // (ADR-030) are never published — they are read-only, sourced from a
    // profile, not the author's own work.
    for (const [file, diags] of grouped) {
      if (this.corpusFilePaths.has(file)) continue;
      this.host.sendDiagnostics(pathToUri(file), diags.map(toLspDiagnostic));
    }

    // Clear diagnostics for tracked files with no issues
    for (const file of this.index.getFilePaths()) {
      if (this.corpusFilePaths.has(file)) continue;
      if (!grouped.has(file)) this.host.sendDiagnostics(pathToUri(file), []);
    }

    // Cross-file validation just re-ran, so any already-open document's
    // "↑ N dependents" codeLens / "(N dependents)" inlay hint may now be
    // stale — the client only re-requests textDocument/codeLens|inlayHint
    // on its own document changing, never on a change to a *different*
    // file.
    this.host.refreshLenses();
  }

  /** Schedule {@linkcode publishAllDiagnostics} after 1000ms of quiet. */
  scheduleValidateAll(): void {
    if (this.disposed) return;
    this.debouncedValidateAll();
  }

  /** Run {@linkcode publishAllDiagnostics} now, dropping any scheduled
   * run (used on save). */
  validateAllNow(): void {
    if (this.disposed) return;
    this.debouncedValidateAll.cancel();
    this.publishAllDiagnostics();
  }

  /** Publish empty diagnostics for every non-corpus file this context
   * tracks. Used when the context is discarded, so a file that moves to
   * another context does not keep stale diagnostics. This is the one send
   * still allowed after {@linkcode dispose}: it is the final cleanup. */
  clearPublishedDiagnostics(): void {
    for (const file of this.index.getFilePaths()) {
      if (this.corpusFilePaths.has(file)) continue;
      this.host.sendDiagnostics(pathToUri(file), []);
    }
  }

  /** Cancel the scheduled validation and stop all further diagnostics
   * and notifications from this context. Called on shutdown and when the
   * context is discarded by a registry rebuild. */
  dispose(): void {
    this.disposed = true;
    this.debouncedValidateAll.cancel();
  }

  /** `true` once {@linkcode dispose} has run. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** The `markspec/profileChanged` payload for this project. */
  profileChangedParams(): MarkspecProfileChangedParams {
    return { ...this.profileResponse, root: pathToUri(this.root) };
  }

  // -------------------------------------------------------------------------
  // Watched-file reloads
  // -------------------------------------------------------------------------

  /**
   * Record that a watched file of this project changed. `lockOnly` is
   * `true` for a `markspec.lock` change and `false` for a
   * `.markspec.yaml` or `project.yaml` change. The reload itself runs
   * later, in {@linkcode reloadWatchedFiles}.
   */
  markWatchedChange(lockOnly: boolean): void {
    this.pendingWatchedChange = true;
    if (!lockOnly) this.pendingProfileFileChange = true;
  }

  /** `true` when {@linkcode markWatchedChange} was called since the last
   * {@linkcode reloadWatchedFiles}. */
  hasPendingWatchedChange(): boolean {
    return this.pendingWatchedChange;
  }

  /**
   * Run the reload for the watched-file changes recorded since the last
   * run. A window that saw any profile-file change runs the full
   * {@linkcode reloadProfile} (which also reloads the lockfile and
   * re-seeds both corpora). A `markspec.lock`-only window (#771: a bare
   * `markspec lock` re-run) skips the profile re-resolve, the
   * delivered-corpus re-seed, and the `markspec/profileChanged` push — it
   * refreshes the lockfile, re-seeds the upstream corpus, and republishes
   * diagnostics.
   */
  async reloadWatchedFiles(): Promise<void> {
    if (this.disposed || !this.pendingWatchedChange) return;
    this.pendingWatchedChange = false;
    const profileChanged = this.pendingProfileFileChange;
    this.pendingProfileFileChange = false;
    if (profileChanged) {
      if (!(await this.reloadProfile())) {
        // Keep the escalation pending: the next watched event of ANY kind
        // (including a lock-only one) retries the full reload, restoring
        // the pre-#797 self-healing property.
        this.pendingProfileFileChange = true;
      }
      return;
    }
    await this.reloadLockfile();
    await this.seedUpstreamCorpus();
    this.publishAllDiagnostics();
  }

  /**
   * Re-resolve the profile, push `markspec/profileChanged`, reload the
   * lockfile, re-seed the delivered and upstream corpora, and republish
   * diagnostics.
   *
   * @returns `true` on success; `false` when the reload failed and the
   *   caller should keep the profile-change flag pending so the next
   *   watched event (of any kind) retries the full reload (#797 review:
   *   consuming the flag before a failed reload used to strand the
   *   editor on stale profile state until the next profile-file save).
   */
  async reloadProfile(): Promise<boolean> {
    try {
      const profileResult = await loadProfileForCommand(
        this.root,
        this.host.readFile,
      );
      this.profile = profileResult.chain?.effective;
      this.profileResponse = buildProfileResponse(
        profileResult.chain,
        this.profile,
      );
      if (this.disposed) return true;
      this.host.sendNotification(
        "markspec/profileChanged",
        this.profileChangedParams(),
      );
      // The watched-file change that triggered this reload may be to
      // markspec.lock itself (a re-lock) rather than the profile —
      // refresh the lockfile before re-seeding the upstream corpus.
      await this.reloadLockfile();
      // Re-seed the delivered corpus (ADR-030) before republishing — the
      // new profile may change, add, or drop `delivers:` entirely.
      await this.seedDeliveredCorpus();
      // Re-seed the locked upstream corpus (federated-upstream slice 4)
      // after the delivered corpus — see seedUpstreamCorpus()'s doc
      // comment for why the ordering is load-bearing.
      await this.seedUpstreamCorpus();
      // Profile changes can flip MSL-R010 suppression and other
      // attribute-validity decisions — republish cross-file diagnostics.
      this.publishAllDiagnostics();
      return true;
    } catch (err) {
      this.host.warn(`Failed to reload profile: ${err}`);
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Profile-derived helpers
  // -------------------------------------------------------------------------

  /** Build the {@linkcode EntryTypeInfo} list for scaffold completions
   * from this project's profile. */
  getEntryTypes(): EntryTypeInfo[] {
    const profile = this.profile;
    if (!profile) return [];
    const mode = profile.disciplineMode.value;
    const types: EntryTypeInfo[] = [];
    for (const [name, typeDef] of profile.types) {
      const pattern = typeDef.value.displayIdPattern.value;
      if (!pattern) continue;

      // ADR-017 Slice 5: mark mode-relevant types as recommended. Shared
      // by both the numbered and named branches below.
      const isRequirementShaped = extendsTransitively(
        name,
        "Requirement",
        profile,
      );
      const hasDiscipline = typeDef.value.discipline.value !== undefined;
      const modeRecommended = (mode === "tiered" && hasDiscipline) ||
        (mode === "flat" && isRequirementShaped && !hasDiscipline) ||
        (mode === "none" && isRequirementShaped);

      // Numbered pattern: parse the `{n:Nd}` placeholder. Width and suffix
      // flow through the snippet so profiles using non-4-digit IDs
      // (`{n:6d}`) or a trailing literal don't produce mis-formatted
      // scaffolds.
      const shape = parseDisplayIdPattern(pattern);
      if (shape) {
        const { prefix, width, suffix } = shape;
        const nextNumber = this.index.getNextDisplayIdNumber(prefix, suffix);
        types.push({
          name,
          prefix,
          width,
          suffix,
          nextNumber,
          modeRecommended,
        });
        continue;
      }

      // Named (counter-less) type (ADR-025, #598): not mintable, but still
      // offer a `${1:NAME}` scaffold. The literal anchor is everything
      // before the first placeholder. A malformed pattern is skipped —
      // profile-load (#597) already rejects those via PROFILE-TYPE-008.
      if (!validateDisplayIdPattern(pattern).ok) continue;
      const firstBrace = pattern.indexOf("{");
      const prefix = firstBrace >= 0 ? pattern.slice(0, firstBrace) : pattern;
      types.push({
        name,
        prefix,
        width: 0,
        suffix: "",
        nextNumber: 0,
        named: true,
        modeRecommended,
      });
    }
    return types;
  }

  /**
   * Lean `(prefix, suffix)` pairs for every profile type with a parseable
   * `display-id-pattern`. Unlike {@linkcode getEntryTypes} this skips the
   * per-type `getNextDisplayIdNumber` scan —
   * {@linkcode releaseObservedReservations} only needs the literal affixes
   * to decompose a display ID, and it runs on every debounced parse.
   */
  private getScaffoldPatterns(): Array<{ prefix: string; suffix: string }> {
    if (!this.profile) return [];
    const out: Array<{ prefix: string; suffix: string }> = [];
    for (const [, typeDef] of this.profile.types) {
      const pattern = typeDef.value.displayIdPattern.value;
      if (!pattern) continue;
      const shape = parseDisplayIdPattern(pattern);
      if (!shape) continue;
      out.push({ prefix: shape.prefix, suffix: shape.suffix });
    }
    return out;
  }

  /**
   * Release any display-ID reservation now satisfied by a freshly-parsed
   * file. The resolve handler reserves a number the instant it hands one
   * out; once the inserted entry reaches the index (after the debounced
   * parse) the reservation is redundant and must be dropped so the number
   * is not blocked. Each entry's display ID is decomposed against this
   * project's profile type affixes to recover the `(prefix, suffix,
   * number)` triple. A no-op when no profile is loaded or nothing matches
   * — cheap because reservation buckets are typically empty.
   *
   * Reservations live in the module-global `id_reservations.ts` table,
   * keyed by `(prefix, suffix)` only, not by project. Two projects whose
   * profiles share a prefix therefore share reservations. The effect is
   * at most a skipped number in the other project during the short
   * parse-debounce window, which is acceptable.
   */
  releaseObservedReservations(filePath: string): void {
    const patterns = this.getScaffoldPatterns();
    if (patterns.length === 0) return;
    for (const entry of this.index.getEntriesForFile(filePath)) {
      const id = entry.displayId as string;
      for (const { prefix, suffix } of patterns) {
        if (!id.startsWith(prefix)) continue;
        if (suffix && !id.endsWith(suffix)) continue;
        const numberPart = id.slice(prefix.length, id.length - suffix.length);
        if (!/^\d+$/.test(numberPart)) continue;
        release(prefix, suffix, parseInt(numberPart, 10));
        break; // one pattern matched this entry; move on
      }
    }
  }
}

/** Group entries by `location.file`, preserving order. */
function groupEntriesByFile(entries: readonly Entry[]): Map<string, Entry[]> {
  const byFile = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = byFile.get(e.location.file) ?? [];
    list.push(e);
    byFile.set(e.location.file, list);
  }
  return byFile;
}
