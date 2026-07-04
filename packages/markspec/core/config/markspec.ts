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
import { dirname, join, resolve } from "@std/path";
import type {
  CaptionConventions,
  CaptionPosition,
  Diagnostic,
  ProfileSpecifier,
} from "../model/mod.ts";
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

/**
 * Walk up from `startDir` to the filesystem root looking for a
 * `.markspec.yaml` activator (ADR-008). Returns the absolute path to the
 * directory containing it, or `undefined` when none is found.
 *
 * This is the membership test for "is this a MarkSpec project?". Unlike
 * {@linkcode discoverProjectRoot}, which keys on `project.yaml`, a project
 * is considered MarkSpec-activated only by the presence of a
 * `.markspec.yaml` (per ADR-008): the LSP server uses this to stay inert —
 * no `.markspec/` runtime directory or event log — in a plain Markdown or
 * source repo (issue #609).
 *
 * @param startDir - Directory to begin the upward walk from (typically the
 *   workspace root the editor opened).
 * @param readFile - File reader returning `undefined` for missing paths.
 */
export async function discoverMarkspecRoot(
  startDir: string,
  readFile: ReadFile,
): Promise<string | undefined> {
  let current = resolve(startDir);
  for (;;) {
    const candidate = join(current, MARKSPEC_YAML_FILENAME);
    const content = await readFile(candidate);
    if (content !== undefined) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

// ---------------------------------------------------------------------------
// Parsed .markspec.yaml shape
// ---------------------------------------------------------------------------

/** The parsed content of a `.markspec.yaml`. */
export interface MarkspecYaml {
  readonly profiles: readonly ProfileSpecifier[];
  /**
   * Opt out of the bundled default profile when explicitly `false`.
   * `undefined` (key absent) means the default is active.
   */
  readonly defaultProfile?: boolean;
  /**
   * Gitignore-syntax patterns excluded from project file discovery,
   * anchored at the project root (e.g. `["skills/", "*.gen.md"]`).
   * Applied after `.gitignore` rules by `core/discovery`. Defaults to
   * `[]` when the key is absent.
   */
  readonly exclude: readonly string[];
  /**
   * Per-keyword caption-position conventions (spec §4.7 MSL-C072).
   * Defaults to `{}` when the key is absent.
   */
  readonly captionConventions: CaptionConventions;
}

/** Result of parsing a `.markspec.yaml` string. */
export interface ParseMarkspecYamlResult {
  readonly config: MarkspecYaml | null;
  readonly diagnostics: readonly Diagnostic[];
}

export const ALLOWED_MARKSPEC_YAML_KEYS = new Set([
  "$schema",
  "profiles",
  "default-profile",
  "exclude",
  "caption-conventions",
]);

/** Valid `caption-conventions` keywords (spec §4.7 MSL-C072). */
const VALID_CAPTION_KEYWORDS = new Set([
  "Figure",
  "Table",
  "Listing",
  "Feature",
  "Equation",
  "List",
]);

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
    return {
      config: { profiles: [], exclude: [], captionConventions: {} },
      diagnostics,
    };
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

  // default-profile: optional boolean opt-out for the bundled default.
  let defaultProfile: boolean | undefined;
  const rawDefaultProfile = root["default-profile"];
  if (rawDefaultProfile !== undefined) {
    if (typeof rawDefaultProfile !== "boolean") {
      diagnostics.push({
        code: "MARKSPEC-YAML-003",
        severity: "error",
        message: ".markspec.yaml: 'default-profile' must be a boolean",
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return { config: null, diagnostics };
    }
    defaultProfile = rawDefaultProfile;
  }

  // exclude: optional string[] of gitignore-syntax patterns.
  let exclude: readonly string[] = [];
  const rawExclude = root.exclude;
  if (rawExclude !== undefined && rawExclude !== null) {
    if (!Array.isArray(rawExclude)) {
      diagnostics.push({
        code: "MARKSPEC-YAML-003",
        severity: "error",
        message:
          `.markspec.yaml: 'exclude' expected array, got ${typeof rawExclude}`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    } else {
      const bad = rawExclude.findIndex(
        (v: unknown) => typeof v !== "string" || v === "",
      );
      if (bad !== -1) {
        diagnostics.push({
          code: "MARKSPEC-YAML-003",
          severity: "error",
          message:
            `.markspec.yaml: 'exclude[${bad}]': each exclude pattern must be a non-empty string`,
          location: { file: sourcePath, line: 1, column: 1 },
        });
      } else {
        exclude = rawExclude as string[];
      }
    }
  }

  // caption-conventions: optional mapping of keyword → "above" | "below".
  let captionConventions: CaptionConventions = {};
  const rawCaptionConventions = root["caption-conventions"];
  if (rawCaptionConventions !== undefined && rawCaptionConventions !== null) {
    if (
      typeof rawCaptionConventions !== "object" ||
      Array.isArray(rawCaptionConventions)
    ) {
      diagnostics.push({
        code: "MARKSPEC-YAML-003",
        severity: "error",
        message:
          `.markspec.yaml: 'caption-conventions' expected a mapping of caption-keyword: above|below, got ${
            Array.isArray(rawCaptionConventions)
              ? "array"
              : typeof rawCaptionConventions
          }`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    } else {
      const rawMap = rawCaptionConventions as Record<string, unknown>;
      const parsedConventions: Record<string, CaptionPosition> = {};
      let badKey: string | undefined;
      const captionErrsBefore = diagnostics.length;
      for (const [kw, pos] of Object.entries(rawMap)) {
        if (!VALID_CAPTION_KEYWORDS.has(kw)) {
          badKey = kw;
          break;
        }
        if (pos !== "above" && pos !== "below") {
          diagnostics.push({
            code: "MARKSPEC-YAML-003",
            severity: "error",
            message:
              `.markspec.yaml: 'caption-conventions.${kw}' expected "above" or "below", got ${
                JSON.stringify(pos)
              }`,
            location: { file: sourcePath, line: 1, column: 1 },
          });
          continue;
        }
        parsedConventions[kw] = pos as CaptionPosition;
      }
      if (badKey !== undefined) {
        diagnostics.push({
          code: "MARKSPEC-YAML-003",
          severity: "error",
          message:
            `.markspec.yaml: 'caption-conventions.${badKey}': unknown caption keyword '${badKey}'; valid keywords: ${
              [...VALID_CAPTION_KEYWORDS].join(", ")
            }`,
          location: { file: sourcePath, line: 1, column: 1 },
        });
      }
      if (diagnostics.length === captionErrsBefore) {
        captionConventions = parsedConventions;
      }
    }
  }

  // If any specifier failed to parse, treat the whole file as invalid.
  const hasErrors = diagnostics.some((d) => d.severity === "error");
  if (hasErrors) {
    return { config: null, diagnostics };
  }

  return {
    config: { profiles, defaultProfile, exclude, captionConventions },
    diagnostics,
  };
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

// ---------------------------------------------------------------------------
// Tool config — the markspec-tool-specific slice of `.markspec.yaml`
// ---------------------------------------------------------------------------

/**
 * The markspec-tool configuration read from `.markspec.yaml`: file-
 * discovery exclusions and caption-position conventions. Distinct from
 * {@linkcode MarkspecYaml}'s `profiles` / `defaultProfile` fields, which
 * drive profile-chain resolution rather than tool behavior.
 */
export interface ToolConfig {
  readonly exclude: readonly string[];
  readonly captionConventions: CaptionConventions;
}

/** Defaults used when `.markspec.yaml` is absent or carries neither key. */
export const DEFAULT_TOOL_CONFIG: ToolConfig = {
  exclude: [],
  captionConventions: {},
};

/**
 * Load the markspec tool config (`exclude`, `caption-conventions`) from
 * `.markspec.yaml` at `projectRoot`.
 *
 * An absent file, or one that parses to a `null` config (a schema or YAML
 * error — see {@linkcode parseMarkspecYaml}), yields
 * {@linkcode DEFAULT_TOOL_CONFIG}; callers inspect the returned
 * diagnostics to decide whether that default is acceptable or fatal.
 */
export async function loadToolConfig(
  projectRoot: string,
  readFile: ReadFile,
): Promise<{ config: ToolConfig; diagnostics: readonly Diagnostic[] }> {
  const rawYaml = await readMarkspecYaml(projectRoot, readFile);
  if (rawYaml === null) {
    return { config: DEFAULT_TOOL_CONFIG, diagnostics: [] };
  }

  const sourcePath = join(projectRoot, MARKSPEC_YAML_FILENAME);
  const { config, diagnostics } = parseMarkspecYaml(rawYaml, sourcePath);
  if (config === null) {
    return { config: DEFAULT_TOOL_CONFIG, diagnostics };
  }
  return {
    config: {
      exclude: config.exclude,
      captionConventions: config.captionConventions,
    },
    diagnostics,
  };
}
