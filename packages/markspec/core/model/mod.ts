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
 * Typed entries match `TYPE_XYZ_NNNN` (e.g., `SRS_BRK_0001`).
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

/** MarkSpec project configuration from `project.yaml`. */
export interface ProjectConfig {
  /** Project name. */
  readonly name: string;
  /** Entry type prefixes enabled for this project. */
  readonly types: readonly EntryType[];
  /** Glob patterns for Markdown source files. */
  readonly include: readonly string[];
  /** Glob patterns to exclude. */
  readonly exclude: readonly string[];
  /** Upstream registry URLs (searched in order, RefHub is implicit fallback). */
  readonly registries: readonly string[];
  /** Mustache template variables. */
  readonly variables: Readonly<Record<string, string>>;
}
