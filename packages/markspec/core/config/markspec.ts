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
  if (raw.startsWith("npm:")) {
    // npm:@scope/name@range or npm:name@range
    const body = raw.slice(4); // strip "npm:"
    const scopedMatch = /^(@[a-z0-9-]+\/[a-z0-9-]+)@(.+)$/.exec(body);
    if (scopedMatch) {
      const [, fullName, range] = scopedMatch;
      const slashIdx = fullName.indexOf("/");
      return {
        kind: "npm",
        scope: fullName.slice(0, slashIdx),
        name: fullName.slice(slashIdx + 1),
        range,
      };
    }
    const unscopedMatch = /^([a-z0-9-]+)@(.+)$/.exec(body);
    if (unscopedMatch) {
      const [, name, range] = unscopedMatch;
      return { kind: "npm", name, range };
    }
    diagnostics.push({
      code: "MARKSPEC-YAML-003",
      severity: "error",
      message:
        `${context}: npm specifier malformed; expected npm:[@scope/]name@<version-range>`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  diagnostics.push({
    code: "MARKSPEC-YAML-003",
    severity: "error",
    message:
      `${context}: unsupported specifier scheme (use './path', 'git+<https|file>://…#<tag>', or 'npm:[@scope/]name@<range>')`,
    location: { file: sourcePath, line: 1, column: 1 },
  });
  return undefined;
}

/** Injectable file writer for addProfileSpecifier. */
export type WriteFile = (path: string, content: string) => Promise<void>;

/**
 * Append a profile specifier to `.markspec.yaml`.
 *
 * - File absent: creates with `profiles:\n  - <specifier>\n`.
 * - File exists with `profiles:` key: appends after the last list entry.
 * - File exists without `profiles:` key: appends the block at end of file.
 *
 * Uses raw string manipulation to preserve user comments and formatting.
 */
export async function addProfileSpecifier(
  specifier: string,
  readFileFn: ReadFile,
  writeFileFn: WriteFile,
  projectRoot: string,
): Promise<void> {
  const filePath = join(projectRoot, MARKSPEC_YAML_FILENAME);
  const existing = await readFileFn(filePath);

  if (existing === undefined) {
    await writeFileFn(filePath, `profiles:\n  - "${specifier}"\n`);
    return;
  }

  const profilesIdx = existing.indexOf("profiles:");
  if (profilesIdx === -1) {
    const trailing = existing.endsWith("\n") ? "" : "\n";
    await writeFileFn(
      filePath,
      existing + trailing + `\nprofiles:\n  - "${specifier}"\n`,
    );
    return;
  }

  const lines = existing.split("\n");
  let lastEntryLine = -1;
  let inProfiles = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("profiles:")) {
      inProfiles = true;
      continue;
    }
    if (inProfiles) {
      if (/^\s+-\s/.test(lines[i])) {
        lastEntryLine = i;
      } else if (
        lines[i].trim().length > 0 && !lines[i].startsWith(" ") &&
        !lines[i].startsWith("#")
      ) {
        break;
      }
    }
  }

  if (lastEntryLine >= 0) {
    lines.splice(lastEntryLine + 1, 0, `  - "${specifier}"`);
  } else {
    const profilesLine = lines.findIndex((l) =>
      l.trimStart().startsWith("profiles:")
    );
    lines.splice(profilesLine + 1, 0, `  - "${specifier}"`);
  }

  await writeFileFn(filePath, lines.join("\n"));
}
