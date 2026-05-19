/**
 * @module core/profile/load
 *
 * The CLI-facing profile loader. Discovers `.markspec.yaml`, validates it,
 * resolves the active profile specifier, loads the chain, and surfaces any
 * diagnostics. Single entry point consumed by every profile-aware `markspec`
 * subcommand.
 */

import { join } from "@std/path";
import {
  MARKSPEC_YAML_FILENAME,
  parseMarkspecYaml,
  readMarkspecYaml,
} from "../config/markspec.ts";
import type { ReadFile } from "../config/mod.ts";
import type { Diagnostic, ProfileChain } from "../model/mod.ts";
import { CORE_TYPES } from "../model/mod.ts";
import { loadChain } from "./chain.ts";
import { BUILTIN_DEFAULT_SPECIFIER } from "./default_profile.ts";

/** Result of `loadProfileForCommand`. */
export interface LoadProfileForCommandResult {
  /** The active profile chain, or `null` when no profile is declared / resolvable. */
  readonly chain: ProfileChain | null;
  /** All diagnostics gathered during loading. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Load the active profile chain for the project at `projectRoot`.
 *
 * Discovery: looks for `.markspec.yaml` at the project root (sibling of
 * `project.yaml`). Absent or empty → the bundled default profile is the
 * sole chain tier, unless `.markspec.yaml` sets `default-profile: false`
 * (then `chain: null`, core-only mode).
 *
 * v1 constraint: at most **one** content-bearing profile per project. Two or
 * more entries in `profiles:` produces `PROFILE-LOAD-006` and no chain.
 */
export async function loadProfileForCommand(
  projectRoot: string,
  readFile: ReadFile,
): Promise<LoadProfileForCommandResult> {
  const diagnostics: Diagnostic[] = [];

  const rawYaml = await readMarkspecYaml(projectRoot, readFile);
  if (rawYaml === null) {
    // No .markspec.yaml — the default is active (no file to opt out in).
    return await loadBuiltinOnlyChain(projectRoot, readFile, diagnostics);
  }

  const sourcePath = join(projectRoot, MARKSPEC_YAML_FILENAME);
  const parsed = parseMarkspecYaml(rawYaml, sourcePath);
  diagnostics.push(...parsed.diagnostics);
  if (!parsed.config) {
    return { chain: null, diagnostics };
  }

  const { profiles, defaultProfile } = parsed.config;
  const bundledDefault = defaultProfile !== false;
  if (profiles.length === 0) {
    return bundledDefault
      ? await loadBuiltinOnlyChain(projectRoot, readFile, diagnostics)
      : { chain: null, diagnostics };
  }

  if (profiles.length > 1) {
    diagnostics.push({
      code: "PROFILE-LOAD-006",
      severity: "error",
      message: `.markspec.yaml declares ${profiles.length} profiles; ` +
        "v1 accepts at most one content-bearing profile per project",
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { chain: null, diagnostics };
  }

  const chainResult = await loadChain(
    profiles[0],
    projectRoot,
    projectRoot,
    readFile,
    { bundledDefault },
  );
  diagnostics.push(...chainResult.diagnostics);

  // MSL-A040 — profile must not redefine reserved core keys / types.
  if (chainResult.chain) {
    diagnostics.push(...checkReservedRedefinitions(chainResult.chain));
  }
  return { chain: chainResult.chain, diagnostics };
}

/**
 * Build a chain containing only the bundled default profile. Used when no
 * project profile is declared but the default is not opted out.
 */
async function loadBuiltinOnlyChain(
  projectRoot: string,
  readFile: ReadFile,
  diagnostics: Diagnostic[],
): Promise<LoadProfileForCommandResult> {
  const chainResult = await loadChain(
    BUILTIN_DEFAULT_SPECIFIER,
    projectRoot,
    projectRoot,
    readFile,
    { bundledDefault: true },
  );
  diagnostics.push(...chainResult.diagnostics);
  if (chainResult.chain) {
    diagnostics.push(...checkReservedRedefinitions(chainResult.chain));
  }
  return { chain: chainResult.chain, diagnostics };
}

/**
 * Reserved attribute names a profile must never declare. Per spec
 * §4.4 MSL-A040 and ADR-009 §6: the identity slot (`Id`) and the
 * type attribute (`Type`) are the absolutely reserved keys; their
 * meaning is fixed by the core and any profile redefinition would
 * silently break shape discrimination or type resolution.
 */
const RESERVED_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  "Id",
  "Type",
]);

/**
 * Scan the loaded profile chain for declarations that shadow core
 * reserved names and emit MSL-A040 diagnostics. The check inspects:
 *
 *   - universal `attributes:` scope,
 *   - per-shape `identified.attributes:` and `referenced.attributes:`,
 *   - every per-type `attributes:` map under `types:`,
 *   - each declared type name itself (must not match a core type).
 */
function checkReservedRedefinitions(chain: ProfileChain): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const effective = chain.effective;

  // Build origin → sourcePath index from the chain's tiers so diagnostics
  // can point at the manifest file that introduced each declaration.
  const originToPath = new Map<string, string>();
  for (const tier of chain.tiers) {
    originToPath.set(tier.id, tier.sourcePath);
  }
  // Fallback file when an origin somehow isn't in the tier list.
  const fallbackPath = chain.tiers[0]?.sourcePath ?? "<profile>";

  function pathFor(origin: string): string {
    return originToPath.get(origin) ?? fallbackPath;
  }

  function checkAttrMap(
    map: ReadonlyMap<string, { origin: string }>,
    scope: string,
  ): void {
    for (const [key, entry] of map) {
      if (RESERVED_ATTRIBUTE_KEYS.has(key)) {
        diagnostics.push({
          code: "MSL-A040",
          severity: "error",
          message: `profile ${scope} attribute '${key}' shadows a core ` +
            `reserved key (spec §4.4, ADR-009 §6); choose a different name`,
          location: { file: pathFor(entry.origin), line: 1, column: 1 },
        });
      }
    }
  }

  checkAttrMap(effective.attributes, "universal");
  for (const [typeName, typeEntry] of effective.types) {
    checkAttrMap(typeEntry.value.attributes, `type '${typeName}'`);
    if (CORE_TYPES.has(typeName)) {
      diagnostics.push({
        code: "MSL-A040",
        severity: "error",
        message: `profile type '${typeName}' shadows a core type name ` +
          `(spec §4.4); the 15-type core vocabulary is reserved`,
        location: { file: pathFor(typeEntry.origin), line: 1, column: 1 },
      });
    }
  }
  return diagnostics;
}
