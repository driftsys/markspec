/**
 * @module core/lock/parser
 *
 * TOML → Lockfile. Uses @std/toml for low-level parse; layers schema
 * validation + diagnostic emission on top.
 *
 * Diagnostic codes:
 *   - MSL-L001 — malformed TOML or missing required field
 *   - MSL-L002 — lockfile schema is newer than this binary supports
 *   - MSL-L003 — lockfile schema is unrecognised (< 1)
 *   - MSL-L030 — `[meta.toolchain].min-version` is malformed
 *   - MSL-L031 — `[meta.toolchain].min-version` is not a string
 *   - MSL-L032 — `meta.toolchain` is a scalar instead of a table
 */

import { parse as parseToml } from "@std/toml";
import type { Diagnostic } from "../model/mod.ts";
import {
  type BoundEntry,
  type BoundEntryBinding,
  type LockEdge,
  type Lockfile,
  LOCKFILE_SCHEMA_VERSION,
  type LockfileToolchain,
  type Upstream,
} from "./model.ts";

/**
 * Strict MAJOR.MINOR grammar for `[meta.toolchain].min-version`. Exactly
 * two components, no leading zeros (except `0` itself), no `v` prefix,
 * no operator. See spec 2026-05-27-markspec-lock-toolchain-minversion.
 * Must stay in sync with FLOOR_RE in `./compare.ts`.
 */
const MIN_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Outcome of {@linkcode parseLockfile}. */
export interface ParseLockfileResult {
  readonly lockfile?: Lockfile;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Parse a `markspec.lock` document. Returns the model when valid, or a
 * single `MSL-L###` diagnostic when not. Schema-validation errors are
 * always single-shot: parsing stops at the first integrity failure so
 * the caller has a clear repair signal.
 */
export function parseLockfile(toml: string): ParseLockfileResult {
  let raw: Record<string, unknown>;
  try {
    raw = parseToml(toml) as Record<string, unknown>;
  } catch (e) {
    return diag(
      "MSL-L001",
      `Malformed markspec.lock: ${(e as Error).message}`,
    );
  }

  const schema = raw.schema;
  if (typeof schema !== "number") {
    return diag("MSL-L001", "Missing or invalid `schema` field");
  }
  if (schema > LOCKFILE_SCHEMA_VERSION) {
    return diag(
      "MSL-L002",
      `Lockfile schema ${schema} is newer than this binary understands ` +
        `(max ${LOCKFILE_SCHEMA_VERSION}). Upgrade markspec or delete ` +
        `markspec.lock + relock.`,
    );
  }
  if (schema < 1) {
    return diag("MSL-L003", `Lockfile schema ${schema} is unrecognised.`);
  }

  const meta = raw.meta as Record<string, unknown> | undefined;
  const lockedAt = meta?.["locked-at"];
  if (!meta || typeof lockedAt !== "string") {
    return diag("MSL-L001", "Missing [meta] table or `locked-at` field");
  }
  const markspecSchema = meta["markspec-schema"];
  if (typeof markspecSchema !== "number") {
    return diag("MSL-L001", "Missing [meta].markspec-schema");
  }

  // [meta.toolchain] — optional minimum CLI version floor (slice B).
  // Validates strictly: malformed values are rejected with single-shot
  // diagnostics; unknown sub-keys are silently ignored for forward-compat.
  let toolchain: LockfileToolchain | undefined;
  const toolchainRaw = meta.toolchain as unknown;
  if (toolchainRaw !== undefined) {
    if (
      typeof toolchainRaw !== "object" || toolchainRaw === null ||
      Array.isArray(toolchainRaw)
    ) {
      return diag("MSL-L032", "[meta.toolchain] must be a table");
    }
    const tc = toolchainRaw as Record<string, unknown>;
    const rawMinVersion = tc["min-version"];
    if (rawMinVersion !== undefined) {
      if (typeof rawMinVersion !== "string") {
        return diag(
          "MSL-L031",
          "[meta.toolchain].min-version must be a string",
        );
      }
      if (!MIN_VERSION_RE.test(rawMinVersion)) {
        return diag(
          "MSL-L030",
          `[meta.toolchain].min-version is malformed: ` +
            `${JSON.stringify(rawMinVersion)} ` +
            `(expected MAJOR.MINOR like "0.6")`,
        );
      }
      toolchain = { minVersion: rawMinVersion };
    }
  }

  const upstreams: Upstream[] = [];
  const upstreamRoot = raw.upstream as Record<string, unknown> | undefined;
  if (upstreamRoot) {
    const refs =
      (upstreamRoot.reference as readonly Record<string, unknown>[]) ?? [];
    for (let i = 0; i < refs.length; i++) {
      const r = refs[i];
      const slug = requireString(r, "slug");
      const id = requireString(r, "id");
      if (slug === undefined || id === undefined) {
        return diag(
          "MSL-L001",
          `[[upstream.reference]] entry ${i}: missing required field 'slug' or 'id'`,
        );
      }
      upstreams.push({
        kind: "reference",
        slug,
        id,
        resolved: r.resolved as string | undefined,
        hash: r.hash as string | undefined,
        source: r.source as string | undefined,
        componentScheme: r["component-scheme"] as string | undefined,
      });
    }

    const profs =
      (upstreamRoot.profile as readonly Record<string, unknown>[]) ?? [];
    for (let i = 0; i < profs.length; i++) {
      const p = profs[i];
      const id = requireString(p, "id");
      const specifier = requireString(p, "specifier");
      const resolved = requireString(p, "resolved");
      const hash = requireString(p, "hash");
      if (
        id === undefined || specifier === undefined || resolved === undefined ||
        hash === undefined
      ) {
        return diag(
          "MSL-L001",
          `[[upstream.profile]] entry ${i}: missing required field 'id', 'specifier', 'resolved', or 'hash'`,
        );
      }
      upstreams.push({
        kind: "profile",
        id,
        specifier,
        resolved,
        hash,
        extends: p.extends as string | undefined,
      });
    }

    const regs =
      (upstreamRoot.registry as readonly Record<string, unknown>[]) ?? [];
    for (let i = 0; i < regs.length; i++) {
      const reg = regs[i];
      const id = requireString(reg, "id");
      const api = requireString(reg, "api");
      const resolvedManifestHash = requireString(reg, "resolved-manifest-hash");
      const markspecSchemaN = requireNumber(reg, "markspec-schema");
      if (
        id === undefined || api === undefined ||
        resolvedManifestHash === undefined || markspecSchemaN === undefined
      ) {
        return diag(
          "MSL-L001",
          `[[upstream.registry]] entry ${i}: missing required field 'id', 'api', 'resolved-manifest-hash', or 'markspec-schema'`,
        );
      }
      upstreams.push({
        kind: "registry",
        id,
        api,
        resolvedManifestHash,
        markspecSchema: markspecSchemaN,
      });
    }
  }

  const boundEntries: BoundEntry[] = [];
  const rawBoundEntries =
    (raw["bound-entry"] as readonly Record<string, unknown>[]) ?? [];
  for (let i = 0; i < rawBoundEntries.length; i++) {
    const be = rawBoundEntries[i];
    const displayId = requireString(be, "display-id");
    const ulid = requireString(be, "ulid");
    if (displayId === undefined || ulid === undefined) {
      return diag(
        "MSL-L001",
        `[[bound-entry]] entry ${i}: missing required field 'display-id' or 'ulid'`,
      );
    }
    const bindings: BoundEntryBinding[] = [];
    const rawBindings = (be.binding as readonly Record<string, unknown>[]) ??
      [];
    for (let j = 0; j < rawBindings.length; j++) {
      const b = rawBindings[j];
      const externalId = requireString(b, "external-id");
      const system = requireString(b, "system");
      const direction = requireString(b, "direction");
      if (
        externalId === undefined || system === undefined ||
        direction === undefined
      ) {
        return diag(
          "MSL-L001",
          `[[bound-entry.binding]] entry ${i}/${j}: missing required field 'external-id', 'system', or 'direction'`,
        );
      }
      const validDirections = new Set(["outbound", "inbound", "bidirectional"]);
      if (!validDirections.has(direction)) {
        return diag(
          "MSL-L001",
          `[[bound-entry.binding]] entry ${i}/${j}: invalid direction '${direction}' (expected outbound/inbound/bidirectional)`,
        );
      }
      const lockedRaw =
        (b["locked-attributes"] as Record<string, string> | undefined) ?? {};
      bindings.push({
        externalId,
        system,
        direction: direction as BoundEntryBinding["direction"],
        lockedAttributes: new Map(Object.entries(lockedRaw)),
      });
    }
    boundEntries.push({
      displayId,
      ulid,
      bindings,
    });
  }

  const edges: LockEdge[] = [];
  const rawEdges = (raw.edge as readonly Record<string, unknown>[]) ?? [];
  for (let i = 0; i < rawEdges.length; i++) {
    const e = rawEdges[i];
    const sourceUlid = requireString(e, "source-ulid");
    const relation = requireString(e, "relation");
    const authoredTarget = requireString(e, "authored-target");
    if (
      sourceUlid === undefined || relation === undefined ||
      authoredTarget === undefined
    ) {
      return diag(
        "MSL-L001",
        `[[edge]] entry ${i}: missing required field 'source-ulid', 'relation', or 'authored-target'`,
      );
    }
    const targetUlid = e["target-ulid"];
    edges.push({
      sourceUlid,
      relation,
      authoredTarget,
      ...(typeof targetUlid === "string" ? { targetUlid } : {}),
    });
  }

  const cache = raw["generated-cache"] as Record<string, unknown> | undefined;
  if (!cache) {
    return diag("MSL-L001", "Missing [generated-cache] table");
  }
  const edgesHash = requireString(cache, "edges-hash");
  const edgesCount = requireNumber(cache, "edges-count");
  if (edgesHash === undefined || edgesCount === undefined) {
    return diag(
      "MSL-L001",
      "[generated-cache]: missing or wrong-typed 'edges-hash' or 'edges-count'",
    );
  }

  const lockfile: Lockfile = {
    schema,
    meta: toolchain
      ? { markspecSchema, lockedAt, toolchain }
      : { markspecSchema, lockedAt },
    upstreams,
    boundEntries,
    edges,
    generatedCache: { edgesHash, edgesCount },
  };
  return { lockfile, diagnostics: [] };
}

/** Build a single-diagnostic failure result with no parsed lockfile. */
function diag(code: string, message: string): ParseLockfileResult {
  return {
    diagnostics: [{
      code,
      severity: "error",
      message,
      location: undefined,
    }],
  };
}

/**
 * Read a required string field from a TOML record. Returns the string when
 * present and well-typed, or `undefined` to signal the caller should emit a
 * diagnostic.
 */
function requireString(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = source[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Read a required number field from a TOML record. Returns the number when
 * present and well-typed, or `undefined` to signal the caller should emit a
 * diagnostic.
 */
function requireNumber(
  source: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = source[key];
  return typeof v === "number" ? v : undefined;
}
