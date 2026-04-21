/**
 * @module core/profile/manifest
 *
 * Parse a markspec.yaml manifest string into a validated ProfileManifest.
 * Emits PROFILE-LOAD-002 for YAML parse errors and PROFILE-LOAD-003 for
 * schema violations.
 */

import { parse as parseYaml } from "@std/yaml";
import type { Diagnostic, ProfileManifest } from "../model/mod.ts";

/** Result of parsing a profile manifest. */
export interface ParseManifestResult {
  readonly manifest: ProfileManifest | null;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Parse and validate a raw markspec.yaml string.
 *
 * @param rawYaml - File contents as a UTF-8 string
 * @param sourcePath - Optional file path for diagnostic location
 */
export function parseManifest(
  rawYaml: string,
  sourcePath = "<markspec.yaml>",
): ParseManifestResult {
  const diagnostics: Diagnostic[] = [];

  let parsed: unknown;
  try {
    parsed = parseYaml(rawYaml);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    diagnostics.push({
      code: "PROFILE-LOAD-002",
      severity: "error",
      message: `YAML parse error: ${message}`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { manifest: null, diagnostics };
  }

  if (parsed == null || typeof parsed !== "object") {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: "manifest must be a YAML mapping",
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { manifest: null, diagnostics };
  }

  const root = parsed as Record<string, unknown>;
  const id = requireString(root, "id", sourcePath, diagnostics);
  const version = requireString(root, "version", sourcePath, diagnostics);

  if (id === undefined || version === undefined) {
    return { manifest: null, diagnostics };
  }

  const manifest: ProfileManifest = {
    id,
    version,
    description: typeof root.description === "string"
      ? root.description
      : undefined,
    license: typeof root.license === "string" ? root.license : undefined,
    extends: undefined, // parsed in later task
    universalRequired: [],
    universalAttributes: [],
    labels: [],
    identified: { required: [], attributes: [], traceability: new Map() },
    referenced: { required: [], attributes: [] },
    types: new Map(),
    documents: { types: [], frontMatter: [] },
  };

  return { manifest, diagnostics };
}

function requireString(
  root: Record<string, unknown>,
  key: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): string | undefined {
  const v = root[key];
  if (typeof v !== "string" || v.length === 0) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `manifest missing required field '${key}' (string)`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  return v;
}
