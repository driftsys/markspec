/**
 * @module core/sync/mapping
 *
 * mapping.yaml schema + parser + cross-system validation. Defines how an
 * external system (Jira, DOORS, Polarion, …) binds onto MarkSpec entries:
 * which attributes flow which direction, conflict-resolution policy,
 * cache TTL.
 *
 * Diagnostic family is `MSL-S###`:
 *   - MSL-S001 — malformed YAML / unsupported schema
 *   - MSL-S002 — locked + outbound contradiction
 *   - MSL-S003 — unknown conflict policy (newest-wins removed pre-1.0)
 *   - MSL-S004 — system ≠ identity.external-id-scheme
 *   - MSL-S005 — unparseable cache.ttl
 *   - MSL-S020 — multi-system local-write conflict on same attribute
 */

import { parse as parseYaml } from "@std/yaml";
import type { Diagnostic } from "../model/mod.ts";

/** Sync flow direction. */
export type Direction = "outbound" | "inbound" | "bidirectional";

/** Conflict-resolution policy. `newest-wins` is intentionally absent. */
export type ConflictPolicy = "manual" | "local-wins" | "remote-wins";

/** One mapping row: MarkSpec attribute ↔ external attribute. */
export interface AttributeMapping {
  readonly markspec: string;
  readonly external: string;
  readonly direction: Direction;
  /** When true, the local MarkSpec attribute is read-only — external owns it. */
  readonly locked: boolean;
}

/** A fully validated mapping.yaml. */
export interface Mapping {
  readonly schema: number;
  readonly system: string;
  readonly direction: Direction;
  readonly identity: { readonly externalIdScheme: string };
  readonly attributes: readonly AttributeMapping[];
  readonly conflict: { readonly default: ConflictPolicy };
  readonly cache: { readonly ttlMs: number };
  /** Filesystem path the mapping was loaded from, for diagnostic locations. */
  readonly sourcePath: string;
}

/** Outcome of {@linkcode parseMapping}. */
export interface ParseMappingResult {
  readonly mapping?: Mapping;
  readonly diagnostics: readonly Diagnostic[];
}

const SUPPORTED_SCHEMA = 1;
const ALLOWED_POLICIES: ReadonlySet<string> = new Set([
  "manual",
  "local-wins",
  "remote-wins",
]);

/**
 * Parse and validate one mapping.yaml. Returns the model when valid, or
 * an MSL-S### diagnostic when not. Single-shot — stops at the first
 * integrity failure to keep the repair signal clear.
 */
export function parseMapping(
  yaml: string,
  sourcePath: string,
): ParseMappingResult {
  let raw: Record<string, unknown>;
  try {
    raw = parseYaml(yaml) as Record<string, unknown>;
  } catch (e) {
    return fail(
      "MSL-S001",
      `Malformed mapping.yaml: ${(e as Error).message}`,
      sourcePath,
    );
  }

  const schema = raw.schema;
  if (schema !== SUPPORTED_SCHEMA) {
    return fail(
      "MSL-S001",
      `Unsupported mapping schema: ${schema} (expected ${SUPPORTED_SCHEMA})`,
      sourcePath,
    );
  }

  const system = typeof raw.system === "string" ? raw.system : undefined;
  if (system === undefined) {
    return fail(
      "MSL-S001",
      "Missing or non-string `system` field",
      sourcePath,
    );
  }

  const direction = raw.direction;
  if (
    direction !== "outbound" && direction !== "inbound" &&
    direction !== "bidirectional"
  ) {
    return fail(
      "MSL-S001",
      `Invalid top-level direction '${direction}' (expected outbound/inbound/bidirectional)`,
      sourcePath,
    );
  }

  const identity = raw.identity as Record<string, unknown> | undefined;
  const scheme = identity?.["external-id-scheme"];
  if (typeof scheme !== "string") {
    return fail(
      "MSL-S001",
      "Missing identity.external-id-scheme",
      sourcePath,
    );
  }

  if (scheme !== system) {
    return fail(
      "MSL-S004",
      `system '${system}' does not match identity.external-id-scheme '${scheme}'`,
      sourcePath,
    );
  }

  const conflict = raw.conflict as Record<string, unknown> | undefined;
  const policy = conflict?.default as string | undefined;
  if (policy !== undefined && !ALLOWED_POLICIES.has(policy)) {
    return fail(
      "MSL-S003",
      `Unknown conflict policy '${policy}' (allowed: manual, local-wins, remote-wins; newest-wins removed pre-1.0)`,
      sourcePath,
    );
  }

  const cacheRaw = raw.cache as Record<string, unknown> | undefined;
  const ttlStr = (cacheRaw?.ttl as string | undefined) ?? "15m";
  const ttlMs = parseDurationMs(ttlStr);
  if (ttlMs === null) {
    return fail(
      "MSL-S005",
      `Unparseable cache.ttl '${ttlStr}' (expected: 15m, 1h, 7d etc.)`,
      sourcePath,
    );
  }

  const attrsRaw =
    (raw.attributes as readonly Record<string, unknown>[] | undefined) ?? [];
  const attributes: AttributeMapping[] = [];
  for (const a of attrsRaw) {
    const attrDir: Direction =
      (a.direction === "outbound" || a.direction === "inbound" ||
          a.direction === "bidirectional")
        ? a.direction
        : direction;
    const locked = a.locked === true;
    if (locked && attrDir === "outbound") {
      return fail(
        "MSL-S002",
        `Attribute '${a.markspec}': locked: true contradicts direction: outbound`,
        sourcePath,
      );
    }
    if (typeof a.markspec !== "string" || typeof a.external !== "string") {
      return fail(
        "MSL-S001",
        "Each attribute mapping requires string 'markspec' and 'external' fields",
        sourcePath,
      );
    }
    attributes.push({
      markspec: a.markspec,
      external: a.external,
      direction: attrDir,
      locked,
    });
  }

  const mapping: Mapping = {
    schema,
    system,
    direction,
    identity: { externalIdScheme: scheme },
    attributes,
    conflict: { default: (policy as ConflictPolicy | undefined) ?? "manual" },
    cache: { ttlMs },
    sourcePath,
  };
  return { mapping, diagnostics: [] };
}

/**
 * Cross-system validation: at most one system writes locally per attribute.
 * "Writes locally" = direction is `inbound` or `bidirectional`. Multiple
 * outbound writers on the same attribute are allowed (all push the same
 * local value).
 */
export function validateMappings(mappings: readonly Mapping[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const writersByAttr = new Map<string, string[]>();
  for (const m of mappings) {
    for (const a of m.attributes) {
      const writesLocally = a.direction === "inbound" ||
        a.direction === "bidirectional";
      if (!writesLocally) continue;
      const list = writersByAttr.get(a.markspec) ?? [];
      list.push(m.system);
      writersByAttr.set(a.markspec, list);
    }
  }
  for (const [attr, systems] of writersByAttr) {
    if (systems.length > 1) {
      diagnostics.push({
        code: "MSL-S020",
        severity: "error",
        message:
          `Multi-system local-write conflict on attribute '${attr}': systems ${
            systems.join(", ")
          } all write locally. At most one system may write any attribute locally.`,
        location: undefined,
      });
    }
  }
  return diagnostics;
}

/** Build a single-diagnostic failure result with file-level location. */
function fail(
  code: string,
  message: string,
  sourcePath: string,
): ParseMappingResult {
  return {
    diagnostics: [{
      code,
      severity: "error",
      message,
      location: { file: sourcePath, line: 1, column: 1 },
    }],
  };
}

/** Parse a duration suffix string (15m, 1h, 7d, 500ms) → milliseconds. */
function parseDurationMs(s: string): number | null {
  const m = s.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  switch (m[2]) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60 * 1000;
    case "h":
      return n * 60 * 60 * 1000;
    case "d":
      return n * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}
