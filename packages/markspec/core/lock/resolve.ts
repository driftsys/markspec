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
import { sha256Bytes } from "./hash.ts";

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

// ---------------------------------------------------------------------------
// Reference resolution (Task 15)
// ---------------------------------------------------------------------------

/**
 * Extract the "resolved version" segment from a Reference's URI.
 *
 * Heuristics covering the URI schemes the lock CLI is expected to see:
 *   - `urn:iso:std:iso:26262:-6:ed-2` → `ed-2` (last `:`-segment)
 *   - `pkg:cargo/serde@1.0.0` → `1.0.0` (everything after the last `@`)
 *   - `doi:…`, `isbn:…`, plain `https://…` → undefined
 */
function extractResolvedVersion(uri: string): string | undefined {
  const urnMatch = uri.match(/^urn:[^:]+(?:::|:)([^:]+)$/);
  if (urnMatch) return urnMatch[1];
  const pkgMatch = uri.match(/@([^?]+)$/);
  if (pkgMatch) return pkgMatch[1];
  return undefined;
}

/** First raw-attribute value matching `key`, or undefined. */
function attrValue(entry: Entry, key: string): string | undefined {
  for (const a of entry.rawAttributes) {
    if (a.key === key) return a.value;
  }
  return undefined;
}

/**
 * Resolve every Reference entry to an upstream record. Deduplicates by
 * display ID (first occurrence wins). When `Reference-url:` is set, the
 * bytes are fetched and `sha256:*`-hashed; otherwise an MSL-L010 info
 * diagnostic is attached and the upstream is identity-only. Fetch
 * failures attach MSL-L101 and degrade to identity-only.
 */
export async function resolveReferences(
  entries: readonly Entry[],
  fetchUrl: FetchUrl,
): Promise<ResolvedReference[]> {
  const out: ResolvedReference[] = [];
  const seenSlugs = new Set<string>();
  for (const entry of entries) {
    if (entry.shape !== "Reference") continue;
    if (seenSlugs.has(entry.displayId)) continue;
    seenSlugs.add(entry.displayId);

    const id = entry.id;
    if (id === undefined) continue;
    const refUrl = attrValue(entry, "Reference-url");
    const diagnostics: Diagnostic[] = [];
    let hash: string | undefined;
    let source: string | undefined;

    if (refUrl === undefined) {
      diagnostics.push({
        code: "MSL-L010",
        severity: "info",
        message:
          `Reference '${entry.displayId}' has no Reference-url:; identity-only lock (no hash, no drift detection).`,
        location: entry.location,
      });
    } else {
      const fetched = await fetchUrl(refUrl);
      if (fetched instanceof Uint8Array) {
        hash = await sha256Bytes(fetched);
        source = refUrl;
      } else {
        diagnostics.push({
          code: "MSL-L101",
          severity: "warning",
          message:
            `Failed to fetch Reference-url for '${entry.displayId}' (${refUrl}): ${fetched.error}. Recording identity-only.`,
          location: entry.location,
        });
      }
    }

    out.push({
      upstream: {
        kind: "reference",
        slug: entry.displayId,
        id,
        resolved: extractResolvedVersion(id),
        hash,
        source,
      },
      diagnostics,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Full upstream resolution (Tasks 16–18)
// ---------------------------------------------------------------------------

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
