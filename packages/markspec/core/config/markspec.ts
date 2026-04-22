/**
 * @module core/config/markspec
 *
 * Load and validate `.markspec.yaml` — the consumer-project binding that
 * declares which profiles the project uses.
 *
 * Emits diagnostics (MARKSPEC-YAML-*) on parse or schema errors. See
 * [spec §7.6](../../../../docs/superpowers/specs/2026-04-21-adr-008-profile-system-v1-design.md).
 */

import { parse as parseYaml } from "@std/yaml";
import { join } from "@std/path";
import type { Diagnostic, ProfileSpecifier } from "../model/mod.ts";
import type { ReadFile } from "./mod.ts";

/** The consumer-binding config filename, placed next to `project.yaml`. */
export const MARKSPEC_YAML_FILENAME = ".markspec.yaml";

/**
 * Read a `.markspec.yaml` file at the given project root.
 *
 * @param projectRoot - Absolute path to the directory containing `project.yaml`
 * @param readFile - File reader (returns `undefined` when missing)
 * @returns Raw file contents, or `null` when the file is absent
 */
export async function readMarkspecYaml(
  projectRoot: string,
  readFile: ReadFile,
): Promise<string | null> {
  const path = join(projectRoot, MARKSPEC_YAML_FILENAME);
  const content = await readFile(path);
  return content ?? null;
}

// ---------------------------------------------------------------------------
// Parsed .markspec.yaml shape
// ---------------------------------------------------------------------------

/** The parsed content of a `.markspec.yaml`. */
export interface MarkspecYaml {
  readonly profiles: readonly ProfileSpecifier[];
}

/** Result of parsing a `.markspec.yaml` string. */
export interface ParseMarkspecYamlResult {
  readonly config: MarkspecYaml | null;
  readonly diagnostics: readonly Diagnostic[];
}

const ALLOWED_MARKSPEC_YAML_KEYS = new Set(["profiles"]);

/**
 * Parse and validate a `.markspec.yaml` string.
 *
 * - `MARKSPEC-YAML-002` — YAML parse error.
 * - `MARKSPEC-YAML-003` — schema error (wrong type, bad specifier).
 * - `MARKSPEC-YAML-001` — unknown top-level key (warning; config still produced).
 */
export function parseMarkspecYaml(
  rawYaml: string,
  sourcePath: string,
): ParseMarkspecYamlResult {
  const diagnostics: Diagnostic[] = [];

  // Empty file is equivalent to `profiles: []`
  const trimmed = rawYaml.trim();
  if (trimmed.length === 0) {
    return { config: { profiles: [] }, diagnostics };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(rawYaml);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    diagnostics.push({
      code: "MARKSPEC-YAML-002",
      severity: "error",
      message: `.markspec.yaml: YAML parse error: ${message}`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { config: null, diagnostics };
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    diagnostics.push({
      code: "MARKSPEC-YAML-003",
      severity: "error",
      message: ".markspec.yaml must be a YAML mapping",
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { config: null, diagnostics };
  }

  const root = parsed as Record<string, unknown>;

  // Unknown keys — warn, but continue parsing.
  for (const key of Object.keys(root)) {
    if (!ALLOWED_MARKSPEC_YAML_KEYS.has(key)) {
      diagnostics.push({
        code: "MARKSPEC-YAML-001",
        severity: "warning",
        message: `.markspec.yaml: unknown top-level key '${key}'`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    }
  }

  const rawProfiles = root.profiles;
  if (rawProfiles !== undefined && !Array.isArray(rawProfiles)) {
    diagnostics.push({
      code: "MARKSPEC-YAML-003",
      severity: "error",
      message: ".markspec.yaml: 'profiles' must be a list",
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { config: null, diagnostics };
  }

  const profiles: ProfileSpecifier[] = [];
  if (Array.isArray(rawProfiles)) {
    for (let i = 0; i < rawProfiles.length; i++) {
      const spec = parseProfileSpecifier(
        rawProfiles[i],
        `.markspec.yaml: profiles[${i}]`,
        sourcePath,
        diagnostics,
      );
      if (spec) profiles.push(spec);
    }
  }

  // If any specifier failed to parse, treat the whole file as invalid.
  const hasErrors = diagnostics.some((d) => d.severity === "error");
  if (hasErrors) {
    return { config: null, diagnostics };
  }

  return { config: { profiles }, diagnostics };
}

/**
 * Parse a single specifier string into a {@linkcode ProfileSpecifier}.
 * Emits `MARKSPEC-YAML-003` on malformed input.
 */
function parseProfileSpecifier(
  raw: unknown,
  context: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): ProfileSpecifier | undefined {
  if (typeof raw !== "string" || raw.length === 0) {
    diagnostics.push({
      code: "MARKSPEC-YAML-003",
      severity: "error",
      message: `${context}: specifier must be a non-empty string`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  if (raw.startsWith("./") || raw.startsWith("../")) {
    return { kind: "local", path: raw };
  }
  if (raw.startsWith("git+")) {
    const m = /^git\+((?:https?|file):\/\/[^#]+?\.git)(\/[^#]+)?#(.+)$/.exec(
      raw,
    );
    if (!m) {
      diagnostics.push({
        code: "MARKSPEC-YAML-003",
        severity: "error",
        message:
          `${context}: git specifier malformed; expected git+<https|file>://host/.git[/subpath]#<tag>`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    const [, repo, rawSubpath, tag] = m;
    const subpath = rawSubpath ? rawSubpath.slice(1) : undefined;
    return { kind: "git", repo, subpath, tag };
  }
  diagnostics.push({
    code: "MARKSPEC-YAML-003",
    severity: "error",
    message:
      `${context}: unsupported specifier scheme (use './path' or 'git+<https|file>://…#<tag>')`,
    location: { file: sourcePath, line: 1, column: 1 },
  });
  return undefined;
}
