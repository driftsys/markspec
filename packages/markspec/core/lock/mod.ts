/**
 * @module core/lock
 *
 * Lockfile data model, TOML serializer + parser, canonical edge
 * model, upstream resolution, drift detection. The public boundary
 * for both `markspec lock` and `markspec compile --frozen`.
 */

export type {
  BoundEntry,
  BoundEntryBinding,
  GeneratedCache,
  LockedAttributes,
  LockEdge,
  Lockfile,
  LockfileMeta,
  LockfileToolchain,
  Upstream,
  UpstreamDependency,
  UpstreamProfile,
  UpstreamReference,
  UpstreamRegistry,
} from "./model.ts";
export { LOCKFILE_SCHEMA_VERSION } from "./model.ts";

export { serializeLockfile } from "./serializer.ts";
export { parseLockfile } from "./parser.ts";
export type { ParseLockfileResult } from "./parser.ts";

export { dependencyPinAssurance } from "./pin_assurance.ts";

export { isBelowFloor } from "./compare.ts";

export { checkDrift } from "./check.ts";

export { sha256Bytes, sha256String } from "./hash.ts";

export { canonicalEdgeJson, hashCanonicalEdges } from "./canonical_edges.ts";
export type { EdgeQuad } from "./canonical_edges.ts";

export { detectOfflineEdgeDrift } from "./edge_drift.ts";
export type { OfflineEdgeDrift } from "./edge_drift.ts";

export { verifyUpstreamCache } from "./cache_check.ts";

export {
  extractEdgeLedger,
  extractEdgeQuads,
  resolveBoundEntries,
  resolveProfileChain,
  resolveReferences,
  resolveUpstreams,
} from "./resolve.ts";
export type {
  FetchUrl,
  ReadFile,
  ResolvedBoundEntry,
  ResolvedProfile,
  ResolvedReference,
  ResolvedUpstreams,
  ResolveUpstreamsOptions,
} from "./resolve.ts";

export {
  deriveUpstreamId,
  resolveProjectReferences,
  upstreamCacheRoot,
} from "./upstream_refs.ts";
export type {
  ResolveProjectReferencesOptions,
  ResolveProjectReferencesResult,
  UpstreamRefsIO,
} from "./upstream_refs.ts";

export {
  type GitIO,
  resolveProjectDependencies,
  type ResolveProjectDependenciesOptions,
  type ResolveProjectDependenciesResult,
  type UpstreamDepsIO,
} from "./upstream_deps.ts";
export {
  type AcquireCompileIO,
  compileAcquiredTree,
  type CompiledSnapshot,
} from "./acquire_compile.ts";
export {
  type GitRef,
  parseLsRemote,
  type RefList,
  type ResolvedIntent,
  resolveIntent,
} from "./git_intent.ts";
