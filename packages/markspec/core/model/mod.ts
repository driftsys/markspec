/**
 * @module model
 *
 * MarkSpec document model — AST types, ID types, and project configuration.
 */

// ---------------------------------------------------------------------------
// Builtin entry types
// ---------------------------------------------------------------------------

/** Builtin requirement, architecture, and verification types. */
export type BuiltinType =
  | "STK"
  | "SYS"
  | "SRS"
  | "SAD"
  | "ICD"
  | "VAL"
  | "SIT"
  | "SWT";

/**
 * Entry type — a builtin type or any user-defined uppercase string.
 * Non-builtin types are valid; tooling validates format but not
 * traceability direction or level.
 */
export type EntryType = BuiltinType | (string & Record<never, never>);

// ---------------------------------------------------------------------------
// Display ID
// ---------------------------------------------------------------------------

/**
 * Human-readable entry identifier.
 *
 * Typed entries match `TYPE_XYZ_NNN[N]` (e.g., `SRS_BRK_001`, `SRS_BRK_0001`).
 * Reference entries are slugs: `[A-Za-z0-9-]+` (e.g., `ISO-26262-6`).
 */
export type DisplayId = string;

// ---------------------------------------------------------------------------
// ULID
// ---------------------------------------------------------------------------

/**
 * Universally unique ID in `TYPE_ULID` format (e.g., `SRS_01HGW2Q8MNP3`).
 * Assigned by tooling, never hand-authored, never changes once assigned.
 */
export type Ulid = string;

// ---------------------------------------------------------------------------
// Source location
// ---------------------------------------------------------------------------

/** Points to a span within a source file. */
export interface SourceLocation {
  /** Absolute or project-relative file path. */
  readonly file: string;
  /** 1-based line number of the entry start. */
  readonly line: number;
  /** 1-based column number of the entry start. */
  readonly column: number;
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

/** A single `Key: Value` pair from an attribute block. */
export interface Attribute {
  /** Attribute name (e.g., `Id`, `Satisfies`, `Labels`). */
  readonly key: string;
  /** Raw attribute value string. */
  readonly value: string;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/** The origin format of the entry. */
export type EntrySource = "markdown" | "doc-comment";

/**
 * A parsed MarkSpec entry — the core AST node.
 *
 * Covers both typed entries (`SRS_BRK_0001`) and reference entries
 * (`ISO-26262-6`). The `entryType` field is set for typed entries,
 * `undefined` for reference entries.
 */
export interface Entry {
  /** Human-readable display ID from the `[...]` marker. */
  readonly displayId: DisplayId;
  /** Entry title — text after the closing `]` on the first line. */
  readonly title: string;
  /** Body content (paragraphs, alerts, code blocks) between title and attributes. */
  readonly body: string;
  /** Parsed attribute block (`Key: Value` lines). */
  readonly attributes: readonly Attribute[];
  /** ULID from the `Id:` attribute, if present. */
  readonly id: Ulid | undefined;
  /** Resolved entry type prefix (e.g., `SRS`), if this is a typed entry. */
  readonly entryType: EntryType | undefined;
  /** Where the entry was found. */
  readonly location: SourceLocation;
  /** Whether this came from a Markdown file or a doc comment. */
  readonly source: EntrySource;
}

// ---------------------------------------------------------------------------
// Diagnostic
// ---------------------------------------------------------------------------

/** Severity level for diagnostics. */
export type Severity = "error" | "warning" | "info";

/** A diagnostic message produced by parsing, formatting, or validation. */
export interface Diagnostic {
  /** Unique rule ID (e.g., `MSL-E001`). */
  readonly code: string;
  /** Severity level. */
  readonly severity: Severity;
  /** Human-readable message. */
  readonly message: string;
  /** Source location, if applicable. */
  readonly location: SourceLocation | undefined;
}

// ---------------------------------------------------------------------------
// Project configuration
// ---------------------------------------------------------------------------

/** Default RefHub URL used as implicit fallback for parent registries. */
export const REFHUB_URL = "https://driftsys.github.io/refhub";

/** MarkSpec project configuration from `project.yaml`. */
export interface ProjectConfig {
  /** Project name (e.g., `io.driftsys.markspec`). */
  readonly name: string;
  /** Project version string. */
  readonly version: string;
  /** Allowed label vocabulary (e.g., `["ASIL-A", "ASIL-B"]`). Empty = no constraint. */
  readonly labels: readonly string[];
  /** Upstream parent registry URLs, searched in order. */
  readonly parents: readonly string[];
  /** Fallback registry URL when parents don't resolve a reference. */
  readonly parentFallback: string;
}

/** Default configuration used when no `project.yaml` is found. */
export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  name: "",
  version: "0.0.0",
  labels: [],
  parents: [],
  parentFallback: REFHUB_URL,
};

// ---------------------------------------------------------------------------
// Configuration errors
// ---------------------------------------------------------------------------

/** A single field-level validation error in `project.yaml`. */
export interface ConfigFieldError {
  /** The YAML field path (e.g., `domain`, `parents[0]`). */
  readonly field: string;
  /** Human-readable error message. */
  readonly message: string;
  /** 1-based line number in the YAML file, if determinable. */
  readonly line: number | undefined;
}

// ---------------------------------------------------------------------------
// Caption
// ---------------------------------------------------------------------------

/** A detected table or figure caption in a Markdown document. */
export interface Caption {
  readonly kind: "table" | "figure";
  readonly slug: string;
  readonly text: string;
  readonly location: SourceLocation;
}

/** Error thrown when `project.yaml` is invalid. */
export class ConfigError extends Error {
  /** Path to the `project.yaml` file. */
  readonly configPath: string;
  /** Individual field errors. */
  readonly fieldErrors: readonly ConfigFieldError[];

  constructor(configPath: string, fieldErrors: readonly ConfigFieldError[]) {
    const summary = fieldErrors
      .map((e) =>
        e.line !== undefined
          ? `  ${configPath}:${e.line} — ${e.field}: ${e.message}`
          : `  ${e.field}: ${e.message}`
      )
      .join("\n");
    super(`invalid project.yaml:\n${summary}`);
    this.name = "ConfigError";
    this.configPath = configPath;
    this.fieldErrors = fieldErrors;
  }
}

// ---------------------------------------------------------------------------
// Directives
// ---------------------------------------------------------------------------

/**
 * A MarkSpec directive extracted from an HTML comment.
 *
 * Directives use the form `<!-- markspec:<name> <payload> -->` inside
 * Markdown files to annotate documents with processing hints (e.g.,
 * `markspec:deck`, `markspec:deprecated`).
 */
export interface Directive {
  readonly name: string;
  readonly payload: string;
  readonly location: SourceLocation;
}

// ---------------------------------------------------------------------------
// Inline references
// ---------------------------------------------------------------------------

/** An inline reference found in prose text via `{{namespace.id}}` syntax. */
export interface InlineRef {
  readonly namespace: string;
  readonly refId: string;
  readonly location: SourceLocation;
}

// ---------------------------------------------------------------------------
// Traceability graph
// ---------------------------------------------------------------------------

/** Kind of directional link between entries. */
export type LinkKind =
  | "satisfies"
  | "derived-from"
  | "allocates"
  | "constrains"
  | "verifies"
  | "implements";

/** A directional link between two entries in the traceability graph. */
export interface Link {
  readonly from: DisplayId;
  readonly to: DisplayId;
  readonly kind: LinkKind;
  readonly location: SourceLocation;
}
