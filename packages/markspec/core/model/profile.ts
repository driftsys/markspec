/**
 * @module model/profile
 *
 * Profile data model — TypeScript types that mirror ADR-008 §4 manifest
 * schema. Used by the profile loader, merger, and validator.
 */

import type { EntryShape } from "./mod.ts";

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
}

// ---------------------------------------------------------------------------
// Traceability rule
// ---------------------------------------------------------------------------

/** Target matcher: either a type name or a shape matcher object. */
export type TargetMatcher = string | {
  readonly shape: "identified" | "referenced";
};

/** Traceability rule declared on a shape or type scope. */
export interface TraceRule {
  readonly target: readonly TargetMatcher[];
  readonly cardinality?: Cardinality;
  readonly required: boolean;
}

// ---------------------------------------------------------------------------
// Type definition
// ---------------------------------------------------------------------------

export type EnforcementMode = "off" | "warn" | "error";

export interface TypeDef {
  readonly name: string;
  readonly shape: EntryShape;
  readonly displayIdPattern?: string;
  readonly displayIdPatternEnforcement: EnforcementMode;
  readonly required: readonly string[];
  readonly attributes: readonly AttrDecl[];
  readonly traceability: ReadonlyMap<string, TraceRule>;
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
  };

/** Parsed `markspec.yaml` content — the manifest authored in a profile. */
export interface ProfileManifest {
  // top-level fields
  readonly id: string;
  readonly version: string;
  readonly description?: string;
  readonly license?: string;
  readonly extends?: ProfileSpecifier;

  // profile: content section
  readonly universalRequired: readonly string[];
  readonly universalAttributes: readonly AttrDecl[];
  readonly labels: readonly string[];

  readonly identified: {
    readonly required: readonly string[];
    readonly attributes: readonly AttrDecl[];
    readonly traceability: ReadonlyMap<string, TraceRule>;
  };
  readonly referenced: {
    readonly required: readonly string[];
    readonly attributes: readonly AttrDecl[];
  };

  readonly types: ReadonlyMap<string, TypeDef>;

  readonly documents: {
    readonly types: readonly DocTypeDef[];
    readonly frontMatter: readonly AttrDecl[];
  };
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
}
