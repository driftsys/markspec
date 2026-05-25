/**
 * @module core/sync/status
 *
 * Aggregate per-binding status into the groupings sync-status CLI needs.
 */

/** All possible `remote_state` values observed on a bound entry. */
export type RemoteState =
  | "ok"
  | "ahead"
  | "behind"
  | "conflict"
  | "deleted-upstream"
  | "unreachable"
  | "unbound";

/** Per-binding status snapshot. */
export interface BoundEntryStatus {
  readonly displayId: string;
  readonly system: string;
  readonly externalId: string;
  readonly remoteState: RemoteState;
  readonly lastSyncedAt?: string;
  readonly lastConflictAt?: string;
  readonly lockedAttributes?: readonly string[];
}

/**
 * Group by `remoteState`; entries within each group sorted by
 * `displayId` for stable CLI output.
 */
export function aggregateStatusByState(
  entries: readonly BoundEntryStatus[],
): Map<RemoteState, BoundEntryStatus[]> {
  const out = new Map<RemoteState, BoundEntryStatus[]>();
  for (const e of entries) {
    const list = out.get(e.remoteState) ?? [];
    list.push(e);
    out.set(e.remoteState, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.displayId.localeCompare(b.displayId));
  }
  return out;
}
