/**
 * @module model
 *
 * MarkSpec document model — AST types, ID types, and project configuration.
 */

export {
  ATTRIBUTE_CATALOG,
  attributesForFamily,
  attributeSpec,
  ELEMENT_KIND_VALUES,
  STATUS_VALUES,
  TEST_LEVEL_VALUES,
} from "./attributes.ts";
export type { AttributeSpec } from "./attributes.ts";

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
 * Entry family per ADR-002.
 *
 * Four families, each with a dedicated identity attribute:
 * - `spec` — project declaration (requirement, architecture, decision, hazard)
 * - `test` — verification of declared behavior (automated or manual)
 * - `element` — canonical system object (code unit, artifact, dependency, hardware)
 * - `reference` — bibliographic citation of an external artifact
 *
 * Family is determined by the identity attribute the entry carries
 * (`Spec-id` / `Test-id` / `Element-id` / `Reference-id`), not by display-ID
 * pattern or document context. See {@linkcode IdentityAttribute}.
 */
export type EntryFamily = "spec" | "test" | "element" | "reference";

/**
 * Identity attribute key per ADR-002 Part 6.
 *
 * Every entry carries exactly one of these; its presence determines the family.
 */
export type IdentityAttribute =
  | "Spec-id"
  | "Test-id"
  | "Element-id"
  | "Reference-id";

/** Map from identity attribute key to family. */
export const FAMILY_BY_IDENTITY_KEY: Readonly<
  Record<IdentityAttribute, EntryFamily>
> = {
  "Spec-id": "spec",
  "Test-id": "test",
  "Element-id": "element",
  "Reference-id": "reference",
};

/** Map from family to identity attribute key. */
export const IDENTITY_KEY_BY_FAMILY: Readonly<
  Record<EntryFamily, IdentityAttribute>
> = {
  spec: "Spec-id",
  test: "Test-id",
  element: "Element-id",
  reference: "Reference-id",
};

/**
 * Origin of an attribute value per ADR-002 Part 1.
 *
 * - `authored` — written by the author in the source file.
 * - `inferred` — pre-filled by `markspec format` from a heuristic,
 *   committed to source, author-overridable.
 * - `assigned` — generated fresh by `markspec format` at creation time
 *   (identity attributes). Never derived, never changes after assignment.
 * - `generated` — computed at build time from inverse relations.
 *   Never committed to source.
 */
export type AttributeOrigin =
  | "authored"
  | "inferred"
  | "assigned"
  | "generated";

/**
 * Attribute value type per ADR-002 Part 1 (14 types).
 *
 * Cardinality is encoded in the type:
 * - Repeatable: `id-list`, `tag-list`, `citation`, `external-id`.
 * - Single-valued: everything else.
 *
 * Repeatable types accept multi-line and (except `citation`) CSV on input;
 * the formatter always emits multi-line form.
 */
export type AttributeValueType =
  | "id"
  | "id-list"
  | "uri"
  | "url"
  | "path"
  | "path-or-id"
  | "enum"
  | "tag-list"
  | "text"
  | "citation"
  | "external-id"
  | "integer"
  | "date"
  | "boolean";

/**
 * Observed properties of an entry per ADR-002 Part 1 and ADR-006 (stub).
 *
 * Properties are model-level observations — never authored in source, never
 * round-trip through `markspec format`, not in git diffs. Each category is
 * optional; absence means "not observed (yet)".
 *
 * Observation contracts for git/sync/build are deferred to ADR-006. Only
 * `file.path` is populated today (set by the parser from the parse options).
 */
export interface EntryProperties {
  /** Repository location. */
  readonly file?: {
    readonly path: string;
    readonly line?: number;
    readonly column?: number;
  };
  /** Version-control observations. */
  readonly git?: {
    readonly createdAt?: string;
    readonly modifiedAt?: string;
    readonly contributors?: readonly string[];
    readonly revision?: string;
  };
  /** External connector state. */
  readonly sync?: {
    readonly lastSyncedAt?: string;
    readonly remoteState?: string;
    readonly externalSource?: string;
  };
  /** Compilation-time provenance. */
  readonly build?: {
    readonly resolutionSource?: string;
    readonly registryOrigin?: string;
  };
}

/**
 * A parsed MarkSpec entry — the core AST node.
 *
 * Covers both spec entries (`SRS_BRK_0001`) and reference entries
 * (`ISO-26262-6`). The `family` field discriminates; `entryType` is the
 * TYPE prefix for spec entries, `undefined` for reference entries.
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
  /** ULID from the `Id:` attribute, if present (spec entries only). */
  readonly id: Ulid | undefined;
  /** Resolved entry type prefix (e.g., `SRS`), if this is a spec entry. */
  readonly entryType: EntryType | undefined;
  /** Entry family: spec (project declaration) or reference (external citation). */
  readonly family: EntryFamily;
  /** Where the entry was found. */
  readonly location: SourceLocation;
  /** Whether this came from a Markdown file or a doc comment. */
  readonly source: EntrySource;
  /**
   * Observed properties (file path, git history, sync state, build origin).
   *
   * Populated progressively: Phase 2 wires `file.path`; ADR-006 work wires
   * the rest. Consumers must tolerate missing values.
   */
  readonly properties?: EntryProperties;
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

/**
 * Kind of directional link between entries.
 *
 * Extends the four-link spec/reference model to cover all ADR-002 relations:
 * Test.`Verifies`, Test.`Tests`, Element.`Realizes`, Element.`Depends-on`,
 * Element.`Part-of`, Element.`Generated-from`, universal `Supersedes`.
 */
export type LinkKind =
  | "satisfies"
  | "derived-from"
  | "references"
  | "allocated-to"
  | "realizes"
  | "verifies"
  | "tests"
  | "depends-on"
  | "part-of"
  | "generated-from"
  | "supersedes";

/** A directional link between two entries in the traceability graph. */
export interface Link {
  readonly from: DisplayId;
  readonly to: DisplayId;
  readonly kind: LinkKind;
  readonly location: SourceLocation;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/**
 * Document-level attributes authored in YAML front matter per ADR-007.
 *
 * Keys use kebab-case (YAML-ecosystem convention). Core keys below; profiles
 * declare additional keys; `.markspec.yaml` → `frontMatter.allowedKeys`
 * allowlists ecosystem keys (Hugo, Jekyll, Docusaurus). Keys forbidden by
 * ADR-007 (`title`, `description`, `date`, `authors`, …) are rejected by
 * MSL-D001 and never reach this map.
 */
export interface DocumentAttributes {
  /** Document ULID — bare 26-char Crockford base32. */
  readonly "document-id"?: string;
  /** Overrides filename/directive-based type detection. */
  readonly "document-type"?: string;
  /** Classification tags (`tag-list`). */
  readonly labels?: readonly string[];
  /** Lifecycle state (`draft` / `approved` / `deprecated` / `withdrawn`). */
  readonly status?: string;
  /** Cross-system identifier(s) (`external-id`). */
  readonly "external-id"?: readonly string[];
  /** `document-id` of a document this one replaces. */
  readonly supersedes?: string;
  /** External reference citations with optional locator (`citation`). */
  readonly references?: readonly string[];
  /** Org free-form metadata, never validated. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Allowlisted ecosystem keys (preserved verbatim, not validated). */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/**
 * Observed document properties per ADR-007 §6.2 — derived, never authored.
 *
 * The H1, first paragraph, git history, and filesystem are the authoritative
 * sources. These fields are populated progressively as observation support
 * lands.
 */
export interface DocumentProperties {
  /** H1 heading, or filename stem fallback. */
  readonly title?: string;
  /** Merge-to-main count (starts at `0`). */
  readonly revision?: number;
  /** Contributors from `project.yaml` or git history. */
  readonly authors?: readonly string[];
  /** First commit timestamp, or filesystem ctime fallback. */
  readonly createdAt?: string;
  /** Last merge-commit timestamp, or filesystem mtime fallback. */
  readonly modifiedAt?: string;
}

/**
 * A parsed MarkSpec document per ADR-007.
 *
 * A Markdown (or source) file containing entries, optionally preceded by YAML
 * front matter. Document metadata is split into authored `attributes` (front
 * matter) and observed `properties` (H1, git, filesystem).
 */
export interface Document {
  /** File path (absolute or project-relative). */
  readonly file: string;
  /** Document-level attributes from front matter. */
  readonly attributes: DocumentAttributes;
  /** Observed document properties. */
  readonly properties: DocumentProperties;
}
