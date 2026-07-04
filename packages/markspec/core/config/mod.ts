/**
 * @module config
 *
 * Project discovery and configuration loading. Walks up from CWD to
 * find `project.yaml`, parses the YAML, and validates the schema.
 */

import { parse as parseYaml } from "@std/yaml";
import { dirname, join, resolve } from "@std/path";
import {
  type CaptionConventions,
  type CaptionPosition,
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

  // caption-conventions: optional mapping of keyword → "above" | "below"
  let captionConventions: CaptionConventions =
    DEFAULT_PROJECT_CONFIG.captionConventions;
  const captionConventionsKey = "caption-conventions";
  if (
    obj[captionConventionsKey] !== undefined &&
    obj[captionConventionsKey] !== null
  ) {
    const raw = obj[captionConventionsKey];
    if (typeof raw !== "object" || Array.isArray(raw)) {
      errors.push({
        field: captionConventionsKey,
        message: `expected a mapping of caption-keyword: above|below, got ${
          Array.isArray(raw) ? "array" : typeof raw
        }`,
        line: findLineNumber(yaml, captionConventionsKey),
      });
    } else {
      const rawMap = raw as Record<string, unknown>;
      const VALID_KEYWORDS = new Set([
        "Figure",
        "Table",
        "Listing",
        "Feature",
        "Equation",
        "List",
      ]);
      const parsed: Record<string, CaptionPosition> = {};
      let badKey: string | undefined;
      const captionErrsBefore = errors.length;
      for (const [kw, pos] of Object.entries(rawMap)) {
        if (!VALID_KEYWORDS.has(kw)) {
          badKey = kw;
          break;
        }
        if (pos !== "above" && pos !== "below") {
          errors.push({
            field: `${captionConventionsKey}.${kw}`,
            message: `expected "above" or "below", got ${JSON.stringify(pos)}`,
            line: findLineNumber(yaml, captionConventionsKey),
          });
          continue;
        }
        parsed[kw] = pos as CaptionPosition;
      }
      if (badKey !== undefined) {
        errors.push({
          field: `${captionConventionsKey}.${badKey}`,
          message: `unknown caption keyword '${badKey}'; valid keywords: ${
            [...VALID_KEYWORDS].join(", ")
          }`,
          line: findLineNumber(yaml, captionConventionsKey),
        });
      }
      if (errors.length === captionErrsBefore) {
        captionConventions = parsed;
      }
    }
  }

  // exclude: optional string[] of gitignore-syntax patterns
  let exclude: readonly string[] = DEFAULT_PROJECT_CONFIG.exclude;
  if (obj.exclude !== undefined && obj.exclude !== null) {
    if (!Array.isArray(obj.exclude)) {
      errors.push({
        field: "exclude",
        message: `expected array, got ${typeof obj.exclude}`,
        line: findLineNumber(yaml, "exclude"),
      });
    } else {
      const bad = obj.exclude.findIndex(
        (v: unknown) => typeof v !== "string" || v === "",
      );
      if (bad !== -1) {
        errors.push({
          field: `exclude[${bad}]`,
          message: "each exclude pattern must be a non-empty string",
          line: findLineNumber(yaml, "exclude"),
        });
      } else {
        exclude = obj.exclude as string[];
      }
    }
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

  if (errors.length > 0) {
    throw new ConfigError(filePath, errors);
  }

  return {
    name: obj.name as string,
    version,
    labels,
    parents,
    parentFallback,
    captionConventions,
    exclude,
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
