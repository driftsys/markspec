/**
 * @module compiler/manifest
 *
 * Builds the `manifest.json` object for the nextgen `/api/` directory output.
 * Tier 1 implements the small-project degenerate form: a single
 * `compiled.json` file pointed to by the manifest's `entries` and `edges`
 * indirection blocks.
 */

import type { EffectiveProfile, ProjectConfig } from "../model/mod.ts";
import type { CompileResult } from "./mod.ts";

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
  };
  readonly counts: {
    readonly entries: number;
    readonly edges: number;
    readonly byType: Readonly<Record<string, number>>;
  };
  readonly entries: {
    readonly format: "inline";
    readonly file: string;
  };
  readonly edges: {
    readonly format: "inline";
    readonly file: string;
  };
  readonly sqliteMirror: null;
  readonly federation: readonly string[];
  readonly reserved: Readonly<Record<string, never>>;
}

/**
 * Build the `manifest.json` object for a compiled project.
 *
 * Tier 1 always emits the small-project degenerate form: both `entries` and
 * `edges` point at `compiled.json` with `format: "inline"`.
 */
export function buildManifest(
  result: CompileResult,
  config: ProjectConfig,
  projectRoot: string,
  _profile: EffectiveProfile | undefined,
  version: string,
): ManifestJson {
  const byType: Record<string, number> = {};
  for (const entry of result.entries.values()) {
    const typeName = entry.type ?? "unknown";
    byType[typeName] = (byType[typeName] ?? 0) + 1;
  }

  return {
    markspecSchemaVersion: 1,
    generator: {
      release: version,
      coreSchema: 1,
    },
    project: {
      name: config.name ?? "",
      root: projectRoot,
    },
    counts: {
      entries: result.entries.size,
      edges: result.links.length,
      byType,
    },
    entries: {
      format: "inline",
      file: "compiled.json",
    },
    edges: {
      format: "inline",
      file: "compiled.json",
    },
    sqliteMirror: null,
    federation: config.parents ?? [],
    reserved: {},
  };
}
