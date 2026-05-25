/**
 * @module bench/node_sqlite_adapter
 *
 * `IndexAdapter` implementation backed by `node:sqlite` — Node.js 22+'s
 * experimental built-in SQLite module, available in Deno via Node-compat.
 *
 * No external dependency; the binding ships with the runtime. Whether it
 * works at all is itself part of the eval question — `node:sqlite` is
 * experimental upstream, and Deno's Node-compat layer may or may not
 * expose it cleanly. If `open()` throws, the bench records the failure
 * and the driver-alternatives table reflects "unavailable".
 */

import { DatabaseSync } from "node:sqlite";
import type { IndexAdapter, PragmaSet } from "./adapter.ts";
import type {
  SyntheticEdge,
  SyntheticEntry,
  SyntheticGlossary,
} from "../corpus/generator.ts";

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

interface EntryRow {
  id: string;
  display_id: string;
  type: string;
  shape: string;
  title: string;
  file: string;
  line: number;
  content_hash: string;
  body: string;
}

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

export class NodeSqliteAdapter implements IndexAdapter {
  private db: DatabaseSync | undefined;

  open(path: string, pragmas: PragmaSet): Promise<void> {
    this.db = new DatabaseSync(path);
    this.applyPragmas(pragmas);
    this.db.exec(SCHEMA_SQL);
    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO schema_meta(key, value) VALUES (?, ?)",
    );
    stmt.run("schema_version", String(SCHEMA_VERSION));
    return Promise.resolve();
  }

  getSchemaVersion(): Promise<number | undefined> {
    const db = this.requireDb();
    const row = db
      .prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    if (!row) return Promise.resolve(undefined);
    const parsed = Number(row.value);
    return Promise.resolve(Number.isFinite(parsed) ? parsed : undefined);
  }

  private applyPragmas(p: PragmaSet): void {
    const db = this.requireDb();
    db.exec(`PRAGMA journal_mode = ${p.journalMode}`);
    db.exec(`PRAGMA synchronous = ${p.synchronous}`);
    db.exec(`PRAGMA cache_size = -${p.cacheSizeKb}`);
    db.exec(`PRAGMA mmap_size = ${p.mmapSizeMb * 1024 * 1024}`);
    db.exec(`PRAGMA temp_store = ${p.tempStore}`);
    db.exec(`PRAGMA busy_timeout = 5000`);
  }

  bulkInsertEntries(entries: readonly SyntheticEntry[]): Promise<void> {
    const db = this.requireDb();
    const stmt = db.prepare(
      "INSERT INTO entries(id, display_id, type, shape, title, file, line, content_hash, body) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    db.exec("BEGIN");
    try {
      for (const e of entries) {
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
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return Promise.resolve();
  }

  bulkInsertEdges(edges: readonly SyntheticEdge[]): Promise<void> {
    const db = this.requireDb();
    const stmt = db.prepare(
      "INSERT INTO edges(from_id, kind, to_id, generated) VALUES (?, ?, ?, ?)",
    );
    db.exec("BEGIN");
    try {
      for (const e of edges) {
        stmt.run(e.from, e.kind, e.to, e.generated ? 1 : 0);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return Promise.resolve();
  }

  bulkInsertGlossary(items: readonly SyntheticGlossary[]): Promise<void> {
    const db = this.requireDb();
    const stmt = db.prepare(
      "INSERT INTO glossary(slug, term, file) VALUES (?, ?, ?)",
    );
    db.exec("BEGIN");
    try {
      for (const g of items) stmt.run(g.slug, g.term, g.file);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return Promise.resolve();
  }

  getEntryById(id: string): Promise<SyntheticEntry | undefined> {
    const db = this.requireDb();
    const row = db
      .prepare("SELECT * FROM entries WHERE id = ?")
      .get(id) as EntryRow | undefined;
    return Promise.resolve(row ? rowToEntry(row) : undefined);
  }

  getEntryByDisplayId(displayId: string): Promise<SyntheticEntry | undefined> {
    const db = this.requireDb();
    const row = db
      .prepare("SELECT * FROM entries WHERE display_id = ?")
      .get(displayId) as EntryRow | undefined;
    return Promise.resolve(row ? rowToEntry(row) : undefined);
  }

  getEntriesByDisplayIdPrefix(prefix: string): Promise<SyntheticEntry[]> {
    const db = this.requireDb();
    const rows = db
      .prepare("SELECT * FROM entries WHERE display_id LIKE ? LIMIT 100")
      .all(`${prefix}%`) as unknown as EntryRow[];
    return Promise.resolve(rows.map(rowToEntry));
  }

  getGlossaryBySlug(slug: string): Promise<SyntheticGlossary | undefined> {
    const db = this.requireDb();
    const row = db
      .prepare("SELECT slug, term, file FROM glossary WHERE slug = ?")
      .get(slug) as SyntheticGlossary | undefined;
    return Promise.resolve(row);
  }

  updateEntry(
    entry: SyntheticEntry,
    edges: readonly SyntheticEdge[],
  ): Promise<void> {
    const db = this.requireDb();
    const updateStmt = db.prepare(
      "UPDATE entries SET display_id = ?, type = ?, shape = ?, title = ?, " +
        "file = ?, line = ?, content_hash = ?, body = ? WHERE id = ?",
    );
    const deleteStmt = db.prepare("DELETE FROM edges WHERE from_id = ?");
    const insertStmt = db.prepare(
      "INSERT INTO edges(from_id, kind, to_id, generated) VALUES (?, ?, ?, ?)",
    );
    db.exec("BEGIN");
    try {
      updateStmt.run(
        entry.displayId,
        entry.type,
        entry.shape,
        entry.title,
        entry.file,
        entry.line,
        entry.contentHash,
        entry.body,
        entry.id,
      );
      deleteStmt.run(entry.id);
      for (const e of edges) {
        insertStmt.run(e.from, e.kind, e.to, e.generated ? 1 : 0);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return Promise.resolve();
  }

  reverseEdgeClosure(targetId: string, cap: number): Promise<string[]> {
    const db = this.requireDb();
    const rows = db
      .prepare("SELECT from_id FROM edges WHERE to_id = ? LIMIT ?")
      .all(targetId, cap) as unknown as Array<{ from_id: string }>;
    return Promise.resolve(rows.map((r) => r.from_id));
  }

  close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
    return Promise.resolve();
  }

  private requireDb(): DatabaseSync {
    if (!this.db) throw new Error("adapter not opened");
    return this.db;
  }
}
