/**
 * @module model
 *
 * MarkSpec document model — AST types, ID types, and project configuration.
 */

export {
  ATTRIBUTE_CATALOG,
  attributeSpec,
  UNIVERSAL_ATTRIBUTE_KEYS,
} from "./attributes.ts";
export type { AttributeSpec } from "./attributes.ts";

export { COLOR_NAME_RE, PALETTE_HUES } from "./palette.ts";
export type { PaletteHue } from "./palette.ts";

export {
  attributesForType,
  CORE_TYPE_HIERARCHY,
  CORE_TYPE_SCOPED_ATTRS,
} from "./type_hierarchy.ts";
export type { CoreTypeDef } from "./type_hierarchy.ts";

export { inferTypeFromUriScheme } from "./uri_scheme_map.ts";

export { inferTypeFromSource } from "./source_introspection.ts";

// ---------------------------------------------------------------------------
// Display ID
// ---------------------------------------------------------------------------

/**
 * Human-readable entry identifier from the `[...]` bracket marker.
 *
 * The core accepts any non-empty, project-unique string. Profiles may
 * tighten by declaring per-type `display-id-pattern:` templates, used for
 * both ID minting and type inference.
 *
 * For referenced entries the display ID is a slug (pandoc/BibTeX cite-key
 * convention, e.g., `ISO-26262-6`, `serde`, `smith2021`). The leading `@`
 * in `[@slug]` is accepted as Pandoc sugar and stripped during parsing.
 */
export type DisplayId = string;

// ---------------------------------------------------------------------------
// ULID
// ---------------------------------------------------------------------------

/**
 * Universally unique identifier, bare 26-character Crockford base32.
 *
 * Used as the `Id:` attribute value for identified entries. Assigned by
 * tooling, never hand-authored, immutable once assigned.
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
// Core type taxonomy (ADR-003 §Part 1, spec §1.3)
// ---------------------------------------------------------------------------

/**
 * Core abstract item types. Always valid as `Type:` values regardless of
 * which profile is loaded (core-only mode included). Convention: TitleCase.
 *
 * - `Item` is the abstract root and serves as the bottom fallback in the
 *   type-resolution chain (§1.3.1 step 8).
 * - `Specification`, `Component`, `Unit` are abstract+concrete parents:
 *   instantiable as direct fallbacks when no concrete subtype fits, and
 *   roots for both core concrete subtypes and profile-declared extensions.
 */
export const CORE_ABSTRACT_TYPES = [
  "Item",
  "Specification",
  "Component",
  "Unit",
] as const;

/**
 * Core concrete item types (ADR-003 §Part 1). Twelve subtypes plus three
 * abstract+concrete parents from {@linkcode CORE_ABSTRACT_TYPES} make up
 * the "15 concrete instantiable types" the spec describes.
 */
export const CORE_CONCRETE_TYPES = [
  // Specification subtypes
  "Requirement",
  "Test",
  "Contract",
  "Record",
  "Risk",
  // Component subtypes
  "SoftwareComponent",
  "HardwareComponent",
  "SoftwareInterface",
  "HardwareInterface",
  // Unit subtypes
  "SoftwareUnit",
  "HardwareUnit",
  // Definition (standalone under Item)
  "Definition",
] as const;

/**
 * All core type names. Accepted as `Type:` values in core-only mode and
 * when any profile is loaded. Profile-declared types extend this set.
 */
export const CORE_TYPES: ReadonlySet<string> = new Set<string>([
  ...CORE_ABSTRACT_TYPES,
  ...CORE_CONCRETE_TYPES,
]);

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

/**
 * Collated attributes keyed by Title-Case attribute name.
 *
 * Repeatable types (`id-list`, `tag-list`, `external-id`) carry one entry
 * per value after CSV-splitting and multi-line merging; `citation` carries
 * one entry per occurrence (no CSV-splitting, locators may contain `,`).
 * Single-valued types carry a one-element array; if the author wrote the
 * attribute twice, the later value wins but both appear in
 * {@linkcode Entry.rawAttributes} for round-trip fidelity.
 *
 * This is the representation the validator, formatter, and compiler consult
 * for typed processing; {@linkcode Entry.rawAttributes} is the source of truth
 * for exact round-trip through `markspec format`.
 */
export type TypedAttributes = ReadonlyMap<string, readonly string[]>;

// ---------------------------------------------------------------------------
// Entry shape and identity
// ---------------------------------------------------------------------------

/** The origin format of the entry. */
export type EntrySource = "markdown" | "doc-comment";

/**
 * Entry shape — one of two semantics-free categories the core recognizes.
 *
 * - `identified` — content unit the project authors and owns; `Id:` value
 *   is a bare ULID.
 * - `referenced` — citation pointing to an external artifact; `Id:` value
 *   is a scheme-qualified URI (RFC 3986): `urn:`, `doi:`, `pkg:`,
 *   `https:`, `isbn:`, …
 *
 * Shape is determined by the `Id:` attribute's value format, not by the
 * display-ID format or the document context. Concrete types
 * (`requirement`, `test`, `unit`, `standard`, `dependency`, …) are declared
 * by the active profile, not by the core.
 */
export type EntryShape = "identified" | "referenced";

/** Core-reserved identity attribute name. */
export const IDENTITY_KEY = "Id" as const;

/** Regex matching a bare ULID (identified-entry `Id:` value). */
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Regex matching a scheme-qualified URI (RFC 3986 §3.1 scheme).
 *
 * A scheme starts with a letter, followed by letters/digits/`+`/`-`/`.`,
 * terminated by `:`. This is the gate that distinguishes a URI value from
 * a bare slug in an `Id:` attribute.
 */
export const URI_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+\-.]*:/;

/**
 * Decide the shape of an entry from its `Id:` value.
 *
 * Returns `undefined` for inputs that are neither a bare ULID nor a
 * scheme-qualified URI — the caller emits a validation error.
 */
export function shapeFromIdValue(value: string): EntryShape | undefined {
  if (ULID_RE.test(value)) return "identified";
  if (URI_SCHEME_RE.test(value)) return "referenced";
  return undefined;
}

/**
 * Origin of an attribute value.
 *
 * - `authored` — written by the author in the source file.
 * - `inferred` — pre-filled by `markspec format` from a heuristic,
 *   committed to source, author-overridable.
 * - `assigned` — generated fresh by `markspec format` at creation time
 *   (the ULID inside an identified-entry `Id:`). Never derived, never
 *   changes after assignment.
 * - `generated` — computed at build time from inverse relations.
 *   Never committed to source.
 */
export type AttributeOrigin =
  | "authored"
  | "inferred"
  | "assigned"
  | "generated";

/**
 * Attribute value type (14 types).
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
 * Observed properties of an entry.
 *
 * Properties are model-level observations — never authored in source, never
 * round-trip through `markspec format`, not in git diffs. Each category is
 * optional; absence means "not observed (yet)".
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
  /**
   * Entry-source provenance — set when an entry is produced by an adapter
   * other than the Markdown parser (doc-comment extractor, SBOM ingester,
   * ECAD/PLM connector).
   */
  readonly source?: {
    readonly type: string;
    readonly adapter?: string;
    readonly language?: string;
    readonly rule?: string;
    readonly extractedAt?: string;
  };
}

/**
 * A parsed MarkSpec entry — the core AST node.
 *
 * The `shape` field discriminates the two core categories:
 * - `identified` entries carry a bare ULID in `id` (populated).
 * - `referenced` entries carry a URI in `id` (populated).
 *
 * The `type` field holds the active profile's classification for the entry
 * (inferred from the display-ID pattern or authored explicitly via a
 * `type:` attribute). It is `undefined` when no profile rule classifies
 * the entry.
 */
export interface Entry {
  /** Human-readable display ID from the `[...]` marker. */
  readonly displayId: DisplayId;
  /** Entry title — text after the closing `]` on the first line. */
  readonly title: string;
  /** Body content (paragraphs, alerts, code blocks) between title and attributes. */
  readonly body: string;
  /**
   * Source-order raw attribute array. Used by the formatter for round-trip
   * fidelity (preserving key casing, line order, and trailing backslashes).
   * For lookup-oriented access, use `typedAttributes` — the collated,
   * CSV-split Map view of the same data.
   */
  readonly rawAttributes: readonly Attribute[];
  /**
   * Collated, typed view of {@linkcode Entry.rawAttributes}.
   *
   * Populated by the parser alongside `rawAttributes`. Downstream layers
   * (validator, compiler) consult this map for typed processing; the
   * formatter still reads `rawAttributes` for exact round-trip.
   */
  readonly typedAttributes: TypedAttributes;
  /**
   * Value of the `Id:` attribute — a ULID for identified entries, a URI for
   * referenced entries. Absent when `Id:` was missing or malformed.
   */
  readonly id?: string;
  /**
   * Profile-declared type for this entry, when classified.
   *
   * Normally inferred by the active profile from the display-ID prefix
   * matching a declared `display-id-pattern:`. An explicit `type:`
   * attribute in source overrides inference. Absent when no profile rule
   * matches (e.g., free-form display ID with no `type:` attribute).
   */
  readonly type?: string;
  /** Entry shape — `identified` or `referenced`. */
  readonly shape: EntryShape;
  /** Where the entry was found. */
  readonly location: SourceLocation;
  /** Whether this came from a Markdown file or a doc comment. */
  readonly source: EntrySource;
  /**
   * Observed properties (file path, git history, sync state, build origin,
   * source-adapter provenance).
   */
  readonly properties?: EntryProperties;
  /**
   * Inline `$Identifier` entity references discovered in the entry body
   * prose (spec §2.5.2). Empty when the body contains no references.
   * Resolution into the project's entity registry happens downstream.
   */
  readonly entityRefs?: readonly EntityRef[];
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

/**
 * Case convention of a `$Identifier` token (spec §2.5.2). The convention
 * determines which entity domain the reference resolves into.
 */
export type EntityRefConvention = "type" | "instance" | "constant";

/**
 * An inline `$Identifier` token found in entry body prose (spec §2.5.2).
 *
 * `ident` carries the leading `$`. `convention` is derived from the
 * identifier's case shape:
 *
 *   - `type` — PascalCase (`$BrakeController`).
 *   - `instance` — camelCase (`$rawPressure`).
 *   - `constant` — SCREAMING_SNAKE (`$DEBOUNCE_WINDOW`). Requires at
 *     least one underscore or digit to distinguish from a single-segment
 *     PascalCase identifier like `$ASIL`.
 *
 * Resolution to an entity in the project's RIDL types / code symbols /
 * constants registry is performed by the validator's marker pass.
 */
export interface EntityRef {
  readonly ident: string;
  readonly convention: EntityRefConvention;
  readonly location: SourceLocation;
}

// ---------------------------------------------------------------------------
// Traceability graph
// ---------------------------------------------------------------------------

/**
 * Kind of directional link between entries — relation name lifted from the
 * source attribute.
 *
 * The core bakes in only `supersedes` (universal retirement). All other
 * relation names listed here are conventions recognized by shipped profile
 * packages; in a profile-aware pipeline, link kinds come from the active
 * profile's `traceability:` declarations rather than this closed union.
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
 * Document-level attributes authored in YAML front matter.
 *
 * Keys use kebab-case (YAML-ecosystem convention). Core keys below; profiles
 * declare additional keys; `.markspec.yaml` → `frontMatter.allowedKeys`
 * allowlists ecosystem keys (Hugo, Jekyll, Docusaurus). Keys forbidden by
 * the language spec (`title`, `description`, `date`, `authors`, …) are
 * rejected by MSL-D001 and never reach this map.
 */
export interface DocumentAttributes {
  /**
   * Document identity — ULID (identified) or URI (referenced), same
   * discrimination rule as entry `Id:`. Conventionally a ULID for
   * project-authored documents.
   */
  readonly "document-id"?: string;
  /** Overrides filename/directive-based type detection. */
  readonly "document-type"?: string;
  /** Classification tags (`tag-list`). */
  readonly labels?: readonly string[];
  /** Retirement reason (free-text). Presence marks the document as retired. */
  readonly deprecated?: string;
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
 * Observed document properties — derived, never authored.
 *
 * The H1, first paragraph, git history, and filesystem are the
 * authoritative sources. These fields are populated progressively as
 * observation support lands.
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
 * A parsed MarkSpec document.
 *
 * A Markdown (or source) file containing entries, optionally preceded by
 * YAML front matter. Document metadata is split into authored `attributes`
 * (front matter) and observed `properties` (H1, git, filesystem).
 */
export interface Document {
  /** File path (absolute or project-relative). */
  readonly file: string;
  /** Document-level attributes from front matter. */
  readonly attributes: DocumentAttributes;
  /** Observed document properties. */
  readonly properties: DocumentProperties;
}

// ---------------------------------------------------------------------------
// Profile model re-exports
// ---------------------------------------------------------------------------

export type {
  AttrDecl,
  Cardinality,
  DocTypeDef,
  EffectiveProfile,
  EffectiveShapeScope,
  EffectiveTypeDef,
  EnforcementMode,
  InverseDecl,
  LoadedProfile,
  ProfileChain,
  ProfileId,
  ProfileManifest,
  ProfileSpecifier,
  ProvenancedMap,
  ProvenancedMapEntry,
  ProvenancedValue,
  TargetMatcher,
  TraceRule,
  TypeDef,
  ValueType,
} from "./profile.ts";
export { LIST_VALUE_TYPES, VALUE_TYPES } from "./profile.ts";
