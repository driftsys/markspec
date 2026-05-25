/**
 * @module bench/adapter
 *
 * Abstract index interface — the bench layer talks to this, not to a specific
 * SQLite driver. Lets us swap implementations (jsr:@db/sqlite3 native FFI vs
 * jsr:@db/sqlite pure WASM vs node:sqlite) to validate the driver choice as
 * part of the eval, without rewriting the bench code.
 */

import type {
  SyntheticEdge,
  SyntheticEntry,
  SyntheticGlossary,
} from "../corpus/generator.ts";

export interface PragmaSet {
  readonly journalMode: "wal" | "delete" | "memory";
  readonly synchronous: "off" | "normal" | "full";
  readonly cacheSizeKb: number;
  readonly mmapSizeMb: number;
  readonly tempStore: "default" | "file" | "memory";
}

export const DEFAULT_PRAGMAS: PragmaSet = {
  journalMode: "wal",
  synchronous: "normal",
  cacheSizeKb: 64_000,
  mmapSizeMb: 256,
  tempStore: "memory",
};

export interface IndexAdapter {
  /** Open the index at `path`, apply pragmas, run schema migration. */
  open(path: string, pragmas: PragmaSet): Promise<void>;

  /** Insert N entries in one transaction. The cold-scan hot path. */
  bulkInsertEntries(entries: readonly SyntheticEntry[]): Promise<void>;

  /** Insert N edges in one transaction. */
  bulkInsertEdges(edges: readonly SyntheticEdge[]): Promise<void>;

  /** Insert N glossary items in one transaction. */
  bulkInsertGlossary(items: readonly SyntheticGlossary[]): Promise<void>;

  // ---- Hot-path queries (§6 budgets <5 ms) ----

  /** Lookup by canonical Id (ULID/URI). Primary-key point lookup. */
  getEntryById(id: string): Promise<SyntheticEntry | undefined>;

  /** Lookup by displayId. Secondary B-tree index. */
  getEntryByDisplayId(displayId: string): Promise<SyntheticEntry | undefined>;

  /** Prefix-completion: every entry whose displayId starts with prefix. */
  getEntriesByDisplayIdPrefix(prefix: string): Promise<SyntheticEntry[]>;

  /** Glossary cross-check: resolve a slug to its Definition entry. */
  getGlossaryBySlug(slug: string): Promise<SyntheticGlossary | undefined>;

  // ---- Warm incremental ----

  /** Replace one entry's row + dependent edge rows in a single tx. */
  updateEntry(
    entry: SyntheticEntry,
    edges: readonly SyntheticEdge[],
  ): Promise<void>;

  /** Walk reverse-edge index for the §5.2 closure. */
  reverseEdgeClosure(targetId: string, cap: number): Promise<string[]>;

  // ---- Schema versioning (§7) ----

  /** Read the schema_version row. `undefined` if no row exists. */
  getSchemaVersion(): Promise<number | undefined>;

  // ---- Lifecycle ----

  close(): Promise<void>;
}

/**
 * Factory the bench code uses to obtain an adapter. Lets the orchestrator
 * pick the driver via env var without touching call sites. Default is
 * the jsr:@db/sqlite3 native-FFI binding; alternative drivers can be wired
 * here without touching any bench code.
 */
export async function createAdapter(
  driver: string = "sqlite3",
): Promise<IndexAdapter> {
  if (driver === "sqlite3") {
    const { SqliteAdapter } = await import("./sqlite_adapter.ts");
    return new SqliteAdapter();
  }
  throw new Error(`createAdapter: unknown driver '${driver}'`);
}
