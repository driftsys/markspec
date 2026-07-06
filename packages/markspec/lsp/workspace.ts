/**
 * @module lsp/workspace
 *
 * WorkspaceIndex — in-memory index of all MarkSpec entries in the project.
 * Supports incremental file-level updates and provides lookup queries for
 * diagnostics, completions, and future go-to-definition.
 */

import type {
  Diagnostic,
  DisplayId,
  EffectiveProfile,
  Entry,
} from "../core/mod.ts";
import {
  attributeCorpusDiagnostics,
  classifyEntry,
  detectCorpusCollisions,
  emittableEntries,
  formatEntryOrigin,
  parseFile,
  suppressDeclaredAttrR010,
  uxilDeclaringTypes,
  validate,
  validateUxilFamily,
} from "../core/mod.ts";
import { buildTypeRegistry, type TypeRegistry } from "../core/typl/mod.ts";
import { buildUxRegistry, type UxRegistry } from "../core/uxil/mod.ts";

/** A display ID paired with its entry title, for completion items. */
export interface DisplayIdEntry {
  readonly displayId: DisplayId;
  readonly title: string;
  /** `"<profileId>@<version>"` when the entry is delivered corpus (ADR-030). */
  readonly origin?: string;
}

/** Shared empty reserved-number set — the default for callers that do
 * not participate in display-ID reservation. Never mutated. */
const NO_RESERVATIONS: ReadonlySet<number> = new Set<number>();

/**
 * In-memory index of all parsed entries, keyed by file path.
 *
 * Maintains both per-file storage (for incremental updates) and a global
 * display-ID lookup index updated incrementally on every mutation. Updating
 * a single file touches only that file's entries in the global index —
 * O(old + new) rather than O(all entries) — so LSP responsiveness is
 * maintained on large projects.
 */
export class WorkspaceIndex {
  /** Per-file entry storage. Key is the file path. */
  private fileEntries = new Map<string, Entry[]>();

  /** Global lookup by display ID. Rebuilt on mutation. */
  private byDisplayId = new Map<DisplayId, Entry>();

  // -----------------------------------------------------------------------
  // Mutation
  // -----------------------------------------------------------------------

  /**
   * Replace all entries for a file and update global indexes incrementally.
   *
   * Call this after re-parsing a file. Pass an empty array to clear a
   * file's entries without removing it from tracking.
   *
   * Instead of rebuilding the entire `byDisplayId` map (O(all entries)),
   * this removes only the old entries for `filePath` and inserts the new
   * ones — O(old + new) rather than O(total).
   */
  updateFile(filePath: string, entries: Entry[]): void {
    // Remove old entries for this file from the global index.
    const oldEntries = this.fileEntries.get(filePath);
    if (oldEntries) {
      for (const entry of oldEntries) {
        // Only remove if this file is still the authoritative source for
        // this display ID (first-entry-wins invariant: another file may
        // have claimed the same ID while this file's entries were stale).
        if (this.byDisplayId.get(entry.displayId)?.location.file === filePath) {
          this.byDisplayId.delete(entry.displayId);
          // Promote a survivor from another file so duplicate-ID entries
          // declared in other files remain reachable after this file loses
          // ownership. Without promotion, removing STK_001 from file A
          // would leave byDisplayId with no entry for STK_001 even though
          // file B still declares it.
          for (const [otherPath, otherEntries] of this.fileEntries) {
            if (otherPath === filePath) continue;
            const survivor = otherEntries.find(
              (e) => e.displayId === entry.displayId,
            );
            if (survivor) {
              this.byDisplayId.set(entry.displayId, survivor);
              break; // first-entry-wins; stop after first match
            }
          }
        }
      }
    }

    // Store the new entries.
    this.fileEntries.set(filePath, entries);

    // Add new entries — first entry wins for duplicate display IDs.
    for (const entry of entries) {
      if (!this.byDisplayId.has(entry.displayId)) {
        this.byDisplayId.set(entry.displayId, entry);
      }
    }
  }

  /** Remove a file and its entries from the index entirely. */
  removeFile(filePath: string): void {
    const oldEntries = this.fileEntries.get(filePath);
    this.fileEntries.delete(filePath);
    if (!oldEntries) return;

    // Incrementally remove deleted entries from the global index.
    // fileEntries no longer contains filePath at this point (deleted above),
    // so the survivor scan correctly skips the removed file.
    for (const entry of oldEntries) {
      if (this.byDisplayId.get(entry.displayId)?.location.file === filePath) {
        this.byDisplayId.delete(entry.displayId);
        // Promote a survivor from another file so duplicate-ID entries
        // declared in other files remain reachable after this file is closed.
        for (const [, otherEntries] of this.fileEntries) {
          const survivor = otherEntries.find(
            (e) => e.displayId === entry.displayId,
          );
          if (survivor) {
            this.byDisplayId.set(entry.displayId, survivor);
            break; // first-entry-wins; stop after first match
          }
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /** Return a flat array of all entries across all files. */
  getAllEntries(): Entry[] {
    const all: Entry[] = [];
    for (const entries of this.fileEntries.values()) {
      all.push(...entries);
    }
    return all;
  }

  /** Return entries for a specific file, or an empty array. */
  getEntriesForFile(filePath: string): Entry[] {
    return this.fileEntries.get(filePath) ?? [];
  }

  /** Lookup a single entry by display ID. */
  getEntryByDisplayId(displayId: DisplayId): Entry | undefined {
    return this.byDisplayId.get(displayId);
  }

  /** Return all entries whose display ID starts with the given prefix. */
  getDisplayIdsByPrefix(prefix: string): Entry[] {
    const result: Entry[] = [];
    for (const [id, entry] of this.byDisplayId) {
      if (id.startsWith(prefix)) {
        result.push(entry);
      }
    }
    return result;
  }

  /** Return all display IDs with their titles — for completion lists.
   * Delivered-corpus entries (ADR-030) carry an `origin` badge. */
  getAllDisplayIds(): DisplayIdEntry[] {
    const result: DisplayIdEntry[] = [];
    for (const [displayId, entry] of this.byDisplayId) {
      result.push({
        displayId,
        title: entry.title,
        origin: entry.origin ? formatEntryOrigin(entry.origin) : undefined,
      });
    }
    return result;
  }

  /**
   * Compute the next sequential number for a display-ID pattern,
   * filtering by `prefix` and (when present) `suffix`. Scans all
   * display IDs matching both, extracts the numeric segment between
   * them, and returns max + 1. Returns 1 when no matching ID exists.
   *
   * @param prefix - Literal text before the numeric placeholder,
   *   e.g., `"STK_AEB_"` for IDs like `STK_AEB_0001`.
   * @param suffix - Optional literal text after the numeric
   *   placeholder, e.g., `"-draft"` for IDs like `REQ-012-draft`.
   *   Defaults to empty.
   * @param reserved - Numbers handed out by the scaffold-completion
   *   resolve handler but not yet observed in the index. Folded into the
   *   maximum so two rapid accepts inside the parse-debounce window do not
   *   both mint the same ID. Defaults to empty for callers that don't
   *   participate in reservation (e.g. the build-time scaffold path). The
   *   caller is responsible for passing a set scoped to this
   *   `(prefix, suffix)`; entries are not re-filtered here.
   */
  getNextDisplayIdNumber(
    prefix: string,
    suffix = "",
    reserved: ReadonlySet<number> = NO_RESERVATIONS,
  ): number {
    let max = 0;
    for (const id of this.byDisplayId.keys()) {
      if (!id.startsWith(prefix)) continue;
      if (suffix && !id.endsWith(suffix)) continue;
      const numberPart = id.slice(prefix.length, id.length - suffix.length);
      const num = parseInt(numberPart, 10);
      if (!isNaN(num) && num > max) max = num;
    }
    for (const n of reserved) {
      if (n > max) max = n;
    }
    return max + 1;
  }

  /** Return all tracked file paths. */
  getFilePaths(): string[] {
    return [...this.fileEntries.keys()];
  }

  /**
   * Build the corpus type registry from all currently-indexed entries.
   *
   * Rebuilt on every call — no stale-cache bugs. For large projects with
   * frequent edits this is fast enough because `getAllEntries()` is O(n)
   * and the registry scan is O(bindings). A cached + invalidated variant
   * can be added later when profiling shows it necessary.
   */
  getTypeRegistry(): TypeRegistry {
    return buildTypeRegistry(this.getAllEntries());
  }

  /**
   * Build the uxil corpus registry (S8 #726), gated on
   * `uxilDeclaringTypes(profile)` — returns `undefined` when no profile
   * type designates `declares: ux-surface`, preserving the diagnostics
   * family's Tier-1 opacity guarantee for hover/completion/go-to-
   * declaration (S10 #728). Mirrors `uxil_family.ts`'s own gating:
   * upstream entries excluded via `emittableEntries`, then filtered to
   * declaring-type entries via `entry.type ?? classifyEntry(...).type`
   * (the LSP path never runs pipeline Stage 2, so entries typically
   * arrive unclassified). Rebuilt on every call — no caching, matching
   * `getTypeRegistry()`'s precedent.
   */
  getUxRegistry(profile: EffectiveProfile | null): UxRegistry | undefined {
    const declaring = uxilDeclaringTypes(profile);
    if (declaring.size === 0) return undefined;
    const local = emittableEntries(this.getAllEntries());
    const declaringEntries = local.filter((e) => {
      const type = e.type ?? classifyEntry(e, profile!).type;
      return type !== undefined && declaring.has(type);
    });
    return buildUxRegistry(declaringEntries);
  }

  // -----------------------------------------------------------------------
  // Index parse + validate helpers
  // -----------------------------------------------------------------------

  /**
   * Parse a file's content and update the index.
   * Returns parse-level diagnostics for the file.
   */
  async parseAndUpdateFile(
    filePath: string,
    content: string,
  ): Promise<readonly Diagnostic[]> {
    const result = await parseFile(content, { file: filePath });
    this.updateFile(filePath, result.entries);
    return result.diagnostics;
  }

  /**
   * Run cross-file validation on all indexed entries.
   * Returns the full set of validation diagnostics.
   *
   * When `profile` is supplied, core-only MSL-R010 "unknown attribute"
   * warnings are suppressed for attributes the profile declares — matching
   * the `validate` command so the editor doesn't flood with false positives.
   *
   * Corpus-aware post-pass (ADR-030), mirroring `check`/`compile`: a
   * project entry re-declaring a display ID or Id already delivered by
   * the corpus becomes MSL-R014 instead of the generic MSL-R005/R006/
   * I007/I008 duplicate codes, whose message would otherwise embed the
   * corpus entry's raw `.markspec/cache/…` location (#674 finding 3).
   * `detectCorpusCollisions`/`attributeCorpusDiagnostics` no-op when no
   * corpus was seeded. Diagnostics located in a corpus file (including
   * the corpus↔corpus branch of MSL-R014) are still filtered out at
   * publish time by the server's `corpusFilePaths` guard.
   *
   * Also runs the uxil diagnostics family (S9 #727) — inert unless the
   * profile designates a declaring type (`declares: ux-surface`).
   */
  validateAll(profile: EffectiveProfile | null = null): readonly Diagnostic[] {
    const allEntries = this.getAllEntries();
    const result = validate(allEntries);
    const suppressed = suppressDeclaredAttrR010(
      result.diagnostics,
      allEntries,
      profile,
    );
    const collisions = detectCorpusCollisions(allEntries);
    return [
      ...attributeCorpusDiagnostics(
        suppressed,
        allEntries,
        collisions.collidedTokens,
      ),
      ...collisions.diagnostics,
      // uxil diagnostics family (S9 #727) — profile-gated; inert without a
      // `declares: ux-surface` designation, so non-uxil projects pay only
      // a Map scan per validateAll.
      ...validateUxilFamily(allEntries, profile),
    ];
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Rebuild all global indexes from per-file storage.
   *
   * Not called from `updateFile` or `removeFile` — those use the
   * incremental path. Retained for potential future use (e.g., a
   * full reindex after a bulk rename).
   */
  private rebuildGlobalIndexes(): void {
    this.byDisplayId.clear();
    for (const entries of this.fileEntries.values()) {
      for (const entry of entries) {
        // First entry wins for duplicate display IDs — validator catches dupes
        if (!this.byDisplayId.has(entry.displayId)) {
          this.byDisplayId.set(entry.displayId, entry);
        }
      }
    }
  }
}
