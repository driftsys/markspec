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
  Lockfile,
  LockfileMeta,
  Upstream,
  UpstreamProfile,
  UpstreamReference,
  UpstreamRegistry,
} from "./model.ts";
export { LOCKFILE_SCHEMA_VERSION } from "./model.ts";

export { serializeLockfile } from "./serializer.ts";
export { parseLockfile } from "./parser.ts";
export type { ParseLockfileResult } from "./parser.ts";

export { sha256Bytes, sha256String } from "./hash.ts";

export { canonicalEdgeJson, hashCanonicalEdges } from "./canonical_edges.ts";
export type { EdgeQuad } from "./canonical_edges.ts";

export {
  resolveBoundEntries,
  resolveProfileChain,
  resolveReferences,
  resolveRegistries,
  resolveUpstreams,
} from "./resolve.ts";
export type {
  FetchUrl,
  ReadFile,
  ResolvedBoundEntry,
  ResolvedProfile,
  ResolvedReference,
  ResolvedRegistry,
  ResolvedUpstreams,
  ResolveUpstreamsOptions,
} from "./resolve.ts";
