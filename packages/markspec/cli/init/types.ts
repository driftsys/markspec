/**
 * @module cli/init/types
 *
 * Shared types for the `markspec init` orchestrator and its modules.
 * No runtime logic — these are the data contracts between the
 * planner, resolvers, scaffolders, and the executor.
 */

/** The user's profile-chain choice, resolved from flags or the TTY picker. */
export type ProfileChoice =
  | { readonly kind: "bundled" }
  | { readonly kind: "git"; readonly spec: string }
  | { readonly kind: "local"; readonly spec: string }
  | { readonly kind: "none" };

/** Clients init will write MCP configs for, after detection + flags. */
export interface ClientSet {
  /** Set of client IDs to write. Subset of {claude-code, opencode, claude-desktop}. */
  readonly write: ReadonlySet<InitClientId>;
}

export type InitClientId = "claude-code" | "opencode";

export const INIT_CLIENT_IDS: readonly InitClientId[] = [
  "claude-code",
  "opencode",
];

/** The markspec binary reference written into MCP `command` fields. */
export interface BinaryRef {
  /** Either "markspec" (PATH-resolved) or an absolute path. */
  readonly command: string;
  /** Non-empty when PATH lookup found a mismatch or absence. */
  readonly warning?: string;
}

/** One planned per-file action. */
export type Action =
  | { readonly kind: "create"; readonly file: string; readonly reason?: string }
  | { readonly kind: "merge"; readonly file: string }
  | {
    readonly kind: "overwrite";
    readonly file: string;
    readonly reason: "force";
  }
  | { readonly kind: "skip"; readonly file: string; readonly reason: string }
  | { readonly kind: "no-op"; readonly file: string };

/** The full write plan computed before any side effects run. */
export interface WritePlan {
  readonly actions: readonly Action[];
}

/** One accumulated warning surfaced at end-of-run. */
export interface Warning {
  /** Stable code, e.g. "BINARY_PATH_MISMATCH", "UPSKILL_NOT_FOUND". */
  readonly code: string;
  /** Human-readable message; goes to stderr in text mode. */
  readonly message: string;
}

/** Stable error codes (spec §6). */
export type ErrorCode =
  | "TARGET_NOT_EMPTY"
  | "TARGET_NOT_WRITABLE"
  | "INVALID_PROFILE_SPEC"
  | "PROFILE_LOCAL_PATH_NOT_FOUND"
  | "BINARY_NOT_FOUND"
  | "BINARY_PATH_NOT_ABSOLUTE"
  | "UNKNOWN_CLIENT"
  | "NON_INTERACTIVE_GUARD"
  | "WRITE_FAILED"
  | "MERGE_REFUSED_MALFORMED_JSON"
  | "LOCKFILE_ROUND_TRIP_FAILED";

/** Init's top-level result. */
export interface InitResult {
  readonly ok: boolean;
  readonly exitCode: 0 | 1 | 2;
  readonly target: string;
  readonly profile: ProfileChoice;
  readonly clientsWritten: readonly InitClientId[];
  readonly actions: readonly Action[];
  readonly warnings: readonly Warning[];
  readonly skills: { readonly installed: boolean; readonly attempted: boolean };
  readonly error?: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
}
