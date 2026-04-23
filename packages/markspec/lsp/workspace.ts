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
 * Maintains both per-file storage (for incremental updates) and global
 * lookup indexes (rebuilt on every mutation). The index is the single
 * source of truth for the LSP's view of the project.
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
   * Replace all entries for a file and rebuild global indexes.
   *
   * Call this after re-parsing a file. Pass an empty array to clear a
   * file's entries without removing it from tracking.
   */
  updateFile(filePath: string, entries: Entry[]): void {
    this.fileEntries.set(filePath, entries);
    this.rebuildGlobalIndexes();
  }

  /** Remove a file and its entries from the index entirely. */
  removeFile(filePath: string): void {
    this.fileEntries.delete(filePath);
    this.rebuildGlobalIndexes();
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

  /** Rebuild all global indexes from per-file storage. */
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
