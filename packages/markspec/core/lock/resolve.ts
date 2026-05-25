/**
 * @module core/lock/resolve
 *
 * Shared upstream-resolution layer. Both `markspec lock` and
 * `markspec compile` call {@linkcode resolveUpstreams}. All
 * world-touching operations (HTTP fetch, clock) flow through
 * callbacks so unit tests inject deterministic stubs.
 *
 * Implementation arrives in Tasks 15–18; this file ships the type
 * surface and a stub.
 */

import type {
  Diagnostic,
  Entry,
  ProfileChain,
  ProjectConfig,
} from "../model/mod.ts";
import type { Mapping } from "../sync/mod.ts";
import type {
  BoundEntry,
  UpstreamProfile,
  UpstreamReference,
  UpstreamRegistry,
} from "./model.ts";

/**
 * Callback to fetch a URL. Returns the bytes on success, or an
 * `{ error }` object on failure. Never throws — every recoverable
 * problem flows back as an error so the resolver can attach a
 * diagnostic instead of bubbling an exception.
 */
export type FetchUrl = (
  url: string,
) => Promise<Uint8Array | { error: string }>;

/** Inputs to {@linkcode resolveUpstreams}. */
export interface ResolveUpstreamsOptions {
  readonly entries: readonly Entry[];
  /**
   * Profile chain to lock. Pass `[]` when no profile is active —
   * tighter than making the chain optional, since downstream
   * code can always iterate `profileChain` without a null check.
   */
  readonly profileChain: ProfileChain | readonly never[];
  readonly config: ProjectConfig;
  readonly mappings: readonly Mapping[];
  readonly fetchUrl: FetchUrl;
  /** Injectable clock for deterministic tests. Defaults to `() => new Date()`. */
  readonly now?: () => Date;
}

/** A Reference citation that resolved to bytes or identity-only. */
export interface ResolvedReference {
  readonly upstream: UpstreamReference;
  readonly diagnostics: readonly Diagnostic[];
}

/** A profile chain tier that resolved. */
export interface ResolvedProfile {
  readonly upstream: UpstreamProfile;
  readonly diagnostics: readonly Diagnostic[];
}

/** A federated registry that resolved. */
export interface ResolvedRegistry {
  readonly upstream: UpstreamRegistry;
  readonly diagnostics: readonly Diagnostic[];
}

/** A bound entry's locked-attribute snapshot. */
export interface ResolvedBoundEntry {
  readonly boundEntry: BoundEntry;
  readonly diagnostics: readonly Diagnostic[];
}

/** Full resolved-upstreams payload — input to lockfile serialization. */
export interface ResolvedUpstreams {
  readonly references: readonly ResolvedReference[];
  readonly profiles: readonly ResolvedProfile[];
  readonly registries: readonly ResolvedRegistry[];
  readonly boundEntries: readonly ResolvedBoundEntry[];
  /** sha256:* of the canonical edge serialization. */
  readonly canonicalEdgeHash: string;
  readonly canonicalEdgeCount: number;
  /** Wall-clock timestamp the lockfile was resolved. */
  readonly lockedAt: string;
  /** Aggregate diagnostics — empty when every upstream resolved cleanly. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Resolve every upstream in `opts` to a `ResolvedUpstreams` payload.
 *
 * Implementation arrives in Tasks 15–18 (Reference, profile + registry,
 * bound-entry, composition + canonical edges). This stub exists so
 * the type surface and barrel can ship first; downstream tasks fill
 * in behaviour.
 */
export function resolveUpstreams(
  _opts: ResolveUpstreamsOptions,
): Promise<ResolvedUpstreams> {
  return Promise.reject(
    new Error("resolveUpstreams: not yet implemented (Tasks 15–18)"),
  );
}
