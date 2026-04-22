/**
 * @module core/profile/merge
 *
 * Fold a {@linkcode ProfileChain} into a single {@linkcode EffectiveProfile},
 * applying additive, tightening, and subset merge rules across tiers
 * (root → leaf). Violations surface as `PROFILE-MERGE-*` diagnostics.
 *
 * Merge happens once at load. Callers should not call `mergeChain` lazily.
 */

import type {
  AttrDecl,
  Diagnostic,
  DocTypeDef,
  EffectiveProfile,
  EffectiveShapeScope,
  EffectiveTypeDef,
  LoadedProfile,
  ProfileChain,
  ProfileId,
  ProfileManifest,
  ProvenancedMap,
  ProvenancedMapEntry,
  TraceRule,
  TypeDef,
} from "../model/mod.ts";

/** Result of merging a {@linkcode ProfileChain}. */
export interface MergeResult {
  /** The merged profile, or `null` when any merge constraint was violated. */
  readonly effective: EffectiveProfile | null;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Merge all tiers of a chain into one EffectiveProfile. Tiers are processed
 * in root → leaf order; later tiers can add to or tighten earlier tiers'
 * rules. Returns `{ effective: null }` if any tier relaxes an ancestor.
 *
 * Task 3.3 scaffold: single-tier identity merge. Tasks 3.4–3.7 extend this
 * with additive, tightening, and subset rules.
 */
export function mergeChain(chain: ProfileChain): MergeResult {
  const diagnostics: Diagnostic[] = [];
  const tiers = chain.tiers;
  if (tiers.length === 0) {
    return {
      effective: null,
      diagnostics: [
        {
          code: "PROFILE-MERGE-001",
          severity: "error",
          message: "cannot merge an empty profile chain",
          location: { file: "<chain>", line: 1, column: 1 },
        },
      ],
    };
  }

  // Start with the root tier's universal + shape + types, annotated with that
  // tier's id as origin. Subsequent tasks fold additional tiers.
  const effective = seedFromTier(tiers[0]);
  return { effective, diagnostics };
}

// ---------------------------------------------------------------------------
// Helpers: construct an EffectiveProfile from a single tier's manifest.
// ---------------------------------------------------------------------------

function seedFromTier(tier: LoadedProfile): EffectiveProfile {
  const origin: ProfileId = tier.id;
  const m = tier.manifest;

  return {
    required: { value: m.universalRequired, origin },
    attributes: mapFromAttrList(m.universalAttributes, origin),
    labels: { value: m.labels, origin },
    identified: buildShapeScope(m.identified, origin),
    referenced: {
      required: { value: m.referenced.required, origin },
      attributes: mapFromAttrList(m.referenced.attributes, origin),
      traceability: new Map(),
    },
    types: mapFromTypes(m.types, origin),
    documents: {
      types: mapFromDocTypes(m.documents.types, origin),
      frontMatter: mapFromAttrList(m.documents.frontMatter, origin),
    },
  };
}

function buildShapeScope(
  raw: ProfileManifest["identified"],
  origin: ProfileId,
): EffectiveShapeScope {
  return {
    required: { value: raw.required, origin },
    attributes: mapFromAttrList(raw.attributes, origin),
    traceability: mapFromTrace(raw.traceability, origin),
  };
}

function mapFromAttrList(
  attrs: readonly AttrDecl[],
  origin: ProfileId,
): ProvenancedMap<AttrDecl> {
  const out = new Map<string, ProvenancedMapEntry<AttrDecl>>();
  for (const a of attrs) {
    out.set(a.name, { value: a, origin });
  }
  return out;
}

function mapFromTrace(
  trace: ReadonlyMap<string, TraceRule>,
  origin: ProfileId,
): ProvenancedMap<TraceRule> {
  const out = new Map<string, ProvenancedMapEntry<TraceRule>>();
  for (const [name, rule] of trace) {
    out.set(name, { value: rule, origin });
  }
  return out;
}

function mapFromTypes(
  types: ReadonlyMap<string, TypeDef>,
  origin: ProfileId,
): ProvenancedMap<EffectiveTypeDef> {
  const out = new Map<string, ProvenancedMapEntry<EffectiveTypeDef>>();
  for (const [name, td] of types) {
    const eff: EffectiveTypeDef = {
      name,
      shape: td.shape,
      displayIdPattern: { value: td.displayIdPattern, origin },
      displayIdPatternEnforcement: {
        value: td.displayIdPatternEnforcement,
        origin,
      },
      required: { value: td.required, origin },
      attributes: mapFromAttrList(td.attributes, origin),
      traceability: mapFromTrace(td.traceability, origin),
    };
    out.set(name, { value: eff, origin });
  }
  return out;
}

function mapFromDocTypes(
  docTypes: readonly DocTypeDef[],
  origin: ProfileId,
): ProvenancedMap<DocTypeDef> {
  const out = new Map<string, ProvenancedMapEntry<DocTypeDef>>();
  for (const dt of docTypes) {
    out.set(dt.id, { value: dt, origin });
  }
  return out;
}
