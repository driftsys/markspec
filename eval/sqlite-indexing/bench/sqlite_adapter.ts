/**
 * @module bench/sqlite_adapter
 *
 * `IndexAdapter` implementation backed by `jsr:@db/sqlite3` (native FFI
 * bindings via better-sqlite3-compatible C library). Default driver for
 * the Phase 1 eval; alternative drivers can be added behind the same
 * interface and switched via `createAdapter("…")`.
 *
 * Schema is intentionally minimal — one table per logical entity from
 * the spec §3.1 plus a `schema_meta` row for §7 versioning. Indices
 * cover only the hot-path queries the eval measures.
 */

import { Database } from "jsr:@db/sqlite@^0.13.0";
import type { IndexAdapter, PragmaSet } from "./adapter.ts";
import type {
  SyntheticEdge,
  SyntheticEntry,
  SyntheticGlossary,
} from "../corpus/generator.ts";

/** Internal db schema version. Mismatch ⇒ rebuild per spec §7. */
const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS entries (
    id            TEXT PRIMARY KEY,
    display_id    TEXT NOT NULL,
    type          TEXT NOT NULL,
    shape         TEXT NOT NULL,
    title         TEXT NOT NULL,
    file          TEXT NOT NULL,
    line          INTEGER NOT NULL,
    content_hash  TEXT NOT NULL,
    body          TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_entries_display_id ON entries(display_id);

  CREATE TABLE IF NOT EXISTS edges (
    from_id   TEXT NOT NULL,
    kind      TEXT NOT NULL,
    to_id     TEXT NOT NULL,
    generated INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_edges_from_id ON edges(from_id);
  CREATE INDEX IF NOT EXISTS idx_edges_to_id   ON edges(to_id);

  CREATE TABLE IF NOT EXISTS glossary (
    slug TEXT PRIMARY KEY,
    term TEXT NOT NULL,
    file TEXT NOT NULL
  );
`;

export class SqliteAdapter implements IndexAdapter {
  private db: Database | undefined;
  private path: string | undefined;

  open(path: string, pragmas: PragmaSet): Promise<void> {
    this.path = path;
    this.db = new Database(path);
    this.applyPragmas(pragmas);
    this.db.exec(SCHEMA_SQL);
    this.db.exec(
      "INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('schema_version', ?1)",
      String(SCHEMA_VERSION),
    );
    return Promise.resolve();
  }

  private applyPragmas(p: PragmaSet): void {
    if (!this.db) throw new Error("adapter not opened");
    this.db.exec(`PRAGMA journal_mode = ${p.journalMode}`);
    this.db.exec(`PRAGMA synchronous = ${p.synchronous}`);
    this.db.exec(`PRAGMA cache_size = -${p.cacheSizeKb}`); // negative = KB
    this.db.exec(`PRAGMA mmap_size = ${p.mmapSizeMb * 1024 * 1024}`);
    this.db.exec(`PRAGMA temp_store = ${p.tempStore}`);
  }

  bulkInsertEntries(entries: readonly SyntheticEntry[]): Promise<void> {
    const db = this.requireDb();
    const stmt = db.prepare(
      "INSERT INTO entries(id, display_id, type, shape, title, file, line, content_hash, body) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    );
    const run = db.transaction((rows: readonly SyntheticEntry[]) => {
      for (const e of rows) {
        stmt.run(
          e.id,
          e.displayId,
          e.type,
          e.shape,
          e.title,
          e.file,
          e.line,
          e.contentHash,
          e.body,
        );
      }
    });
    run(entries);
    return Promise.resolve();
  }

  bulkInsertEdges(edges: readonly SyntheticEdge[]): Promise<void> {
    const db = this.requireDb();
    const stmt = db.prepare(
      "INSERT INTO edges(from_id, kind, to_id, generated) VALUES (?1, ?2, ?3, ?4)",
    );
    const run = db.transaction((rows: readonly SyntheticEdge[]) => {
      for (const e of rows) {
        stmt.run(e.from, e.kind, e.to, e.generated ? 1 : 0);
      }
    });
    run(edges);
    return Promise.resolve();
  }

  bulkInsertGlossary(items: readonly SyntheticGlossary[]): Promise<void> {
    const db = this.requireDb();
    const stmt = db.prepare(
      "INSERT INTO glossary(slug, term, file) VALUES (?1, ?2, ?3)",
    );
    const run = db.transaction((rows: readonly SyntheticGlossary[]) => {
      for (const g of rows) stmt.run(g.slug, g.term, g.file);
    });
    run(items);
    return Promise.resolve();
  }

  getEntryById(id: string): Promise<SyntheticEntry | undefined> {
    const db = this.requireDb();
    const row = db.prepare("SELECT * FROM entries WHERE id = ?1").get<{
      id: string;
      display_id: string;
      type: string;
      shape: string;
      title: string;
      file: string;
      line: number;
      content_hash: string;
      body: string;
    }>(id);
    return Promise.resolve(row ? rowToEntry(row) : undefined);
  }

  getEntryByDisplayId(displayId: string): Promise<SyntheticEntry | undefined> {
    const db = this.requireDb();
    const row = db.prepare("SELECT * FROM entries WHERE display_id = ?1").get<{
      id: string;
      display_id: string;
      type: string;
      shape: string;
      title: string;
      file: string;
      line: number;
      content_hash: string;
      body: string;
    }>(displayId);
    return Promise.resolve(row ? rowToEntry(row) : undefined);
  }

  getEntriesByDisplayIdPrefix(prefix: string): Promise<SyntheticEntry[]> {
    const db = this.requireDb();
    const rows = db
      .prepare("SELECT * FROM entries WHERE display_id LIKE ?1 LIMIT 100")
      .all<{
        id: string;
        display_id: string;
        type: string;
        shape: string;
        title: string;
        file: string;
        line: number;
        content_hash: string;
        body: string;
      }>(`${prefix}%`);
    return Promise.resolve(rows.map(rowToEntry));
  }

  getGlossaryBySlug(slug: string): Promise<SyntheticGlossary | undefined> {
    const db = this.requireDb();
    const row = db
      .prepare("SELECT slug, term, file FROM glossary WHERE slug = ?1")
      .get<{ slug: string; term: string; file: string }>(slug);
    return Promise.resolve(row);
  }

  updateEntry(
    entry: SyntheticEntry,
    edges: readonly SyntheticEdge[],
  ): Promise<void> {
    const db = this.requireDb();
    const updateEntry = db.prepare(
      "UPDATE entries SET display_id = ?2, type = ?3, shape = ?4, title = ?5, " +
        "file = ?6, line = ?7, content_hash = ?8, body = ?9 WHERE id = ?1",
    );
    const deleteEdges = db.prepare("DELETE FROM edges WHERE from_id = ?1");
    const insertEdge = db.prepare(
      "INSERT INTO edges(from_id, kind, to_id, generated) VALUES (?1, ?2, ?3, ?4)",
    );
    const run = db.transaction(() => {
      updateEntry.run(
        entry.id,
        entry.displayId,
        entry.type,
        entry.shape,
        entry.title,
        entry.file,
        entry.line,
        entry.contentHash,
        entry.body,
      );
      deleteEdges.run(entry.id);
      for (const e of edges) {
        insertEdge.run(e.from, e.kind, e.to, e.generated ? 1 : 0);
      }
    });
    run();
    return Promise.resolve();
  }

  reverseEdgeClosure(targetId: string, cap: number): Promise<string[]> {
    const db = this.requireDb();
    const rows = db
      .prepare("SELECT from_id FROM edges WHERE to_id = ?1 LIMIT ?2")
      .all<{ from_id: string }>(targetId, cap);
    return Promise.resolve(rows.map((r) => r.from_id));
  }

  close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
    return Promise.resolve();
  }

  /** Direct access for benches that need to checkpoint, vacuum, or stat files. */
  raw(): Database {
    return this.requireDb();
  }

  path_(): string {
    if (!this.path) throw new Error("adapter not opened");
    return this.path;
  }

  private requireDb(): Database {
    if (!this.db) throw new Error("adapter not opened");
    return this.db;
  }
}

type EntryRow = {
  id: string;
  display_id: string;
  type: string;
  shape: string;
  title: string;
  file: string;
  line: number;
  content_hash: string;
  body: string;
};

function rowToEntry(row: EntryRow): SyntheticEntry {
  return {
    id: row.id,
    displayId: row.display_id,
    type: row.type,
    shape: row.shape as SyntheticEntry["shape"],
    title: row.title,
    file: row.file,
    line: row.line,
    contentHash: row.content_hash,
    body: row.body,
  };
}
