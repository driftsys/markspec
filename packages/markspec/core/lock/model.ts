/**
 * @module core/lock/model
 *
 * Lockfile data model. Pure types — no I/O, no behaviour.
 */

/** A resolved Reference citation. */
export interface UpstreamReference {
  readonly kind: "reference";
  /** Pandoc-style slug (display ID of the Reference entry). */
  readonly slug: string;
  /** Canonical URI (urn:/doi:/pkg:/isbn:/https: etc.). */
  readonly id: string;
  /** Version segment extracted from the URI, when present. */
  readonly resolved?: string;
  /** sha256:* of fetched bytes; absent when Reference-url was missing. */
  readonly hash?: string;
  /** Fetch URL (from Reference-url); absent when Reference-url was missing. */
  readonly source?: string;
  /** listing-directives §5 scheme (urn / purl etc.), if classified. */
  readonly componentScheme?: string;
}

/** A resolved profile chain tier. */
export interface UpstreamProfile {
  readonly kind: "profile";
  readonly id: string;
  /** Original specifier from .markspec.yaml (e.g. `npm:@org/aspice@^1.2`). */
  readonly specifier: string;
  /** Exact resolved version (e.g. `1.2.4`). */
  readonly resolved: string;
  /** sha256:* of the resolved profile's markspec.yaml bytes. */
  readonly hash: string;
  /** Parent tier id in the extends chain; absent for the chain root. */
  readonly extends?: string;
}

/** A resolved federated registry. */
export interface UpstreamRegistry {
  readonly kind: "registry";
  readonly id: string;
  readonly api: string;
  readonly resolvedManifestHash: string;
  readonly markspecSchema: number;
}

/** Discriminated union of upstream kinds. */
export type Upstream =
  | UpstreamReference
  | UpstreamProfile
  | UpstreamRegistry;

/** A locked attribute on a binding — attribute name → upstream value hash. */
export type LockedAttributes = ReadonlyMap<string, string>;

/** One External-id binding within a bound entry. */
export interface BoundEntryBinding {
  readonly externalId: string;
  readonly system: string;
  readonly direction: "outbound" | "inbound" | "bidirectional";
  readonly lockedAttributes: LockedAttributes;
}

/** An entry bound to one or more external systems via External-id. */
export interface BoundEntry {
  readonly displayId: string;
  readonly ulid: string;
  readonly bindings: readonly BoundEntryBinding[];
}

/** Canonical-edge-graph integrity record. */
export interface GeneratedCache {
  readonly edgesHash: string;
  readonly edgesCount: number;
}

/** Lockfile metadata. */
export interface LockfileMeta {
  readonly markspecSchema: number;
  /** Timestamp the lockfile was written, RFC 3339 UTC (e.g. "2026-05-25T12:00:00Z"). */
  readonly lockedAt: string;
}

/** Top-level lockfile model. */
export interface Lockfile {
  readonly schema: number;
  readonly meta: LockfileMeta;
  readonly upstreams: readonly Upstream[];
  readonly boundEntries: readonly BoundEntry[];
  readonly generatedCache: GeneratedCache;
}

/** Current lockfile-format version. */
export const LOCKFILE_SCHEMA_VERSION = 1;
