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
  /** Upstream project.version, when published. */
  readonly version?: string;
  /** sha256 of the entries data-file bytes. */
  readonly snapshot?: string;
  /** RFC3339 — when this pin was created/moved. */
  readonly lockedAt?: string;
}

/** A resolved federated git-repository upstream dependency. */
export interface UpstreamDependency {
  readonly kind: "dependency";
  readonly id: string;
  /** Git repository URL (remote or local path). */
  readonly url: string;
  /** `"auto"` | `<tag>` | `<branch>` — the requested resolution intent. */
  readonly intent: string;
  /** `"tag:<t>"` | `"branch:<b>"` | `"sha:<s>"` — what actually resolved. */
  readonly resolved: string;
  /** Exact resolved commit. */
  readonly sha: string;
  /** sha256 of the cached entries data file. */
  readonly snapshot: string;
  /** RFC3339 — when this pin was created/moved. */
  readonly lockedAt: string;
}

/** Discriminated union of upstream kinds. */
export type Upstream =
  | UpstreamReference
  | UpstreamProfile
  | UpstreamRegistry
  | UpstreamDependency;

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

/**
 * One resolved trace edge in the ULID identity ledger (issue #593, Slice 3).
 *
 * Records the stable ULID identity of an edge's source and target alongside the
 * verbatim authored target token at lock time. The authored token is the datum
 * a recompile cannot recover after a rename, so the ledger is identity
 * provenance for `fmt` rename-healing — distinct from the integrity digest in
 * {@linkcode GeneratedCache}. Distinct from `EdgeQuad` (the display-ID hash
 * input in `canonical_edges.ts`).
 */
export interface LockEdge {
  /** Stable ULID of the source entry. Always present (source is a local entry). */
  readonly sourceUlid: string;
  /** Trace relation attribute name, e.g. "Satisfies". */
  readonly relation: string;
  /**
   * Stable ULID of the resolved target. Absent when the authored target
   * resolves to no entry (a dangling reference, already warned by MSL-L006).
   */
  readonly targetUlid?: string;
  /** Verbatim authored target token (display ID or ULID) at lock time. */
  readonly authoredTarget: string;
}

/** Canonical-edge-graph integrity record. */
export interface GeneratedCache {
  readonly edgesHash: string;
  readonly edgesCount: number;
}

/** Toolchain requirements declared by the project. */
export interface LockfileToolchain {
  /**
   * Minimum required markspec release version at minor granularity
   * (e.g. "0.6" means "any 0.6.x or later"). Compared as a
   * (major, minor) tuple against the running binary's VERSION.
   * Format: /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/ — exactly two components,
   * no leading zeros, no prefix, no operator.
   */
  readonly minVersion: string;
}

/** Lockfile metadata. */
export interface LockfileMeta {
  readonly markspecSchema: number;
  /** Timestamp the lockfile was written, RFC 3339 UTC (e.g. "2026-05-25T12:00:00Z"). */
  readonly lockedAt: string;
  /** Toolchain requirements; omitted when no floor is declared. */
  readonly toolchain?: LockfileToolchain;
}

/** Top-level lockfile model. */
export interface Lockfile {
  readonly schema: number;
  readonly meta: LockfileMeta;
  readonly upstreams: readonly Upstream[];
  readonly boundEntries: readonly BoundEntry[];
  /** Per-edge ULID identity ledger (issue #593, Slice 3). */
  readonly edges: readonly LockEdge[];
  readonly generatedCache: GeneratedCache;
}

/** Current lockfile-format version. */
export const LOCKFILE_SCHEMA_VERSION = 1;
