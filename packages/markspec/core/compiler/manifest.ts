/**
 * @module compiler/manifest
 *
 * Builds the `manifest.json` object for the nextgen `/api/` directory output.
 * Tier 1 implements the small-project degenerate form: a single
 * `compiled.json` file pointed to by the manifest's `entries` and `edges`
 * indirection blocks.
 */

import { CORE_SCHEMA_VERSION } from "../model/mod.ts";
import type { EffectiveProfile, ProjectConfig } from "../model/mod.ts";
import type { CompileResult } from "./mod.ts";

/** Entries block in `manifest.json` — inline (Tier 1) or NDJSON (Tier 2). */
export type ManifestEntriesBlock =
  | { readonly format: "inline"; readonly file: string }
  | {
    readonly format: "ndjson";
    readonly file: string;
    readonly index: string;
  };

/** Edges block in `manifest.json` — inline (Tier 1) or NDJSON (Tier 2). */
export type ManifestEdgesBlock =
  | { readonly format: "inline"; readonly file: string }
  | { readonly format: "ndjson"; readonly file: string };

/** Version of the compile-output wire schema (`manifest.json` et al.). */
export const MANIFEST_SCHEMA_VERSION = 1;

/** `manifest.json` schema (spec §4.2). */
export interface ManifestJson {
  readonly markspecSchemaVersion: 1;
  readonly generator: {
    readonly release: string;
    readonly coreSchema: 1;
  };
  readonly project: {
    readonly name: string;
    readonly root: string;
    readonly version?: string;
  };
  readonly counts: {
    readonly entries: number;
    readonly edges: number;
    readonly byType: Readonly<Record<string, number>>;
  };
  readonly entries: ManifestEntriesBlock;
  readonly edges: ManifestEdgesBlock;
  readonly sqliteMirror: null;
  readonly federation: readonly string[];
  readonly reserved: Readonly<Record<string, never>>;
}

/**
 * Build the `manifest.json` object for a compiled project.
 *
 * When `streaming` is false (default): emits the Tier 1 inline form —
 * both `entries` and `edges` point at `compiled.json`.
 * When `streaming` is true: emits the Tier 2 NDJSON form —
 * entries → `entries.ndjson` + `entries.idx`, edges → `edges.ndjson`.
 */
export function buildManifest(
  result: CompileResult,
  config: ProjectConfig,
  projectRoot: string,
  _profile: EffectiveProfile | undefined,
  version: string,
  streaming = false,
): ManifestJson {
  const byType: Record<string, number> = {};
  for (const entry of result.entries.values()) {
    const typeName = entry.type ?? "unknown";
    byType[typeName] = (byType[typeName] ?? 0) + 1;
  }

  return {
    markspecSchemaVersion: MANIFEST_SCHEMA_VERSION,
    generator: {
      release: version,
      coreSchema: CORE_SCHEMA_VERSION,
    },
    project: {
      name: config.name ?? "",
      root: projectRoot,
      ...(config.version && config.version !== "0.0.0"
        ? { version: config.version }
        : {}),
    },
    counts: {
      entries: result.entries.size,
      edges: result.links.length,
      byType,
    },
    entries: streaming
      ? { format: "ndjson", file: "entries.ndjson", index: "entries.idx" }
      : { format: "inline", file: "compiled.json" },
    edges: streaming
      ? { format: "ndjson", file: "edges.ndjson" }
      : { format: "inline", file: "compiled.json" },
    sqliteMirror: null,
    federation: (config.references ?? []).map((r) => r.url),
    reserved: {},
  };
}
