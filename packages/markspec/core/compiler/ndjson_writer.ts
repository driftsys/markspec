/**
 * @module compiler/ndjson_writer
 *
 * NDJSON stream builders for the streaming compile output format.
 *
 * Three pure, Deno-free functions — callers perform the actual file I/O:
 *   - {@linkcode buildEntriesNdjson}: entries sorted by displayId
 *   - {@linkcode buildEdgesNdjson}: generated-only links
 *   - {@linkcode indexToJson}: compact byte-offset index JSON
 */

import type { DisplayId, Entry, Link } from "../model/mod.ts";
import { serializeEntry } from "./schema.ts";

/** Byte-offset record for a single entry within `entries.ndjson`. */
export interface EntryOffset {
  readonly offset: number;
  readonly length: number;
}

/**
 * Result of {@linkcode buildEntriesNdjson}.
 *
 * `ndjson` is a UTF-8 byte array: one JSON object per line sorted
 * lexicographically by `displayId`. `index` maps each display ID to its
 * byte position within `ndjson`.
 */
export interface EntriesNdjsonResult {
  readonly ndjson: Uint8Array;
  readonly index: ReadonlyMap<DisplayId, EntryOffset>;
}

const enc = new TextEncoder();

/**
 * Build the `entries.ndjson` byte stream and byte-offset index.
 *
 * Entries are sorted by `displayId` before serialization so that the output
 * is deterministic regardless of `Map` insertion order. Each line is a
 * compact JSON-serialized entry terminated by `\n`. Byte offsets use
 * UTF-8 byte counting, not JavaScript `.length`.
 */
export function buildEntriesNdjson(
  entries: ReadonlyMap<DisplayId, Entry>,
): EntriesNdjsonResult {
  const sorted = [...entries.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );

  const chunks: Uint8Array[] = [];
  const index = new Map<DisplayId, EntryOffset>();
  let offset = 0;

  for (const [displayId, entry] of sorted) {
    const line = JSON.stringify(serializeEntry(entry)) + "\n";
    const bytes = enc.encode(line);
    chunks.push(bytes);
    index.set(displayId, { offset, length: bytes.length });
    offset += bytes.length;
  }

  return { ndjson: concat(chunks), index };
}

/**
 * Convert a byte-offset index to compact single-line JSON with
 * lexicographically sorted keys — suitable for `entries.idx`.
 */
export function indexToJson(
  index: ReadonlyMap<DisplayId, EntryOffset>,
): string {
  const sorted = [...index.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return JSON.stringify(Object.fromEntries(sorted));
}

/**
 * Build the `edges.ndjson` byte stream.
 *
 * Only links with `origin === "generated"` are written. Each line is a
 * compact JSON object with `from`, `to`, and `kind` only — `origin` and
 * `location` are derivable and not persisted.
 */
export function buildEdgesNdjson(links: readonly Link[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const link of links) {
    if (link.origin !== "generated") continue;
    const record = { from: link.from, to: link.to, kind: link.kind };
    chunks.push(enc.encode(JSON.stringify(record) + "\n"));
  }
  return concat(chunks);
}

/** Concatenate a list of Uint8Array chunks into one. */
function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}
