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

  // name: required string
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
  }

  // version: optional string
  // version: optional string
  let version = DEFAULT_PROJECT_CONFIG.version;
  if (obj.version !== undefined && obj.version !== null) {
    if (typeof obj.version === "number") {
      console.error(
        `warning: ${filePath}: version is a number (${obj.version}), ` +
          `coerced to "${String(obj.version)}". ` +
          `Quote it in YAML: version: "${obj.version}"`,
      );
    }
    version = String(obj.version);
  }

  // labels: optional string[]
  let labels: readonly string[] = DEFAULT_PROJECT_CONFIG.labels;
  if (obj.labels !== undefined && obj.labels !== null) {
    if (!Array.isArray(obj.labels)) {
      errors.push({
        field: "labels",
        message: `expected array, got ${typeof obj.labels}`,
        line: findLineNumber(yaml, "labels"),
      });
    } else {
      const bad = obj.labels.findIndex(
        (v: unknown) => typeof v !== "string" || v === "",
      );
      if (bad !== -1) {
        errors.push({
          field: `labels[${bad}]`,
          message: "each label must be a non-empty string",
          line: findLineNumber(yaml, "labels"),
        });
      } else {
        labels = obj.labels as string[];
      }
    }
  }

  // parents: optional string[] of URLs
  let parents: readonly string[] = DEFAULT_PROJECT_CONFIG.parents;
  if (obj.parents !== undefined && obj.parents !== null) {
    if (!Array.isArray(obj.parents)) {
      errors.push({
        field: "parents",
        message: `expected array, got ${typeof obj.parents}`,
        line: findLineNumber(yaml, "parents"),
      });
    } else {
      const bad = obj.parents.findIndex(
        (v: unknown) => typeof v !== "string" || !isValidUrl(v),
      );
      if (bad !== -1) {
        errors.push({
          field: `parents[${bad}]`,
          message: "each parent must be a valid URL",
          line: findLineNumber(yaml, "parents"),
        });
      } else {
        parents = obj.parents as string[];
      }
    }
  }

  // parent-fallback: optional URL string
  let parentFallback = DEFAULT_PROJECT_CONFIG.parentFallback;
  const fallbackKey = "parent-fallback";
  if (obj[fallbackKey] !== undefined && obj[fallbackKey] !== null) {
    const val = obj[fallbackKey];
    if (typeof val !== "string" || !isValidUrl(val)) {
      errors.push({
        field: "parent-fallback",
        message: "must be a valid URL",
        line: findLineNumber(yaml, "parent-fallback"),
      });
    } else {
      parentFallback = val;
    }
  }

  if (errors.length > 0) {
    throw new ConfigError(filePath, errors);
  }

  return {
    name: obj.name as string,
    version,
    labels,
    parents,
    parentFallback,
  };
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
