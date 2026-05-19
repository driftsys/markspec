/**
 * @module lsp/workspace
 *
 * WorkspaceIndex — in-memory index of all MarkSpec entries in the project.
 * Supports incremental file-level updates and provides lookup queries for
 * diagnostics, completions, and future go-to-definition.
 */

import type { Diagnostic, DisplayId, Entry } from "../core/mod.ts";
import { parseFile, validate } from "../core/mod.ts";

/** A display ID paired with its entry title, for completion items. */
export interface DisplayIdEntry {
  readonly displayId: DisplayId;
  readonly title: string;
}

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

  /** Return all display IDs with their titles — for completion lists. */
  getAllDisplayIds(): DisplayIdEntry[] {
    const result: DisplayIdEntry[] = [];
    for (const [displayId, entry] of this.byDisplayId) {
      result.push({ displayId, title: entry.title });
    }
    return result;
  }

  /**
   * Compute the next sequential number for a display-ID prefix.
   *
   * Scans all display IDs that start with `prefix`, extracts the trailing
   * numeric segment, and returns max + 1. Returns 1 if no matching IDs
   * exist.
   *
   * @param prefix - The prefix including the trailing separator,
   *   e.g., `"STK_AEB_"` for IDs like `STK_AEB_0001`.
   */
  getNextDisplayIdNumber(prefix: string): number {
    let max = 0;
    for (const id of this.byDisplayId.keys()) {
      if (id.startsWith(prefix)) {
        const suffix = id.slice(prefix.length);
        const num = parseInt(suffix, 10);
        if (!isNaN(num) && num > max) {
          max = num;
        }
      }
    }
    return max + 1;
  }

  /** Return all tracked file paths. */
  getFilePaths(): string[] {
    return [...this.fileEntries.keys()];
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
   */
  validateAll(): readonly Diagnostic[] {
    const allEntries = this.getAllEntries();
    const result = validate(allEntries);
    return result.diagnostics;
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
