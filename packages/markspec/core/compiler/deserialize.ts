/**
 * @module compiler/deserialize
 *
 * Hydration of compiled-JSON snapshots back into core {@linkcode Entry}
 * values — the inverse of `./schema.ts`. Consumed by the upstream corpus
 * loader (`core/upstream/`): a dependency's or reference's published
 * compile output is deserialized here before joining the consumer's graph.
 *
 * Pure module: no I/O, no Deno APIs.
 */

import { CORE_SCHEMA_VERSION } from "../model/mod.ts";
import type { Diagnostic, Entry } from "../model/mod.ts";
import { MANIFEST_SCHEMA_VERSION } from "./manifest.ts";
import type { SerializedEntry } from "./schema.ts";

/**
 * Rebuild an {@linkcode Entry} from its serialized wire form. Inverse of
 * `serializeEntry`: restores `typedAttributes` from a plain record to a
 * `Map` (absent → empty). All other fields — including `origin` — pass
 * through verbatim.
 *
 * `type` and `id` are re-keyed explicitly (rather than left to the
 * `...rest` spread) to restore field-presence parity with a freshly
 * parsed {@linkcode Entry}: the parser always includes both as own
 * properties (`type` is `undefined` when no profile classified the
 * entry; `id` is `undefined` on Reference-shaped entries with no `Id:`
 * trailer), but `JSON.stringify` drops `undefined`-valued keys
 * entirely, so the wire form loses the keys when it round-trips
 * through `JSON.parse`. Without this, `deserializeEntry(wire)` would
 * be missing those keys while the original entry still carries them
 * (with value `undefined`), breaking the deep-equality round-trip
 * contract.
 */
export function deserializeEntry(s: SerializedEntry): Entry {
  const { typedAttributes, type, id, ...rest } = s;
  return {
    ...rest,
    type,
    id,
    typedAttributes: new Map(Object.entries(typedAttributes ?? {})),
  };
}

/** Result of {@linkcode extractSerializedEntries}. */
export interface ExtractedEntries {
  readonly entries: SerializedEntry[];
  readonly diagnostics: Diagnostic[];
}

/**
 * Reject a snapshot whose schema versions don't match this build — a
 * skewed snapshot must never silently misparse. Returns the diagnostic to
 * publish, or `undefined` when the snapshot is compatible.
 */
export function checkSnapshotSchema(
  manifest: unknown,
  manifestPath: string,
): Diagnostic | undefined {
  const m = manifest as {
    markspecSchemaVersion?: unknown;
    generator?: { coreSchema?: unknown };
  };
  if (
    m?.markspecSchemaVersion === MANIFEST_SCHEMA_VERSION &&
    m?.generator?.coreSchema === CORE_SCHEMA_VERSION
  ) {
    return undefined;
  }
  return {
    code: "UPSTREAM-SNAPSHOT-001",
    severity: "error",
    message:
      `upstream snapshot schema mismatch (manifest v${
        String(m?.markspecSchemaVersion)
      }, ` +
      `core-schema ${
        String(m?.generator?.coreSchema)
      } vs expected ${MANIFEST_SCHEMA_VERSION}/${CORE_SCHEMA_VERSION}); ` +
      `re-run 'markspec lock' with a compatible markspec version`,
    location: { file: manifestPath, line: 1, column: 1 },
  };
}

/**
 * Follow the manifest's `entries` block and return the raw serialized
 * entries. `readSnapshotFile` resolves a path relative to the snapshot
 * directory (injected — this module does no I/O).
 */
export function extractSerializedEntries(
  manifest: unknown,
  readSnapshotFile: (relPath: string) => string | undefined,
  manifestPath: string,
): ExtractedEntries {
  const diagnostics: Diagnostic[] = [];
  const block = (manifest as { entries?: { format?: string; file?: string } })
    ?.entries;
  const file = block?.file;
  if (!file || (block?.format !== "inline" && block?.format !== "ndjson")) {
    diagnostics.push(
      malformed(
        manifestPath,
        "manifest entries block missing or unknown format",
      ),
    );
    return { entries: [], diagnostics };
  }
  const raw = readSnapshotFile(file);
  if (raw === undefined) {
    diagnostics.push({
      code: "UPSTREAM-SNAPSHOT-002",
      severity: "error",
      message: `upstream snapshot file '${file}' is missing or unreadable; ` +
        `run 'markspec lock' to restore the cache`,
      location: { file: manifestPath, line: 1, column: 1 },
    });
    return { entries: [], diagnostics };
  }
  try {
    let candidates: unknown[];
    if (block.format === "inline") {
      const json = JSON.parse(raw) as { entries?: Record<string, unknown> };
      candidates = Object.values(json.entries ?? {});
    } else {
      candidates = raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));
    }
    const { valid, rejectedCount } = partitionEntryCandidates(candidates);
    if (rejectedCount > 0) {
      diagnostics.push(malformed(
        manifestPath,
        `snapshot file '${file}' contains ${rejectedCount} non-object ` +
          `entry value(s)`,
      ));
    }
    return { entries: valid, diagnostics };
  } catch (err) {
    diagnostics.push(malformed(
      manifestPath,
      `snapshot file '${file}' is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    ));
    return { entries: [], diagnostics };
  }
}

/**
 * Keep only candidates that are non-null, non-array plain objects — the
 * shape a serialized entry must have. A snapshot line/value that parses
 * as valid JSON but isn't an object (`null`, a bare string, a number, an
 * array) would otherwise crash downstream (`deserializeEntry` destructures
 * fields off it) or produce a garbage entry with an `undefined` displayId.
 * Rejected candidates are dropped silently here; the caller emits a single
 * summary diagnostic when `rejectedCount > 0`.
 */
function partitionEntryCandidates(
  candidates: readonly unknown[],
): { valid: SerializedEntry[]; rejectedCount: number } {
  const valid: SerializedEntry[] = [];
  let rejectedCount = 0;
  for (const candidate of candidates) {
    if (
      typeof candidate === "object" && candidate !== null &&
      !Array.isArray(candidate)
    ) {
      valid.push(candidate as SerializedEntry);
    } else {
      rejectedCount++;
    }
  }
  return { valid, rejectedCount };
}

function malformed(file: string, detail: string): Diagnostic {
  return {
    code: "UPSTREAM-SNAPSHOT-003",
    severity: "error",
    message: `malformed upstream snapshot: ${detail}`,
    location: { file, line: 1, column: 1 },
  };
}
