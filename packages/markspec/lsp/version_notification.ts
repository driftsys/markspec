/**
 * @module lsp/version_notification
 *
 * Pure builder for the `markspec/version` LSP notification payload.
 * Composes the running binary's release + core schema with the
 * workspace lockfile's toolchain floor and the {@linkcode isBelowFloor}
 * verdict, so the server send-site is a one-liner and the four
 * lockfile-state cases are unit-testable without an LSP fixture.
 *
 * The four cases the consumer (VS Code status bar) cares about are:
 *   - no lockfile loaded                       → minVersion null, isBelow false
 *   - lockfile present, no [meta.toolchain]    → minVersion null, isBelow false
 *   - floor declared and met                   → minVersion echoed, isBelow false
 *   - floor declared and unmet                 → minVersion echoed, isBelow true
 */

import { isBelowFloor, type Lockfile } from "../core/mod.ts";

/** Wire shape of the `markspec/version` notification. */
export interface VersionNotificationPayload {
  readonly release: string;
  readonly coreSchemaVersion: number;
  readonly minVersion: string | null;
  readonly isBelow: boolean;
}

/**
 * Build the `markspec/version` payload from the running binary's
 * version constants and the optionally-loaded lockfile.
 */
export function buildVersionNotification(
  release: string,
  coreSchemaVersion: number,
  lockfile: Lockfile | undefined,
): VersionNotificationPayload {
  const floor = lockfile?.meta.toolchain?.minVersion;
  return {
    release,
    coreSchemaVersion,
    minVersion: floor ?? null,
    isBelow: isBelowFloor(release, floor),
  };
}
