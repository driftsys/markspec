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
  ProfileSpecifier,
  ProjectConfig,
} from "../model/mod.ts";
import {
  CORE_RELATIONS,
  LOCK_EXTRA_INVERSE_KEYS,
  URI_SCHEME_RE,
} from "../model/mod.ts";
import type { Mapping } from "../sync/mod.ts";
import { inferLockedAttributes } from "../sync/locked_attributes.ts";
import type {
  BoundEntry,
  BoundEntryBinding,
  LockEdge,
  UpstreamProfile,
  UpstreamReference,
  UpstreamRegistry,
} from "./model.ts";
import { sha256Bytes } from "./hash.ts";
import { type EdgeQuad, hashCanonicalEdges } from "./canonical_edges.ts";

/**
 * Callback to fetch a URL. Returns the bytes on success, or an
 * `{ error }` object on failure. Never throws — every recoverable
 * problem flows back as an error so the resolver can attach a
 * diagnostic instead of bubbling an exception.
 */
export type FetchUrl = (
  url: string,
) => Promise<Uint8Array | { error: string }>;

/**
 * Callback to read a local file by absolute path. Returns the bytes on
 * success, or `{ error }` on failure. Used by `resolveProfileChain` to
 * hash on-disk profile manifests; isolated to a callback so the resolver
 * stays runtime-agnostic.
 */
export type ReadFile = (
  path: string,
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
  readonly readFile: ReadFile;
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
  /** Per-edge ULID identity ledger (issue #593, Slice 3). */
  readonly edges: readonly LockEdge[];
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
 * Project an entry list to canonical edge quads. Walks the eleven core
 * trace-link attributes (Satisfies, Derived-from, Verified-by, …) and
 * emits one quad per resolved target ID, splitting CSV values on `,`
 * or whitespace. Every quad is provenance `"local"` — externally
 * sourced edges are folded in later (post-MVP).
 */
export function extractEdgeQuads(entries: readonly Entry[]): EdgeQuad[] {
  const TRACE_KEYS: readonly string[] = [
    ...CORE_RELATIONS.filter((r) => r.lockEdge).map((r) => r.attr),
    ...LOCK_EXTRA_INVERSE_KEYS, // Verified-by — lock tracks the inverse edge
  ];
  const out: EdgeQuad[] = [];
  for (const entry of entries) {
    for (const a of entry.rawAttributes) {
      if (!TRACE_KEYS.includes(a.key)) continue;
      const targets = a.value.split(/[\s,]+/).filter((t) => t.length > 0);
      for (const target of targets) {
        out.push({
          source: entry.displayId,
          relation: a.key,
          target,
          provenance: "local",
        });
      }
    }
  }
  return out;
}

/**
 * Resolve every trace edge to a ULID identity-ledger record (issue #593,
 * Slice 3). Reuses {@linkcode extractEdgeQuads} for the trace-key walk, then
 * resolves the source (always a local entry → `entry.id`) and target through
 * the dual index `byDisplayId ?? byId`. The verbatim authored target token is
 * preserved so `fmt` rename-healing can match it later.
 *
 * Skips:
 *   - edges whose source has no ULID (unstamped — not lockable);
 *   - edges whose target is a scheme-qualified URI (intentionally external,
 *     never a local entry — mirrors the MSL-L006 existence-check skip).
 *
 * An unresolved (but non-URI) target yields a record with `targetUlid`
 * undefined — a dangling reference already surfaced by MSL-L006 at `check`.
 */
export function extractEdgeLedger(
  entries: readonly Entry[],
  byDisplayId: ReadonlyMap<string, Entry>,
  byId: ReadonlyMap<string, Entry>,
): LockEdge[] {
  const out: LockEdge[] = [];
  for (const quad of extractEdgeQuads(entries)) {
    const sourceEntry = byDisplayId.get(quad.source) ?? byId.get(quad.source);
    const sourceUlid = sourceEntry?.id;
    if (sourceUlid === undefined) continue; // unstamped source — not lockable
    if (URI_SCHEME_RE.test(quad.target)) continue; // external reference
    const targetEntry = byDisplayId.get(quad.target) ?? byId.get(quad.target);
    out.push({
      sourceUlid,
      relation: quad.relation,
      authoredTarget: quad.target,
      ...(targetEntry?.id !== undefined ? { targetUlid: targetEntry.id } : {}),
    });
  }
  return out;
}

/**
 * Resolve every upstream the lockfile needs: References, profile chain
 * tiers, federated registries, and bound entries. Computes the
 * canonical edge hash from the same entry set. Returns the aggregate
 * `ResolvedUpstreams` payload ready for {@link serializeLockfile}.
 *
 * The four sub-resolvers run sequentially (not concurrently) because
 * (a) the callbacks they share — `fetchUrl`, `readFile` — may themselves
 * serialize work, and (b) the diagnostics output is easier to reason
 * about with a deterministic order. Wrap inside `Promise.all` only when
 * profiling shows a clear win.
 */
export async function resolveUpstreams(
  opts: ResolveUpstreamsOptions,
): Promise<ResolvedUpstreams> {
  const now = (opts.now ?? (() => new Date()))();
  const lockedAt = now.toISOString();

  const refResults = await resolveReferences(opts.entries, opts.fetchUrl);
  const profResults = await resolveProfileChain(
    opts.profileChain,
    opts.readFile,
  );
  const regResults = await resolveRegistries(opts.config, opts.fetchUrl);
  const boundResults = await resolveBoundEntries(opts.entries, opts.mappings);

  const edges = extractEdgeQuads(opts.entries);
  const canonicalEdgeHash = await hashCanonicalEdges(edges);

  // Dual index for the ULID ledger — first-entry-wins on duplicate keys,
  // matching the validator/workspace convention.
  const byDisplayId = new Map<string, Entry>();
  const byId = new Map<string, Entry>();
  for (const e of opts.entries) {
    if (!byDisplayId.has(e.displayId)) byDisplayId.set(e.displayId, e);
    if (e.id !== undefined && !byId.has(e.id)) byId.set(e.id, e);
  }
  const edgeLedger = extractEdgeLedger(opts.entries, byDisplayId, byId);

  const diagnostics: Diagnostic[] = [
    ...refResults.flatMap((r) => r.diagnostics),
    ...profResults.flatMap((r) => r.diagnostics),
    ...regResults.flatMap((r) => r.diagnostics),
    ...boundResults.flatMap((r) => r.diagnostics),
  ];

  return {
    references: refResults,
    profiles: profResults,
    registries: regResults,
    boundEntries: boundResults,
    canonicalEdgeHash,
    canonicalEdgeCount: edges.length,
    edges: edgeLedger,
    lockedAt,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Profile chain resolution (Task 16)
// ---------------------------------------------------------------------------

/**
 * Format a `ProfileSpecifier` into the lockfile-canonical specifier string.
 *
 * Strings are stable across runs so the lockfile diff captures only meaningful
 * changes:
 *   - `builtin`                                    — bundled default
 *   - `local:<path>`                               — on-disk profile
 *   - `git:<repo>#<tag>` or `git:<repo>//<subpath>#<tag>`
 *   - `npm:<scope?><name>@<range>`
 */
function formatSpecifier(spec: ProfileSpecifier): string {
  switch (spec.kind) {
    case "builtin":
      return "builtin";
    case "local":
      return `local:${spec.path}`;
    case "git":
      return spec.subpath !== undefined
        ? `git:${spec.repo}//${spec.subpath}#${spec.tag}`
        : `git:${spec.repo}#${spec.tag}`;
    case "npm": {
      const name = spec.scope !== undefined
        ? `${spec.scope}/${spec.name}`
        : spec.name;
      return `npm:${name}@${spec.range}`;
    }
  }
}

/**
 * Resolve every profile chain tier into an upstream record. Each tier's
 * `markspec.yaml` is read from `tier.sourcePath` via `readFile` and
 * `sha256:*`-hashed; a read failure attaches MSL-L102 and degrades the
 * tier's hash to `sha256:0` (identity-only).
 *
 * The `extends` chain is reconstructed from list order: tiers are
 * already root-parent → leaf-child, so each tier's `extends` points to
 * the previous tier's id. The root tier has `extends: undefined`.
 */
export async function resolveProfileChain(
  chain: ProfileChain | readonly never[],
  readFile: ReadFile,
): Promise<ResolvedProfile[]> {
  if (Array.isArray(chain)) return [];
  const realChain = chain as ProfileChain;
  const out: ResolvedProfile[] = [];
  let parentId: string | undefined = undefined;
  for (const tier of realChain.tiers) {
    const diagnostics: Diagnostic[] = [];
    let hash = "sha256:0";
    const fetched = await readFile(tier.sourcePath);
    if (fetched instanceof Uint8Array) {
      hash = await sha256Bytes(fetched);
    } else {
      diagnostics.push({
        code: "MSL-L102",
        severity: "warning",
        message:
          `Failed to read profile manifest at ${tier.sourcePath}: ${fetched.error}. Recording identity-only hash.`,
        location: undefined,
      });
    }
    out.push({
      upstream: {
        kind: "profile",
        id: tier.id,
        specifier: formatSpecifier(tier.specifier),
        resolved: tier.version,
        hash,
        extends: parentId,
      },
      diagnostics,
    });
    parentId = tier.id;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Registry resolution (Task 16)
// ---------------------------------------------------------------------------

/**
 * Resolve federated parent registries (and the fallback, when not already
 * listed). Each URL's `<url>/manifest` is fetched; the body is parsed
 * loosely for `markspec-schema` (defaults to 1 on parse failure).
 */
export async function resolveRegistries(
  config: ProjectConfig,
  fetchUrl: FetchUrl,
): Promise<ResolvedRegistry[]> {
  const urls = [...config.parents];
  if (config.parentFallback && !urls.includes(config.parentFallback)) {
    urls.push(config.parentFallback);
  }
  const out: ResolvedRegistry[] = [];
  for (const url of urls) {
    const manifestUrl = url.endsWith("/")
      ? `${url}manifest`
      : `${url}/manifest`;
    const fetched = await fetchUrl(manifestUrl);
    if (fetched instanceof Uint8Array) {
      const hash = await sha256Bytes(fetched);
      let markspecSchema = 1;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(fetched));
        if (typeof parsed["markspec-schema"] === "number") {
          markspecSchema = parsed["markspec-schema"];
        }
      } catch { /* leave default */ }
      out.push({
        upstream: {
          kind: "registry",
          id: `urn:markspec:registry:${url}`,
          api: url,
          resolvedManifestHash: hash,
          markspecSchema,
        },
        diagnostics: [],
      });
    } else {
      out.push({
        upstream: {
          kind: "registry",
          id: `urn:markspec:registry:${url}`,
          api: url,
          resolvedManifestHash: "sha256:0",
          markspecSchema: 1,
        },
        diagnostics: [{
          code: "MSL-L101",
          severity: "warning",
          message:
            `Failed to fetch registry manifest from ${manifestUrl}: ${fetched.error}`,
          location: undefined,
        }],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bound-entry resolution (Task 17)
// ---------------------------------------------------------------------------

/**
 * Resolve every entry carrying `External-id:` attributes into a
 * `ResolvedBoundEntry`. For each External-id, look up the mapping by
 * scheme prefix, compute the locked-attribute set, and snapshot each
 * local value as `sha256:*` of UTF-8 bytes.
 *
 * Unknown scheme → MSL-S021 error, that binding skipped. Entries with
 * zero External-id attributes are silently dropped (no upstream lock
 * needed). Multi-value attributes are joined with `\n` before hashing
 * so a single locked-attribute hash captures the full attribute state.
 */
export async function resolveBoundEntries(
  entries: readonly Entry[],
  mappings: readonly Mapping[],
): Promise<ResolvedBoundEntry[]> {
  const mappingBySystem = new Map<string, Mapping>();
  for (const m of mappings) mappingBySystem.set(m.system, m);

  const out: ResolvedBoundEntry[] = [];
  for (const entry of entries) {
    const externalIds: string[] = [];
    for (const a of entry.rawAttributes) {
      if (a.key === "External-id") externalIds.push(a.value);
    }
    if (externalIds.length === 0) continue;

    const diagnostics: Diagnostic[] = [];
    const bindings: BoundEntryBinding[] = [];
    for (const eid of externalIds) {
      const colonIdx = eid.indexOf(":");
      const scheme = colonIdx >= 0 ? eid.slice(0, colonIdx) : eid;
      const mapping = mappingBySystem.get(scheme);
      if (!mapping) {
        diagnostics.push({
          code: "MSL-S021",
          severity: "error",
          message:
            `External-id scheme '${scheme}' on entry '${entry.displayId}' has no matching mapping.yaml.`,
          location: entry.location,
        });
        continue;
      }
      const lockedAttrNames = inferLockedAttributes(mapping);
      const lockedAttributes = new Map<string, string>();
      for (const attrName of lockedAttrNames) {
        const value = entry.rawAttributes
          .filter((a) => a.key === attrName)
          .map((a) => a.value)
          .join("\n");
        const hash = await sha256Bytes(new TextEncoder().encode(value));
        lockedAttributes.set(attrName, hash);
      }
      bindings.push({
        externalId: eid,
        system: scheme,
        direction: mapping.direction,
        lockedAttributes,
      });
    }
    out.push({
      boundEntry: {
        displayId: entry.displayId,
        ulid: entry.id ?? "",
        bindings,
      },
      diagnostics,
    });
  }
  return out;
}
