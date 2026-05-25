/**
 * @module core/sync/locked_attributes
 *
 * Infers which MarkSpec attributes are upstream-owned (locally read-only)
 * for a single mapping. Reads only per-attribute direction + locked
 * fields — the top-level system direction has already been baked into
 * every per-attribute direction at parse time (see `parseMapping`), so
 * this function does not need to consult it.
 *
 * Locking rule:
 *   - Per-attribute direction `outbound` → never locked
 *   - Per-attribute `locked: true` → locked
 *   - Per-attribute direction `inbound` → locked
 *   - Per-attribute direction `bidirectional` without `locked: true` → not locked
 */

import type { Mapping } from "./mapping.ts";

/** The set of MarkSpec attribute names locked for this mapping. */
export function inferLockedAttributes(mapping: Mapping): Set<string> {
  const locked = new Set<string>();
  for (const a of mapping.attributes) {
    if (a.direction === "outbound") continue;
    if (a.locked || a.direction === "inbound") {
      locked.add(a.markspec);
    }
  }
  return locked;
}
