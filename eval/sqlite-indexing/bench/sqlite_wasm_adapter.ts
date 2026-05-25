/**
 * @module bench/sqlite_wasm_adapter
 *
 * `IndexAdapter` implementation backed by the pure-WASM
 * [`deno.land/x/sqlite`](https://deno.land/x/sqlite) library
 * (a.k.a. `dyedgreen/deno-sqlite`). No FFI permission required —
 * runs entirely in the WebAssembly sandbox.
 *
 * Trade-off vs the native-FFI `@db/sqlite` adapter: the WASM library
 * loads the entire database into memory, so it's bounded by available
 * RAM rather than disk; expect noticeably slower cold scans for large
 * corpora. This adapter exists to surface those numbers in ADR-020's
 * driver-comparison table.
 */

import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";
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

export class SqliteWasmAdapter implements IndexAdapter {
  private db: DB | undefined;

  open(path: string, pragmas: PragmaSet): Promise<void> {
    this.db = new DB(path);
    this.applyPragmas(pragmas);
    this.db.execute(SCHEMA_SQL);
    this.db.query(
      "INSERT OR IGNORE INTO schema_meta(key, value) VALUES (?, ?)",
      ["schema_version", String(SCHEMA_VERSION)],
    );
    return Promise.resolve();
  }

  getSchemaVersion(): Promise<number | undefined> {
    const db = this.requireDb();
    const rows = db.queryEntries(
      "SELECT value FROM schema_meta WHERE key = 'schema_version'",
    ) as unknown as Array<{ value: string }>;
    if (rows.length === 0) return Promise.resolve(undefined);
    const parsed = Number(rows[0].value);
    return Promise.resolve(Number.isFinite(parsed) ? parsed : undefined);
  }

  private applyPragmas(p: PragmaSet): void {
    const db = this.requireDb();
    db.execute(`PRAGMA journal_mode = ${p.journalMode}`);
    db.execute(`PRAGMA synchronous = ${p.synchronous}`);
    db.execute(`PRAGMA cache_size = -${p.cacheSizeKb}`);
    db.execute(`PRAGMA mmap_size = ${p.mmapSizeMb * 1024 * 1024}`);
    db.execute(`PRAGMA temp_store = ${p.tempStore}`);
    db.execute(`PRAGMA busy_timeout = 5000`);
  }

  bulkInsertEntries(entries: readonly SyntheticEntry[]): Promise<void> {
    const db = this.requireDb();
    const stmt = db.prepareQuery(
      "INSERT INTO entries(id, display_id, type, shape, title, file, line, content_hash, body) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    try {
      db.transaction(() => {
        for (const e of entries) {
          stmt.execute([
            e.id,
            e.displayId,
            e.type,
            e.shape,
            e.title,
            e.file,
            e.line,
            e.contentHash,
            e.body,
          ]);
        }
      });
    } finally {
      stmt.finalize();
    }
    return Promise.resolve();
  }

  bulkInsertEdges(edges: readonly SyntheticEdge[]): Promise<void> {
    const db = this.requireDb();
    const stmt = db.prepareQuery(
      "INSERT INTO edges(from_id, kind, to_id, generated) VALUES (?, ?, ?, ?)",
    );
    try {
      db.transaction(() => {
        for (const e of edges) {
          stmt.execute([e.from, e.kind, e.to, e.generated ? 1 : 0]);
        }
      });
    } finally {
      stmt.finalize();
    }
    return Promise.resolve();
  }

  bulkInsertGlossary(items: readonly SyntheticGlossary[]): Promise<void> {
    const db = this.requireDb();
    const stmt = db.prepareQuery(
      "INSERT INTO glossary(slug, term, file) VALUES (?, ?, ?)",
    );
    try {
      db.transaction(() => {
        for (const g of items) stmt.execute([g.slug, g.term, g.file]);
      });
    } finally {
      stmt.finalize();
    }
    return Promise.resolve();
  }

  getEntryById(id: string): Promise<SyntheticEntry | undefined> {
    const db = this.requireDb();
    const rows = db.queryEntries(
      "SELECT * FROM entries WHERE id = ?",
      [id],
    );
    return Promise.resolve(rows.length > 0 ? rowToEntry(rows[0]) : undefined);
  }

  getEntryByDisplayId(displayId: string): Promise<SyntheticEntry | undefined> {
    const db = this.requireDb();
    const rows = db.queryEntries(
      "SELECT * FROM entries WHERE display_id = ?",
      [displayId],
    );
    return Promise.resolve(rows.length > 0 ? rowToEntry(rows[0]) : undefined);
  }

  getEntriesByDisplayIdPrefix(prefix: string): Promise<SyntheticEntry[]> {
    const db = this.requireDb();
    const rows = db.queryEntries(
      "SELECT * FROM entries WHERE display_id LIKE ? LIMIT 100",
      [`${prefix}%`],
    );
    return Promise.resolve(rows.map(rowToEntry));
  }

  getGlossaryBySlug(slug: string): Promise<SyntheticGlossary | undefined> {
    const db = this.requireDb();
    const rows = db.queryEntries(
      "SELECT slug, term, file FROM glossary WHERE slug = ?",
      [slug],
    ) as unknown as SyntheticGlossary[];
    return Promise.resolve(rows.length > 0 ? rows[0] : undefined);
  }

  updateEntry(
    entry: SyntheticEntry,
    edges: readonly SyntheticEdge[],
  ): Promise<void> {
    const db = this.requireDb();
    const updateEntry = db.prepareQuery(
      "UPDATE entries SET display_id = ?, type = ?, shape = ?, title = ?, " +
        "file = ?, line = ?, content_hash = ?, body = ? WHERE id = ?",
    );
    const deleteEdges = db.prepareQuery("DELETE FROM edges WHERE from_id = ?");
    const insertEdge = db.prepareQuery(
      "INSERT INTO edges(from_id, kind, to_id, generated) VALUES (?, ?, ?, ?)",
    );
    try {
      db.transaction(() => {
        updateEntry.execute([
          entry.displayId,
          entry.type,
          entry.shape,
          entry.title,
          entry.file,
          entry.line,
          entry.contentHash,
          entry.body,
          entry.id,
        ]);
        deleteEdges.execute([entry.id]);
        for (const e of edges) {
          insertEdge.execute([e.from, e.kind, e.to, e.generated ? 1 : 0]);
        }
      });
    } finally {
      updateEntry.finalize();
      deleteEdges.finalize();
      insertEdge.finalize();
    }
    return Promise.resolve();
  }

  reverseEdgeClosure(targetId: string, cap: number): Promise<string[]> {
    const db = this.requireDb();
    const rows = db.queryEntries(
      "SELECT from_id FROM edges WHERE to_id = ? LIMIT ?",
      [targetId, cap],
    ) as unknown as Array<{ from_id: string }>;
    return Promise.resolve(rows.map((r) => r.from_id));
  }

  close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
    return Promise.resolve();
  }

  private requireDb(): DB {
    if (!this.db) throw new Error("adapter not opened");
    return this.db;
  }
}

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

function rowToEntry(raw: unknown): SyntheticEntry {
  const row = raw as EntryRow;
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
