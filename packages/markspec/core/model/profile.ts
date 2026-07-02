/**
 * @module model/profile
 *
 * Profile data model — TypeScript types that mirror ADR-008 §4 manifest
 * schema. Used by the profile loader, merger, and validator.
 */

// ---------------------------------------------------------------------------
// Value types (ADR-002 Annex C)
// ---------------------------------------------------------------------------

/** All 14 attribute value-type keywords recognized by the core. */
export const VALUE_TYPES = [
  "id",
  "id-list",
  "uri",
  "url",
  "path",
  "path-or-id",
  "enum",
  "tag-list",
  "text",
  "citation",
  "external-id",
  "integer",
  "date",
  "boolean",
] as const;

export type ValueType = typeof VALUE_TYPES[number];

/** Types whose default cardinality is a list (`0..N`). */
export const LIST_VALUE_TYPES: ReadonlySet<ValueType> = new Set([
  "id-list",
  "tag-list",
]);

// ---------------------------------------------------------------------------
// Cardinality
// ---------------------------------------------------------------------------

/** Count bounds `lower..upper` where upper = Infinity represents `N`. */
export interface Cardinality {
  readonly lower: number;
  readonly upper: number; // Infinity when upper is N
}

// ---------------------------------------------------------------------------
// Attribute declaration
// ---------------------------------------------------------------------------

/** Inverse declaration for link attributes (`id` / `id-list`). */
export interface InverseDecl {
  readonly name: string;
  readonly category: string; // type name where inverse appears
}

/** A single attribute declaration within a profile scope. */
export interface AttrDecl {
  readonly name: string; // Title-Case trailer convention
  readonly type: ValueType;
  readonly required: boolean;
  readonly cardinality: Cardinality; // inferred from type if unspecified
  readonly values?: readonly string[]; // required when type === "enum"
  readonly inverse?: InverseDecl; // only valid when type is "id" or "id-list"
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Traceability rule
// ---------------------------------------------------------------------------

/** Target matcher: either a type name or a shape matcher object. */
export type TargetMatcher = string | {
  readonly shape: "Authored" | "Reference";
};

/** Traceability rule declared on a shape or type scope. */
export interface TraceRule {
  readonly target: readonly TargetMatcher[];
  readonly cardinality?: Cardinality;
  readonly required: boolean;
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Label concerns (profile.labels: dual-form)
// ---------------------------------------------------------------------------

export type LabelConcernKind = "enum" | "set" | "flag";

export interface LabelValue {
  readonly name: string;
  readonly description?: string;
}

export interface LabelConcern {
  readonly name: string;
  readonly kind: LabelConcernKind;
  readonly description?: string;
  readonly values: readonly LabelValue[];
}

// ---------------------------------------------------------------------------
// Conventions
// ---------------------------------------------------------------------------

export interface ProfileConvention {
  readonly name: string;
  readonly settings: Readonly<Record<string, string>>;
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Discipline mode (ADR-017 Slice 5)
// ---------------------------------------------------------------------------

/**
 * Resolved discipline mode per ADR-017 Slice 5. The mode shapes
 * downstream behaviour (Doctor reporting, LSP scaffold ordering,
 * Slice 4 mixed-allocation rule activation).
 */
export type DisciplineMode = "flat" | "tiered" | "none";

// ---------------------------------------------------------------------------
// Discipline kind declaration
// ---------------------------------------------------------------------------

/** A profile-declared discipline kind. */
export interface KindDecl {
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Type definition
// ---------------------------------------------------------------------------

export type EnforcementMode = "off" | "warn" | "error";

export interface TypeDef {
  readonly name: string;
  /** The core type this profile type extends (e.g., "Requirement", "Test"). */
  readonly extends: string;
  readonly displayIdPattern?: string;
  readonly displayIdPatternEnforcement: EnforcementMode;
  readonly required: readonly string[];
  readonly attributes: readonly AttrDecl[];
  readonly traceability: ReadonlyMap<string, TraceRule>;
  /** Optional semantic color-role name (key into `ProfileManifest.colors`). */
  readonly color?: string;
  readonly description?: string;
  /**
   * Discipline kind explicitly assigned to this type. When absent, the
   * effective discipline registry auto-inherits from the type's `extends:`
   * ancestor (see core/profile/discipline_registry.ts).
   */
  readonly discipline?: string;
}

// ---------------------------------------------------------------------------
// Document scope
// ---------------------------------------------------------------------------

export interface DocTypeDef {
  readonly id: string;
  readonly contains: readonly string[];
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Delivered documents (ADR-030)
// ---------------------------------------------------------------------------

/**
 * One `profile.delivers:` item as authored in `markspec.yaml`. `path` is
 * relative to the profile directory, `/`-separated, and validated at parse
 * time to stay inside it. `corpus: true` marks a Markdown file whose entries
 * join the consuming project's traceability graph (ADR-030); default `false`
 * means documentation-only.
 */
export interface DeliversDecl {
  readonly path: string;
  readonly corpus: boolean;
  readonly description?: string;
}

/**
 * A delivered document after chain resolution (ADR-030): the manifest's
 * `DeliversDecl` joined with the delivering tier's identity and on-disk
 * location. `absPath` is `join(tier.baseDir, path)`.
 */
export interface DeliveredDocument {
  readonly profileId: string;
  readonly profileVersion: string;
  readonly path: string;
  readonly absPath: string;
  readonly corpus: boolean;
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Profile manifest
// ---------------------------------------------------------------------------

/** Specifier scheme identifying where a profile lives. */
export type ProfileSpecifier =
  | { readonly kind: "local"; readonly path: string }
  | {
    readonly kind: "git";
    readonly repo: string;
    readonly subpath?: string;
    readonly tag: string;
  }
  | {
    readonly kind: "npm";
    readonly scope?: string;
    readonly name: string;
    readonly range: string;
  }
  | { readonly kind: "builtin" };

/** Parsed `markspec.yaml` content — the manifest authored in a profile. */
export interface ProfileManifest {
  // top-level fields
  readonly id: string;
  readonly version: string;
  /** The `markspec-schema:` pin declaring the core schema version targeted. */
  readonly markspecSchema?: string;
  readonly description?: string;
  readonly license?: string;
  readonly extends?: ProfileSpecifier;

  // profile: content section
  readonly universalAttributes: readonly AttrDecl[];
  readonly labels: readonly LabelConcern[];
  readonly conventions: readonly ProfileConvention[];

  /**
   * Semantic color-role bindings authored on this manifest.
   * Maps a profile-author-chosen name (e.g. "primary") to a palette hue
   * name (one of "blue", "cyan", "teal", "orange", "red", "purple", "grey").
   * Empty when the manifest does not declare `profile.colors:`.
   */
  readonly colors: ReadonlyMap<string, string>;

  readonly types: ReadonlyMap<string, TypeDef>;

  readonly documents: {
    readonly types: readonly DocTypeDef[];
    readonly frontMatter: readonly AttrDecl[];
  };

  /** Files this profile delivers to consumers (ADR-030). Empty when the
   * manifest declares no `profile.delivers:`. */
  readonly delivers: readonly DeliversDecl[];

  /**
   * Profile-declared discipline kinds (ADR-017 Invariant 2). Maps kind
   * name → declaration metadata. Empty when the manifest does not declare
   * `profile.kinds:`.
   */
  readonly kinds: ReadonlyMap<string, KindDecl>;

  /**
   * Prose-analysis configuration. All lexicon lists are additive across
   * the profile chain (parent entries first, child entries appended,
   * duplicates dropped).
   */
  readonly prose: {
    readonly lexicons: {
      /** Extra tokens that are never flagged as undefined capitalized terms. */
      readonly "capitalized-allow": readonly string[];
      /** Extra abbreviation tokens that suppress false sentence-end detection. */
      readonly "sentence-abbrev": readonly string[];
    };
  };

  /**
   * Author-declared discipline mode (ADR-017 Slice 5). `undefined` when
   * the manifest does not declare `profile.discipline-mode:`; the merge
   * layer then runs inference to populate `EffectiveProfile.disciplineMode`.
   */
  readonly disciplineMode?: DisciplineMode;
}

// ---------------------------------------------------------------------------
// Runtime: loaded profile + chain
// ---------------------------------------------------------------------------

/**
 * A profile after it has been resolved and parsed. One tier of a
 * {@linkcode ProfileChain}.
 *
 * `sourcePath` is the absolute path of the `markspec.yaml` the manifest was
 * parsed from. `baseDir` is the directory containing that file — used as the
 * context for resolving this profile's `extends:` (in Phase 3+).
 */
export interface LoadedProfile {
  readonly id: string;
  readonly version: string;
  readonly specifier: ProfileSpecifier;
  readonly manifest: ProfileManifest;
  readonly sourcePath: string;
  readonly baseDir: string;
}

/**
 * The resolved profile chain for a project. A Phase 2 chain always contains
 * exactly one tier (no `extends:` walking). Phase 3 introduces multi-tier
 * chains ordered root-parent → leaf-child.
 */
export interface ProfileChain {
  readonly tiers: readonly LoadedProfile[];
  readonly effective: EffectiveProfile;
}

// ---------------------------------------------------------------------------
// Runtime: effective profile (merged chain) + provenance wrappers
// ---------------------------------------------------------------------------

/** Identifier of the profile (tier) that contributed a value — `manifest.id`. */
export type ProfileId = string;

/** A single value annotated with the profile it originated from. */
export interface ProvenancedValue<T> {
  readonly value: T;
  readonly origin: ProfileId;
}

/**
 * A map-valued entry: the current effective value, the tier that set it, and
 * the ordered list of parent tiers whose values this entry narrowed or
 * replaced. Used for fields where children can override parents (attributes,
 * traceability rules, type definitions).
 */
export interface ProvenancedMapEntry<V> {
  readonly value: V;
  readonly origin: ProfileId;
  readonly overrides?: readonly ProfileId[];
}

/** Map with per-entry provenance. Keys are always strings (attr/type/link names). */
export type ProvenancedMap<V> = ReadonlyMap<string, ProvenancedMapEntry<V>>;

/** Type-scope rules after merging. */
export interface EffectiveTypeDef {
  readonly name: string;
  /** The core type this profile type extends — frozen at declaration, never changes across the chain. */
  readonly extends: string;
  readonly displayIdPattern: ProvenancedValue<string | undefined>;
  readonly displayIdPatternEnforcement: ProvenancedValue<EnforcementMode>;
  /** Resolved semantic color-role name, or `undefined` when unset. */
  readonly color: ProvenancedValue<string | undefined>;
  readonly required: ProvenancedValue<readonly string[]>;
  readonly attributes: ProvenancedMap<AttrDecl>;
  readonly traceability: ProvenancedMap<TraceRule>;
  readonly description: ProvenancedValue<string | undefined>;
  readonly attrDescriptions: ProvenancedMap<string>;
  readonly relationDescriptions: ProvenancedMap<string>;
  /**
   * Discipline kind explicitly assigned to this type by some tier of the
   * profile chain. `value` is `undefined` when no tier assigned one — the
   * registry builder then walks the `extends:` chain to resolve.
   */
  readonly discipline: ProvenancedValue<string | undefined>;
}

/**
 * The merged, validator-ready view of a profile chain. Every field carries
 * per-rule provenance so a diagnostic can blame the right tier.
 */
export interface EffectiveProfile {
  readonly attributes: ProvenancedMap<AttrDecl>;
  readonly labels: ProvenancedMap<LabelConcern>;
  readonly conventions: ProvenancedMap<ProfileConvention>;
  /** Semantic color-role bindings merged across the chain. */
  readonly colors: ProvenancedMap<string>;
  readonly types: ProvenancedMap<EffectiveTypeDef>;
  readonly documents: {
    readonly types: ProvenancedMap<DocTypeDef>;
    readonly frontMatter: ProvenancedMap<AttrDecl>;
  };
  /**
   * Documents delivered by the chain (ADR-030), parent-first then manifest
   * order — the deterministic corpus injection order. Deduped by
   * `(profileId, path)`.
   */
  readonly delivers: readonly DeliveredDocument[];
  /** Discipline kinds declared across the profile chain (ADR-017). */
  readonly kinds: ProvenancedMap<KindDecl>;
  /**
   * Prose-analysis configuration merged across the chain. Each lexicon list
   * is list-additive: parent entries first, child entries appended, duplicates
   * dropped (profile-schema §5.1).
   */
  readonly prose: {
    readonly lexicons: {
      readonly "capitalized-allow": ProvenancedValue<readonly string[]>;
      readonly "sentence-abbrev": ProvenancedValue<readonly string[]>;
    };
  };
  /**
   * Resolved discipline mode after the chain folds (ADR-017 Slice 5).
   * Always defined — `origin` is `"declared"` when at least one tier
   * supplied a value, otherwise `"inferred"` (computed from the
   * effective type graph by `inferDisciplineMode()`).
   */
  readonly disciplineMode: ProvenancedValue<DisciplineMode>;
}
