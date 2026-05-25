/**
 * @module core/sync/log
 *
 * Append-only NDJSON sync log. Pure encode/decode here; the actual
 * file I/O happens in the CLI command (with `O_APPEND` for atomic
 * append) so this module stays runtime-agnostic.
 */

/** One entry in `.markspec/sync/<system>/log.ndjson`. */
export interface SyncLogEntry {
  /** RFC 3339 UTC. */
  readonly ts: string;
  readonly op: "push" | "pull" | "conflict" | "resolve";
  readonly entryId: string;
  readonly displayId: string;
  readonly externalId: string;
  readonly direction: "outbound" | "inbound" | "bidirectional";
  readonly attrsChanged: readonly string[];
  readonly remoteStateBefore: string;
  readonly remoteStateAfter: string;
  readonly hashBefore?: string;
  readonly hashAfter?: string;
  readonly actor: string;
}

/**
 * Encode an entry as one NDJSON line (single JSON object + trailing
 * newline). Rejects entries whose string fields contain embedded
 * newlines — NDJSON's framing relies on `\n` being a record separator,
 * so an embedded newline would silently split one record across two
 * lines and break every downstream reader.
 */
export function encodeLogLine(e: SyncLogEntry): string {
  for (const v of stringValues(e)) {
    if (v.includes("\n")) {
      throw new Error(`Sync log: field contains embedded newline: ${v}`);
    }
  }
  return JSON.stringify(e) + "\n";
}

/** Parse one NDJSON line (without trailing newline) → SyncLogEntry. */
export function parseLogLine(line: string): SyncLogEntry {
  return JSON.parse(line) as SyncLogEntry;
}

/**
 * Yield every string field that appears in the encoded JSON, so the
 * embedded-newline guard can scrub the full payload (not just a
 * hand-maintained subset that drifts as `SyncLogEntry` grows).
 */
function* stringValues(e: SyncLogEntry): Generator<string> {
  yield e.ts;
  yield e.op;
  yield e.entryId;
  yield e.displayId;
  yield e.externalId;
  yield e.direction;
  yield e.remoteStateBefore;
  yield e.remoteStateAfter;
  yield e.actor;
  if (e.hashBefore !== undefined) yield e.hashBefore;
  if (e.hashAfter !== undefined) yield e.hashAfter;
  for (const a of e.attrsChanged) yield a;
}
