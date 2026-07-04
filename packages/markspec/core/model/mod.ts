/**
 * @module model
 *
 * MarkSpec document model — AST types, ID types, and project configuration.
 */

/**
 * Version of the core entry/graph schema. Bumped only when the compiled
 * representation changes incompatibly; compared by the snapshot skew
 * guard (`checkSnapshotSchema`) and printed by `--version`.
 */
export const CORE_SCHEMA_VERSION = 1;

// model/mod.ts ↔ ast/nodes.ts is a mutual type-only import cycle
// (nodes.ts imports EntityRefConvention here); TypeScript resolves it
// cleanly because both directions are `import type`.
import type { BodyBlock } from "../ast/nodes.ts";
import type { Discipline } from "./discipline.ts";
import type { TyplBlock } from "../typl/mod.ts";
import { CORE_RELATIONS } from "./relations.ts";

export {
  ATTRIBUTE_CATALOG,
  attributeSpec,
  CSV_SPLITTABLE_TYPES,
  UNIVERSAL_ATTRIBUTE_KEYS,
} from "./attributes.ts";
export type { AttributeSpec } from "./attributes.ts";

export { COLOR_NAME_RE, PALETTE_HUES } from "./palette.ts";
export type { PaletteHue } from "./palette.ts";

export {
  attributesForType,
  CORE_TYPE_HIERARCHY,
  CORE_TYPE_SCOPED_ATTRS,
  descendantsOf,
} from "./type_hierarchy.ts";
export type { CoreTypeDef } from "./type_hierarchy.ts";

export { CORE_RELATIONS, LOCK_EXTRA_INVERSE_KEYS } from "./relations.ts";
export type { RelationDef } from "./relations.ts";

export { inferTypeFromUriScheme } from "./uri_scheme_map.ts";

export { inferTypeFromSource } from "./source_introspection.ts";

export { inferTypeFromDiscriminatingAttr } from "./discriminating_attr.ts";

// Re-export discipline primitives (ADR-017 / ADR-018).
export {
  CORE_DISCIPLINE_REGISTRY,
  CORE_KINDS,
  MIXED_DISCIPLINE,
} from "./discipline.ts";
export type { Discipline, DisciplineRegistry } from "./discipline.ts";

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
 *
 * Branded so a `Ulid` cannot be accidentally passed where a `DisplayId`
 * is expected, and vice versa. Use {@linkcode makeDisplayId} to construct.
 */
export type DisplayId = string & { readonly __brand: "DisplayId" };

/**
 * Cast a plain string to a branded `DisplayId`.
 *
 * This is a zero-cost assertion — no validation is performed. The caller
 * asserts that `s` is a syntactically valid display ID.
 */
export function makeDisplayId(s: string): DisplayId {
  return s as DisplayId;
}

// ---------------------------------------------------------------------------
// ULID
// ---------------------------------------------------------------------------

/**
 * Universally unique identifier, bare 26-character Crockford base32.
 *
 * Used as the `Id:` attribute value for identified entries. Assigned by
 * tooling, never hand-authored, immutable once assigned.
 *
 * Branded so a `DisplayId` cannot be accidentally passed where a `Ulid`
 * is expected, and vice versa. Use {@linkcode makeUlid} to construct.
 */
export type Ulid = string & { readonly __brand: "Ulid" };

/**
 * Cast a plain string to a branded `Ulid`.
 *
 * This is a zero-cost assertion — no validation is performed. The caller
 * asserts that `s` is a syntactically valid 26-character Crockford base32
 * ULID.
 */
export function makeUlid(s: string): Ulid {
  return s as Ulid;
}

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

/** Supported source-file languages for doc-comment extraction. */
export type SupportedLanguage =
  | "rust"
  | "kotlin"
  | "java"
  | "c"
  | "cpp"
  | "typescript"
  | "tsx"
  | "javascript"
  | "csharp";

/** Which extractor rule produced a doc-comment entry. Distinguishes the
 * three lexical doc-comment styles MarkSpec recognises across grammars. */
export type ExtractorRule =
  | "outer-doc-comment" // Rust `///`
  | "inner-doc-comment" // Rust `//!`
  | "block-doc-comment"; // Javadoc-style `/** … */` (Rust, Java, Kotlin, C, C++)

/**
 * Tagged union describing what produced an entry. Replaces the previous
 * string discriminator ("markdown" | "doc-comment") to carry per-entry
 * source metadata (language, enclosing function name, extractor rule) for
 * code-extracted entries. See ADR-006 §1 and the source-properties spec.
 */
export type EntrySource =
  | { readonly kind: "markdown" }
  | {
    readonly kind: "doc-comment";
    readonly language: SupportedLanguage;
    /**
     * Name of the enclosing function / class / struct / impl / mod /
     * trait at the doc comment's source location. Absent means the
     * extractor returned undefined for any reason — covers both
     * "no enclosing item exists" (e.g., crate-root `//!` block) AND
     * "extractor could not extract a name from the item it found"
     * (anonymous structures, operator overloads, lambdas). Consumers
     * must NOT treat absence as proof the entry is at file scope.
     */
    readonly function?: string;
    /** Which extractor rule matched. */
    readonly rule: ExtractorRule;
  };

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
export type EntryShape = "Authored" | "Reference";

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
 * Regex matching a display-ID-shaped token (a "slug"): a letter, then any of
 * letters / digits / `.` `_` `/` `-`, ending on a letter or digit. Mirrors the
 * parser's slug grammar in `core/parser/markdown.ts` (`SLUG_RE`).
 *
 * Used by the `id` / `id-list` value-type gate to accept a display ID in a
 * trace-relation value. This is a SHAPE check only — whether the display ID
 * resolves to a real entry is checked downstream by the Stage-4 existence rule
 * (MSL-L006), not here.
 *
 * Single- and two-character slugs match here (mirroring `SLUG_RE`) but are
 * unresolvable in the LSP, whose token grammar requires ≥ 3 characters. Real
 * profile display-ID patterns always produce longer IDs, so the asymmetry is
 * benign.
 */
export const DISPLAY_ID_RE = /^[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?$/;

/**
 * Decide the shape of an entry from its `Id:` value.
 *
 * Returns `undefined` for inputs that are neither a bare ULID nor a
 * scheme-qualified URI — the caller emits a validation error.
 */
export function shapeFromIdValue(value: string): EntryShape | undefined {
  if (ULID_RE.test(value)) return "Authored";
  if (URI_SCHEME_RE.test(value)) return "Reference";
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
    /** ISO 8601 last-modified timestamp from the filesystem. */
    readonly mtime?: string;
  };
  /** Version-control observations from the file's git history. */
  readonly git?: {
    /** ISO 8601 — author date of the first commit that touched the file. */
    readonly createdAt?: string;
    /** ISO 8601 — author date of the last commit that touched the file. */
    readonly modifiedAt?: string;
    /** Distinct commit-author names, sorted. PII-adjacent — opt-in only. */
    readonly contributors?: readonly string[];
    /** Short SHA of the last commit that touched the file. */
    readonly revision?: string;
  };
  /** External connector state. */
  readonly sync?: {
    readonly lastSyncedAt?: string;
    /** RFC 3339 timestamp of the most recent conflict event for any binding on this entry (ADR-019). */
    readonly lastConflictAt?: string;
    readonly remoteState?: string;
    readonly externalSource?: string;
  };
  /** Compilation-time provenance. */
  readonly build?: {
    readonly resolutionSource?: string;
    readonly registryOrigin?: string;
    /** sha256:* hash recorded in markspec.lock for this entry's locked-attribute set at last lock (ADR-019). */
    readonly lockHash?: string;
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
    /**
     * Name of the enclosing function / class / struct / impl / mod /
     * trait at the doc comment's source location. Absent means the
     * extractor returned undefined — covers BOTH "no enclosing item
     * exists" (crate-root `//!` block) AND "extractor could not extract
     * a name from the item it found" (anonymous structures, operator
     * overloads, lambdas). Consumers must NOT treat absence as proof
     * the entry is at file scope.
     */
    readonly function?: string;
    readonly rule?: string;
    readonly extractedAt?: string;
  };
}

/**
 * Provenance of an entry that did not originate in the project's own files
 * (ADR-030). Absent on project-authored entries. `kind` is a discriminant so
 * future origins (e.g. ADR-011 SBOM-generated dependency entries) can reuse
 * the slot. The `upstream` member covers entries hydrated from another
 * repository's traceability graph (federated-upstream epic).
 */
export type EntryOrigin =
  | {
    readonly kind: "profile";
    readonly profileId: string;
    readonly profileVersion: string;
  }
  | {
    readonly kind: "upstream";
    readonly upstreamId: string;
    readonly version: string;
  };

/**
 * Human-facing `<profileId>@<profileVersion>` (or `<upstreamId>@<version>`)
 * label for an entry's origin (ADR-030). The single formatter for the origin
 * idiom shared across the validator, reporter, CLI, LSP, and MCP surfaces.
 * Its {@linkcode DeliveredDocument} twin is `corpusOriginLabel`
 * (`core/profile/delivered.ts`) — same string shape, different input type.
 */
export function formatEntryOrigin(origin: EntryOrigin): string {
  switch (origin.kind) {
    case "profile":
      return `${origin.profileId}@${origin.profileVersion}`;
    case "upstream":
      return `${origin.upstreamId}@${origin.version}`;
  }
}

/**
 * Whether two origins come from the same source (same profile id or same
 * upstream id), ignoring versions. Used by the corpus collision pass to
 * decide "same owner" — version bumps must not split ownership.
 */
export function sameOriginSource(a: EntryOrigin, b: EntryOrigin): boolean {
  if (a.kind === "profile" && b.kind === "profile") {
    return a.profileId === b.profileId;
  }
  if (a.kind === "upstream" && b.kind === "upstream") {
    return a.upstreamId === b.upstreamId;
  }
  return false;
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
  /** Canonical body AST (PR 2: additive, not yet consumed). */
  readonly bodyAst?: readonly BodyBlock[];
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
  /** Entry shape — `Authored` or `Reference`. */
  readonly shape: EntryShape;
  /** Where the entry was found. */
  readonly location: SourceLocation;
  /**
   * File-absolute 1-based line where the entry's body begins.
   *
   * Used by prose-analysis rules (MSL-Q500) to convert body-relative
   * paragraph ranges (as produced by `buildBodyAst`) to file-absolute
   * `LintDiagnostic.range` positions — the contract from slice 3.
   *
   * For `.md` entries this is `location.line + 1` (legacy convention
   * shared with `bodyTokens`); for doc-comment entries it is the
   * file-absolute line of the first non-title child after lineMap
   * translation.
   *
   * Optional so existing test fixtures and pre-compiler pipeline
   * stages that do not set this field can remain unchanged. Prose-analysis
   * rules that need a file-absolute base line fall back to
   * `location.line + 1` when absent.
   */
  readonly bodyStartLine?: number;
  /** Whether this came from a Markdown file or a doc comment. */
  readonly source: EntrySource;
  /**
   * Observed properties (file path, git history, sync state, build origin,
   * source-adapter provenance).
   */
  readonly properties?: EntryProperties;
  /**
   * Inline-construct tokens recognised in the entry body prose
   * (ADR-016). Eager, sorted by `(line, column)`, file-relative.
   * Always present — empty array when no constructs are recognised.
   */
  readonly bodyTokens: readonly BodyToken[];
  /**
   * typl declarations extracted from typl-info-string fences in the
   * entry body, if any. Absent when the entry contains no typl fences.
   *
   * Populated by the parser via {@linkcode extractTyplFences} +
   * {@linkcode parseTyplBlock} aggregated across all fences in the
   * entry. Per-fence diagnostics are bridged to file-relative core
   * diagnostics and surface in the parser's diagnostic stream.
   *
   * See ADR-019.
   */
  readonly types?: TyplBlock;
  /**
   * Discipline kind resolved by the classifier per ADR-017 Invariant 1
   * (channels 1–4 with default `system`).
   *
   * **Always set on entries returned from `compile()` after Phase 4** —
   * external consumers reading the compiled output (reporter, serializer,
   * LSP, MCP) can rely on this field being present. The optional `?:`
   * modifier exists only because synthetic Entry literals (test fixtures)
   * and parser-emitted entries before Phase 4 don't carry the field;
   * these are internal pipeline states, not the public contract.
   *
   * Values are drawn from the active discipline registry (built-in
   * `software` / `hardware` / `system` plus any profile-declared
   * extensions); `"mixed"` is emitted when channel 4 sees `Allocated-to`
   * targets resolving to more than one distinct kind. Authors never type
   * this value directly.
   */
  readonly derivedDiscipline?: Discipline;
  /**
   * Provenance of an entry not authored in the project's own files:
   * injected from a profile-delivered corpus document (ADR-030,
   * `kind: "profile"`) or hydrated from a locked upstream snapshot
   * (`kind: "upstream"`). Consumers treat any origin-carrying entry as
   * read-only: `fmt` and rename never touch them, and validation findings
   * inside them are downgraded to attributed warnings.
   */
  readonly origin?: EntryOrigin;
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

/**
 * Caption-position convention for a specific caption keyword.
 * `"above"` — caption must appear above its block.
 * `"below"` — caption must appear below its block.
 */
export type CaptionPosition = "above" | "below";

/**
 * Per-keyword caption-position conventions.
 *
 * Keys are caption keywords (e.g. `"Figure"`, `"Table"`, `"Listing"`,
 * `"Feature"`, `"Equation"`, `"List"`). A missing key means no
 * convention is configured for that keyword — MSL-C072 is inactive for
 * unconfigured keywords.
 *
 * Authored in `project.yaml` under `caption-conventions:`:
 *
 * ```yaml
 * caption-conventions:
 *   Figure: below
 *   Table: above
 * ```
 */
export type CaptionConventions = Readonly<
  Partial<Record<string, CaptionPosition>>
>;

/**
 * Reference to an external project (org project-manifest contract,
 * `driftsys/schemas` `project/v1.json` `$defs/projectRef`). Used by the
 * `dependencies:` (git repositories) and `references:` (published sites)
 * lists. `version` carries intent: an exact tag is a frozen baseline, a
 * branch name tracks its head, absent means auto (latest semver release
 * tag, else default-branch head). `name` is the upstream id used for the
 * cache directory, lockfile rows, and origin badges; derived from the URL
 * when absent.
 */
export interface ProjectRef {
  readonly url: string;
  readonly version?: string;
  readonly name?: string;
}

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
  /**
   * Per-keyword caption-position conventions (spec §4.7 MSL-C072).
   * When a key is present, the validator emits MSL-C072 if a caption
   * of that keyword appears on the wrong side of its block. An empty
   * or absent map means all keywords are unconstrained.
   */
  readonly captionConventions: CaptionConventions;
  /**
   * Gitignore-syntax patterns excluded from project file discovery,
   * anchored at the project root (e.g. `["skills/", "*.gen.md"]`).
   * Applied after `.gitignore` rules by `core/discovery`.
   */
  readonly exclude: readonly string[];
  /**
   * Upstream git repositories this project depends on (org
   * project-manifest contract `dependencies:`). Each entry resolves to a
   * pinned snapshot in `markspec.lock`.
   */
  readonly dependencies: readonly ProjectRef[];
  /**
   * Published reference sites this project cites but does not depend on
   * (org project-manifest contract `references:`) — e.g. a shared RefHub.
   */
  readonly references: readonly ProjectRef[];
}

/** Default configuration used when no `project.yaml` is found. */
export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  name: "",
  version: "0.0.0",
  labels: [],
  parents: [],
  parentFallback: REFHUB_URL,
  captionConventions: {},
  exclude: [],
  dependencies: [],
  references: [],
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

// ---------------------------------------------------------------------------
// Body tokens (ADR-016)
// ---------------------------------------------------------------------------

/**
 * Inline-construct token kinds recognised in entry body prose (ADR-016).
 *
 * Split where at least one consumer fans out behaviour at the kind level
 * (`gherkin-section` → LSP `class` token vs `gherkin-step` → `keyword`),
 * collapsed elsewhere into discriminator fields on the token variant
 * (`modal.case`, `entity-ref.convention`).
 */
export type BodyTokenKind =
  | "modal" // shall, should, may, must, will (RFC 2119 lowercase canonical)
  | "ears-trigger" // When, While, If, Where, Then (in prose, outside feature fences)
  | "gherkin-section" // Feature, Background, Rule, Scenario, Examples (inside feature fences)
  | "gherkin-step" // Given, When, Then, And, But (inside feature fences)
  | "entity-ref" // $Identifier (any case convention, spec §2.5.2)
  | "inline-code"; // `…` span (mdast InlineCode projection)

/** Case form of a modal token — MSL-M060 targets `"upper"`. */
export type ModalCase = "lower" | "upper";

/** EARS trigger word — captured as a discriminator on `ears-trigger` tokens. */
export type EarsTrigger = "When" | "While" | "If" | "Where" | "Then";

/**
 * One inline-construct token emitted by the parser at extraction time.
 *
 * Discriminated union; consumers `switch` on `kind` for fan-out and read
 * the discriminator field (`case`, `trigger`, `convention`) when more
 * precision is needed. Locations are file-relative 1-based, matching
 * every other {@linkcode SourceLocation} in the model.
 */
export type BodyToken =
  | {
    readonly kind: "modal";
    readonly text: string;
    readonly case: ModalCase;
    readonly location: SourceLocation;
  }
  | {
    readonly kind: "ears-trigger";
    readonly text: string;
    readonly trigger: EarsTrigger;
    readonly location: SourceLocation;
  }
  | {
    readonly kind: "gherkin-section";
    readonly text: string;
    readonly location: SourceLocation;
  }
  | {
    readonly kind: "gherkin-step";
    readonly text: string;
    readonly location: SourceLocation;
  }
  | {
    readonly kind: "entity-ref";
    readonly text: string;
    readonly convention: EntityRefConvention;
    readonly location: SourceLocation;
  }
  | {
    readonly kind: "inline-code";
    readonly text: string;
    readonly location: SourceLocation;
  };

// ---------------------------------------------------------------------------
// Traceability graph
// ---------------------------------------------------------------------------

/**
 * Kind of directional link between entries — relation name lifted from the
 * source attribute.
 *
 * Open `string` so profile-declared relation names (e.g., from a profile's
 * `traceability:` declarations) can be used without changing core. The
 * canonical built-in kinds are enumerated in {@linkcode KNOWN_LINK_KINDS}.
 */
export type LinkKind = string;

/**
 * Built-in link kinds recognized by the core compiler and shipped profiles.
 *
 * Consumers that need to validate or enumerate the core-defined relation
 * vocabulary should use this constant rather than hard-coding string literals.
 * Profile-declared kinds extend this set at runtime.
 */
export const KNOWN_LINK_KINDS: readonly string[] = CORE_RELATIONS
  .filter((r) => r.linkKind)
  .map((r) => r.linkKind!);

/** A directional link between two entries in the traceability graph. */
export interface Link {
  readonly from: DisplayId;
  readonly to: DisplayId;
  readonly kind: LinkKind;
  readonly location: SourceLocation;
  /** How this link was produced. Absent means authored (default). */
  readonly origin?: "authored" | "generated";
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
  DeliveredDocument,
  DeliversDecl,
  DisciplineMode,
  DocTypeDef,
  EffectiveProfile,
  EffectiveTypeDef,
  EnforcementMode,
  InverseDecl,
  KindDecl,
  LabelConcern,
  LabelConcernKind,
  LabelValue,
  LoadedProfile,
  ProfileChain,
  ProfileConvention,
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
