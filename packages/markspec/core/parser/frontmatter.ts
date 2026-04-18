/**
 * @module parser/frontmatter
 *
 * YAML front-matter parser per ADR-007.
 *
 * Extracts a `---`-delimited YAML block at the top of a Markdown file,
 * classifies keys into core / `metadata` / allowlisted ecosystem, and rejects
 * forbidden keys (MSL-D001). Returns a {@linkcode DocumentAttributes} record
 * and the markdown content with the front matter stripped.
 *
 * Full validation of core-key value types is deferred to the validator
 * (Phase 3); this module handles extraction and key-category classification.
 */

import { parse as parseYaml } from "@std/yaml";
import type { Diagnostic, DocumentAttributes } from "../model/mod.ts";

/**
 * YAML front-matter delimiter — `---` at start of file, closing `---`, then
 * any number of trailing newlines so the stripped markdown begins cleanly.
 * Empty YAML body (`---\n---\n`) is accepted.
 */
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)(?:\r?\n)?---\r?\n?(?:\r?\n)*/;

/**
 * Core document-level attribute keys per ADR-007. Kebab-case by convention.
 */
const CORE_KEYS: ReadonlySet<string> = new Set([
  "document-id",
  "document-type",
  "labels",
  "status",
  "external-id",
  "supersedes",
  "references",
  "metadata",
]);

/**
 * Keys forbidden in front matter per ADR-007 — already expressed natively in
 * Markdown (H1, body, images) or in git history (authors, dates).
 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "title",
  "description",
  "toc",
  "authors",
  "author",
  "date",
  "created",
  "modified",
  "cover",
  "images",
  "sections",
]);

/** Options for {@linkcode extractFrontMatter}. */
export interface ExtractFrontMatterOptions {
  /** File path used in diagnostic source locations. */
  readonly file?: string;
  /**
   * Profile-declared keys. Accepted alongside core keys, passed through on
   * {@linkcode FrontMatterResult.attributes.extra}.
   */
  readonly profileKeys?: readonly string[];
  /**
   * Allowlisted ecosystem keys from `.markspec.yaml`
   * (`frontMatter.allowedKeys`). Accepted and passed through on
   * {@linkcode FrontMatterResult.attributes.extra}.
   */
  readonly allowedKeys?: readonly string[];
}

/** Result of front-matter extraction. */
export interface FrontMatterResult {
  /** Parsed document attributes. Empty when no front matter is present. */
  readonly attributes: DocumentAttributes;
  /** Diagnostics (forbidden keys, unknown keys, YAML errors). */
  readonly diagnostics: readonly Diagnostic[];
  /** Markdown content with front matter stripped. */
  readonly markdown: string;
  /** Whether front matter was present. */
  readonly hadFrontMatter: boolean;
}

/**
 * Extract YAML front matter from a Markdown source, validate its keys, and
 * return structured attributes plus the stripped markdown.
 *
 * No front matter → {@linkcode FrontMatterResult.hadFrontMatter} is `false`
 * and attributes are empty.
 *
 * @param markdown - Full source text, including any leading front matter.
 * @param options - Key allowlists and file path for diagnostics.
 */
export function extractFrontMatter(
  markdown: string,
  options?: ExtractFrontMatterOptions,
): FrontMatterResult {
  const file = options?.file ?? "<unknown>";

  const match = FRONT_MATTER_RE.exec(markdown);
  if (!match) {
    return {
      attributes: {},
      diagnostics: [],
      markdown,
      hadFrontMatter: false,
    };
  }

  const yamlBody = match[1];
  const remaining = markdown.slice(match[0].length);
  const diagnostics: Diagnostic[] = [];

  let raw: unknown;
  try {
    raw = parseYaml(yamlBody);
  } catch (err) {
    diagnostics.push({
      code: "MSL-D001",
      severity: "error",
      message: `front matter: invalid YAML — ${
        err instanceof Error ? err.message : String(err)
      }`,
      location: { file, line: 1, column: 1 },
    });
    return {
      attributes: {},
      diagnostics,
      markdown: remaining,
      hadFrontMatter: true,
    };
  }

  if (raw == null) {
    return {
      attributes: {},
      diagnostics,
      markdown: remaining,
      hadFrontMatter: true,
    };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "MSL-D001",
      severity: "error",
      message: "front matter must be a YAML mapping",
      location: { file, line: 1, column: 1 },
    });
    return {
      attributes: {},
      diagnostics,
      markdown: remaining,
      hadFrontMatter: true,
    };
  }

  const entries = raw as Record<string, unknown>;
  const profileKeys = new Set(options?.profileKeys ?? []);
  const allowedKeys = new Set(options?.allowedKeys ?? []);

  const core: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  let metadata: Record<string, unknown> | undefined;

  for (const [key, value] of Object.entries(entries)) {
    if (FORBIDDEN_KEYS.has(key)) {
      diagnostics.push({
        code: "MSL-D001",
        severity: "error",
        message:
          `front matter key '${key}' is forbidden — express it in Markdown or git history instead`,
        location: { file, line: 1, column: 1 },
      });
      continue;
    }

    if (key === "metadata") {
      if (
        value == null || typeof value !== "object" || Array.isArray(value)
      ) {
        diagnostics.push({
          code: "MSL-D001",
          severity: "error",
          message: "front matter 'metadata' must be a mapping",
          location: { file, line: 1, column: 1 },
        });
        continue;
      }
      metadata = value as Record<string, unknown>;
      continue;
    }

    if (CORE_KEYS.has(key)) {
      core[key] = value;
      continue;
    }

    if (profileKeys.has(key) || allowedKeys.has(key)) {
      extra[key] = value;
      continue;
    }

    diagnostics.push({
      code: "MSL-D001",
      severity: "error",
      message:
        `unknown front matter key '${key}' — must be core, profile-declared, 'metadata', or allowlisted in .markspec.yaml`,
      location: { file, line: 1, column: 1 },
    });
  }

  const attributes: DocumentAttributes = {};
  const mutable = attributes as Record<string, unknown>;
  for (const [key, value] of Object.entries(core)) {
    mutable[key] = value;
  }
  if (metadata !== undefined) mutable.metadata = metadata;
  if (Object.keys(extra).length > 0) mutable.extra = extra;

  return {
    attributes,
    diagnostics,
    markdown: remaining,
    hadFrontMatter: true,
  };
}
