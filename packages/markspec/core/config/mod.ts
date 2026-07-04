/**
 * @module config
 *
 * Project discovery and configuration loading. Walks up from CWD to
 * find `project.yaml`, parses the YAML, and validates the schema.
 */

import { parse as parseYaml } from "@std/yaml";
import { dirname, join, resolve } from "@std/path";
import {
  ConfigError,
  type ConfigFieldError,
  DEFAULT_PROJECT_CONFIG,
  type ProjectConfig,
  type ProjectRef,
} from "../model/mod.ts";

/** The config file name used as the project root marker. */
export const CONFIG_FILE_NAME = "project.yaml";

/** Result of loading a project configuration. */
export interface LoadConfigResult {
  /** The parsed and validated configuration. */
  readonly config: ProjectConfig;
  /** Absolute path to the project root directory. */
  readonly projectRoot: string;
  /** Absolute path to the `project.yaml` file. */
  readonly configPath: string;
}

/** A function that reads a file and returns its content, or `undefined` if not found. */
export type ReadFile = (path: string) => Promise<string | undefined>;

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Walk up from `startDir` to the filesystem root looking for `project.yaml`.
 *
 * @returns Absolute path to the directory containing `project.yaml`,
 *          or `undefined` if not found.
 */
export async function discoverProjectRoot(
  startDir: string,
  readFile: ReadFile,
): Promise<string | undefined> {
  let current = resolve(startDir);
  for (;;) {
    const candidate = join(current, CONFIG_FILE_NAME);
    const content = await readFile(candidate);
    if (content !== undefined) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

// ---------------------------------------------------------------------------
// Parsing and validation
// ---------------------------------------------------------------------------

/** Escape special regex characters for safe interpolation into RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Find the 1-based line number where `^fieldName:` appears in raw YAML. */
function findLineNumber(
  rawYaml: string,
  fieldName: string,
): number | undefined {
  const pattern = new RegExp(`^${escapeRegex(fieldName)}\\s*:`, "m");
  const match = pattern.exec(rawYaml);
  if (!match) return undefined;
  return rawYaml.slice(0, match.index).split("\n").length;
}

/** `name:` must be lowercase, start with a letter, and contain only
 * letters, digits, `.`, and `-` (org project schema). */
const NAME_PATTERN = /^[a-z][a-z0-9.-]*$/;

/**
 * Org keys `project.yaml` accepts but never parses or acts on — free-form
 * classification/metadata fields owned by the org schema, not MarkSpec.
 */
const ORG_INERT_KEYS = new Set([
  "$schema",
  "category",
  "description",
  "license",
  "keywords",
  "labels",
  "authors",
  "homepage",
  "bugs",
  "repository",
  "upstream",
  "process",
  "classification",
  "metadata",
]);

/** Keys `parseProjectConfig` actually parses into `ProjectConfig`. */
const PARSED_KEYS = new Set(["name", "version", "dependencies", "references"]);

/**
 * Keys retired or relocated by the Task 8 closed-schema flip. Present only
 * to produce an actionable migration message; the key itself is never
 * accepted.
 */
const MIGRATED_KEY_HINTS: Readonly<Record<string, string>> = {
  "exclude": "has moved to .markspec.yaml (markspec tool config)",
  "caption-conventions": "has moved to .markspec.yaml (markspec tool config)",
  "parents": "is retired — declare a 'references:' projectRef instead",
  "parent-fallback": "is retired — declare a 'references:' projectRef instead",
};

/**
 * Parse a YAML string and validate it as a MarkSpec project configuration.
 *
 * @param yaml - Raw YAML content
 * @param filePath - Path to the file (for error messages)
 * @returns Validated `ProjectConfig`
 * @throws {ConfigError} on invalid content
 */
export function parseProjectConfig(
  yaml: string,
  filePath: string,
): ProjectConfig {
  // Parse YAML
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (err) {
    throw new ConfigError(filePath, [
      {
        field: "(syntax)",
        message: err instanceof Error ? err.message : String(err),
        line: undefined,
      },
    ]);
  }

  // Must be a plain object
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError(filePath, [
      {
        field: "(root)",
        message: "expected a YAML mapping, got " +
          (raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw),
        line: undefined,
      },
    ]);
  }

  const obj = raw as Record<string, unknown>;
  const errors: ConfigFieldError[] = [];

  // name: required string, matching the org name pattern
  if (obj.name === undefined || obj.name === null || obj.name === "") {
    errors.push({
      field: "name",
      message: "required, must be a non-empty string",
      line: obj.name === undefined ? undefined : findLineNumber(yaml, "name"),
    });
  } else if (typeof obj.name !== "string") {
    errors.push({
      field: "name",
      message: `expected string, got ${typeof obj.name}`,
      line: findLineNumber(yaml, "name"),
    });
  } else if (!NAME_PATTERN.test(obj.name)) {
    errors.push({
      field: "name",
      message:
        "must match ^[a-z][a-z0-9.-]*$ (lowercase letters, digits, '.', '-'; starts with a letter)",
      line: findLineNumber(yaml, "name"),
    });
  }

  // version: required string (org project schema)
  let version = DEFAULT_PROJECT_CONFIG.version;
  if (
    obj.version !== undefined && obj.version !== null && obj.version !== ""
  ) {
    if (typeof obj.version === "number") {
      console.error(
        `warning: ${filePath}: version is a number (${obj.version}), ` +
          `coerced to "${String(obj.version)}". ` +
          `Quote it in YAML: version: "${obj.version}"`,
      );
    }
    version = String(obj.version);
  } else {
    errors.push({
      field: "version",
      message: "version is required (org project schema)",
      line: undefined,
    });
  }

  // dependencies / references: optional projectRef[] (org project-manifest)
  const dependencies = parseProjectRefList(
    obj["dependencies"],
    "dependencies",
    yaml,
    errors,
  );
  const references = parseProjectRefList(
    obj["references"],
    "references",
    yaml,
    errors,
  );

  // Closed-schema key classifier: every key must be one this parser reads
  // (PARSED_KEYS), an org-owned free-form field MarkSpec ignores
  // (ORG_INERT_KEYS), or a migrated/retired key with an actionable hint
  // (MIGRATED_KEY_HINTS). Anything else is unknown to the closed schema.
  for (const key of Object.keys(obj)) {
    if (PARSED_KEYS.has(key) || ORG_INERT_KEYS.has(key)) continue;
    const hint = MIGRATED_KEY_HINTS[key];
    errors.push({
      field: key,
      message: hint !== undefined
        ? `'${key}' ${hint}`
        : `unknown key '${key}' (project.yaml follows the closed org schema ` +
          `https://driftsys.github.io/schemas/project/v1.json)`,
      line: findLineNumber(yaml, key),
    });
  }

  if (errors.length > 0) {
    throw new ConfigError(filePath, errors);
  }

  return {
    name: obj.name as string,
    version,
    dependencies,
    references,
  };
}

// ---------------------------------------------------------------------------
// projectRef parsing (org project-manifest contract: dependencies/references)
// ---------------------------------------------------------------------------

/** Safe upstream id: single path segment, no separators or traversal. */
const PROJECT_REF_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const PROJECT_REF_KEYS = new Set(["url", "version", "name"]);

/**
 * Parse a `dependencies:` or `references:` list of projectRef objects
 * (`{ url (required), version?, name? }`). Pushes field errors onto
 * `errors` and returns whatever refs parsed cleanly; the caller throws
 * once all fields have been checked, so a single invalid entry doesn't
 * mask other unrelated errors.
 */
function parseProjectRefList(
  value: unknown,
  field: "dependencies" | "references",
  yaml: string,
  errors: ConfigFieldError[],
): ProjectRef[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push({
      field,
      message:
        "must be a list of projectRef objects ({ url, version?, name? })",
      line: findLineNumber(yaml, field),
    });
    return [];
  }
  const out: ProjectRef[] = [];
  value.forEach((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      errors.push({
        field: `${field}[${i}]`,
        message: "must be a mapping with a required 'url' key",
        line: findLineNumber(yaml, field),
      });
      return;
    }
    const record = item as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!PROJECT_REF_KEYS.has(key)) {
        errors.push({
          field: `${field}[${i}]`,
          message:
            `unknown projectRef key '${key}' (allowed: url, version, name)`,
          line: findLineNumber(yaml, key),
        });
      }
    }
    const url = record.url;
    if (typeof url !== "string" || url.length === 0) {
      errors.push({
        field: `${field}[${i}].url`,
        message: "projectRef requires a non-empty 'url' string",
        line: findLineNumber(yaml, field),
      });
      return;
    }
    const ref: { url: string; version?: string; name?: string } = { url };
    if (record.version !== undefined) {
      if (typeof record.version !== "string" || record.version.length === 0) {
        errors.push({
          field: `${field}[${i}].version`,
          message: "must be a non-empty string when present",
          line: findLineNumber(yaml, field),
        });
      } else {
        ref.version = record.version;
      }
    }
    if (record.name !== undefined) {
      if (
        typeof record.name !== "string" ||
        !PROJECT_REF_NAME_RE.test(record.name)
      ) {
        errors.push({
          field: `${field}[${i}].name`,
          message:
            "must match [A-Za-z0-9][A-Za-z0-9._-]* (used as a cache directory name)",
          line: findLineNumber(yaml, field),
        });
      } else {
        ref.name = record.name;
      }
    }
    out.push(ref);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Domain derivation
// ---------------------------------------------------------------------------

/**
 * Derive a 3-6 letter project domain abbreviation from the project name.
 */
export function deriveDomain(projectName: string): string {
  const lastSegment = projectName.split(".").pop() ?? projectName;
  const words = lastSegment.split(/[-_]+/).filter((w) => w.length > 0);
  if (words.length === 0) {
    return "XXXXX";
  }
  const charsPerWord = Math.ceil(6 / words.length);
  const abbrev = words
    .map((word) => word.slice(0, charsPerWord).toUpperCase())
    .join("");
  if (abbrev.length >= 3 && abbrev.length <= 6) {
    return abbrev;
  } else if (abbrev.length > 6) {
    return abbrev.slice(0, 6);
  } else {
    return (abbrev + "XXXXXX").slice(0, 6);
  }
}

// ---------------------------------------------------------------------------
// Combined load
// ---------------------------------------------------------------------------

/**
 * Discover `project.yaml` by walking up from `startDir`, load, and validate.
 *
 * @returns `LoadConfigResult` if found and valid, `undefined` if not found.
 * @throws {ConfigError} if `project.yaml` exists but is invalid.
 */
export async function loadConfig(
  startDir: string,
  readFile: ReadFile,
): Promise<LoadConfigResult | undefined> {
  const root = await discoverProjectRoot(startDir, readFile);
  if (root === undefined) return undefined;

  const configPath = join(root, CONFIG_FILE_NAME);
  const content = await readFile(configPath);
  if (content === undefined) return undefined;

  const config = parseProjectConfig(content, configPath);
  return { config, projectRoot: root, configPath };
}
