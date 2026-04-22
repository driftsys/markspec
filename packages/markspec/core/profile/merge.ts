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
  ProvenancedValue,
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
 * Task 3.4: additive merge (union across tiers). Tasks 3.5–3.7 extend this
 * with tightening and subset rules.
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

  // Start from root, fold each subsequent tier.
  let effective = seedFromTier(tiers[0]);
  for (let i = 1; i < tiers.length; i++) {
    effective = foldTier(effective, tiers[i], diagnostics);
  }

  // If any merge error was recorded, drop the effective profile.
  const hasError = diagnostics.some((d) => d.severity === "error");
  return hasError
    ? { effective: null, diagnostics }
    : { effective, diagnostics };
}

/**
 * Apply a child tier's additions on top of the current accumulated
 * EffectiveProfile. Task 3.4 implements additive only; Tasks 3.5–3.7 extend
 * this with tightening and subset checks.
 */
function foldTier(
  base: EffectiveProfile,
  tier: LoadedProfile,
  diagnostics: Diagnostic[],
): EffectiveProfile {
  const origin: ProfileId = tier.id;
  const m = tier.manifest;

  // Universal additive.
  const required = unionList(base.required, m.universalRequired, origin);
  const labels = unionList(base.labels, m.labels, origin);
  const attributes = unionAttrMap(
    base.attributes,
    m.universalAttributes,
    origin,
    diagnostics,
  );

  // Shape scopes — same additive pattern.
  const identified: EffectiveShapeScope = {
    required: unionList(
      base.identified.required,
      m.identified.required,
      origin,
    ),
    attributes: unionAttrMap(
      base.identified.attributes,
      m.identified.attributes,
      origin,
      diagnostics,
    ),
    traceability: unionTraceMap(
      base.identified.traceability,
      m.identified.traceability,
      origin,
      diagnostics,
    ),
  };
  const referenced: EffectiveShapeScope = {
    required: unionList(
      base.referenced.required,
      m.referenced.required,
      origin,
    ),
    attributes: unionAttrMap(
      base.referenced.attributes,
      m.referenced.attributes,
      origin,
      diagnostics,
    ),
    traceability: base.referenced.traceability, // always empty
  };

  // Types — add new types, fold existing ones.
  const types = new Map(base.types);
  for (const [name, td] of m.types) {
    const existing = types.get(name);
    if (!existing) {
      // Fresh type contributed by this tier.
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
      types.set(name, { value: eff, origin });
    } else {
      const tightened = tightenType(
        existing,
        td,
        origin,
        diagnostics,
      );
      if (tightened) {
        types.set(name, tightened);
      }
      // If tightening failed, parent entry is kept (diagnostics already pushed).
    }
  }

  // Documents — add new doc types + frontMatter.
  const docTypes = new Map(base.documents.types);
  for (const dt of m.documents.types) {
    if (!docTypes.has(dt.id)) {
      docTypes.set(dt.id, { value: dt, origin });
    }
    // Overlap handling deferred.
  }
  const frontMatter = unionAttrMap(
    base.documents.frontMatter,
    m.documents.frontMatter,
    origin,
    diagnostics,
  );

  return {
    required,
    attributes,
    labels,
    identified,
    referenced,
    types,
    documents: {
      types: docTypes,
      frontMatter,
    },
  };
}

// ---------------------------------------------------------------------------
// Additive merge primitives
// ---------------------------------------------------------------------------

/**
 * Union of two string lists; parent entries first, child entries appended,
 * duplicates dropped. Origin = child tier if anything was added, else parent.
 */
function unionList(
  parent: ProvenancedValue<readonly string[]>,
  childList: readonly string[],
  childOrigin: ProfileId,
): ProvenancedValue<readonly string[]> {
  if (childList.length === 0) {
    return parent;
  }
  const seen = new Set(parent.value);
  const merged = [...parent.value];
  let anyAdded = false;
  for (const s of childList) {
    if (!seen.has(s)) {
      merged.push(s);
      seen.add(s);
      anyAdded = true;
    }
  }
  return anyAdded ? { value: merged, origin: childOrigin } : parent;
}

/**
 * Union of attribute maps. When the child redeclares an attribute the parent
 * already declared, the child's declaration must not relax the parent's
 * constraints (Task 3.5). Narrowing is allowed; relaxation records a
 * PROFILE-MERGE-001 diagnostic and keeps the parent entry so downstream code
 * still sees a valid attribute.
 */
function unionAttrMap(
  parent: ProvenancedMap<AttrDecl>,
  childAttrs: readonly AttrDecl[],
  childOrigin: ProfileId,
  diagnostics: Diagnostic[],
): ProvenancedMap<AttrDecl> {
  const out = new Map(parent);
  for (const a of childAttrs) {
    const existing = out.get(a.name);
    if (!existing) {
      out.set(a.name, { value: a, origin: childOrigin });
      continue;
    }
    const tightened = tightenAttr(
      existing,
      a,
      childOrigin,
      diagnostics,
    );
    if (tightened) {
      out.set(a.name, tightened);
    }
    // If tightening failed (returned undefined), diagnostics were recorded;
    // keep the parent entry so downstream code still sees a valid attribute.
  }
  return out;
}

/**
 * Tighten a parent attribute declaration with a child's redeclaration.
 * Returns the new effective entry on success, or `undefined` if the child
 * relaxes (caller records PROFILE-MERGE-001).
 */
function tightenAttr(
  existing: ProvenancedMapEntry<AttrDecl>,
  child: AttrDecl,
  childOrigin: ProfileId,
  diagnostics: Diagnostic[],
): ProvenancedMapEntry<AttrDecl> | undefined {
  const parent = existing.value;

  // Value-type must match exactly.
  if (parent.type !== child.type) {
    diagnostics.push(mergeRelaxation(
      `attribute '${parent.name}'`,
      "type",
      `${parent.type} (${existing.origin})`,
      `${child.type} (${childOrigin})`,
    ));
    return undefined;
  }

  // Cardinality: child lower ≥ parent lower AND child upper ≤ parent upper.
  if (child.cardinality.lower < parent.cardinality.lower) {
    diagnostics.push(mergeRelaxation(
      `attribute '${parent.name}'`,
      "cardinality.lower",
      `${parent.cardinality.lower} (${existing.origin})`,
      `${child.cardinality.lower} (${childOrigin})`,
    ));
    return undefined;
  }
  if (child.cardinality.upper > parent.cardinality.upper) {
    diagnostics.push(mergeRelaxation(
      `attribute '${parent.name}'`,
      "cardinality.upper",
      `${formatUpper(parent.cardinality.upper)} (${existing.origin})`,
      `${formatUpper(child.cardinality.upper)} (${childOrigin})`,
    ));
    return undefined;
  }

  // Required flag: once required, cannot be un-required.
  if (parent.required === true && child.required === false) {
    diagnostics.push(mergeRelaxation(
      `attribute '${parent.name}'`,
      "required",
      `true (${existing.origin})`,
      `false (${childOrigin})`,
    ));
    return undefined;
  }

  // Enum: child.values must be a subset of parent.values.
  if (parent.type === "enum") {
    const parentSet = new Set(parent.values ?? []);
    const childValues = child.values ?? [];
    for (const v of childValues) {
      if (!parentSet.has(v)) {
        diagnostics.push(mergeRelaxation(
          `attribute '${parent.name}'`,
          "enum values",
          `[${[...parentSet].join(",")}] (${existing.origin})`,
          `added '${v}' (${childOrigin})`,
        ));
        return undefined;
      }
    }
  }

  // Build the tightened value (field-by-field, child wins on narrower bounds).
  const merged: AttrDecl = {
    name: parent.name,
    type: parent.type,
    required: parent.required || child.required,
    cardinality: child.cardinality,
    values: parent.type === "enum" ? child.values : parent.values,
    inverse: child.inverse ?? parent.inverse,
  };
  const overrides = [
    ...(existing.overrides ?? []),
    existing.origin,
  ];
  return { value: merged, origin: childOrigin, overrides };
}

const ENFORCEMENT_ORDER: Record<string, number> = { off: 0, warn: 1, error: 2 };

/**
 * Tighten a parent type declaration with a child's redeclaration. Returns the
 * new effective entry on success, or `undefined` if the child relaxes (caller
 * keeps the parent entry; diagnostics already recorded).
 */
function tightenType(
  existing: ProvenancedMapEntry<EffectiveTypeDef>,
  child: TypeDef,
  childOrigin: ProfileId,
  diagnostics: Diagnostic[],
): ProvenancedMapEntry<EffectiveTypeDef> | undefined {
  const name = child.name;
  const effExisting = existing.value;

  // Shape must match.
  if (effExisting.shape !== child.shape) {
    diagnostics.push(mergeRelaxation(
      `type '${name}'`,
      "shape",
      `${effExisting.shape} (${existing.origin})`,
      `${child.shape} (${childOrigin})`,
    ));
    return undefined;
  }

  // Display-ID pattern: if parent set one, child cannot change it. If parent
  // had none, child may set it.
  let displayIdPattern = effExisting.displayIdPattern;
  if (child.displayIdPattern !== undefined) {
    if (
      effExisting.displayIdPattern.value !== undefined &&
      effExisting.displayIdPattern.value !== child.displayIdPattern
    ) {
      diagnostics.push(mergeRelaxation(
        `type '${name}'`,
        "display-id-pattern",
        `'${effExisting.displayIdPattern.value}' (${effExisting.displayIdPattern.origin})`,
        `'${child.displayIdPattern}' (${childOrigin})`,
      ));
      return undefined;
    }
    if (effExisting.displayIdPattern.value === undefined) {
      // Parent had no pattern — child contributes it.
      displayIdPattern = { value: child.displayIdPattern, origin: childOrigin };
    }
  }

  // Enforcement — tighten only (off < warn < error).
  let enforcement = effExisting.displayIdPatternEnforcement;
  if (child.displayIdPatternEnforcement !== enforcement.value) {
    const parentLevel = ENFORCEMENT_ORDER[enforcement.value];
    const childLevel = ENFORCEMENT_ORDER[child.displayIdPatternEnforcement];
    if (childLevel < parentLevel) {
      diagnostics.push(mergeRelaxation(
        `type '${name}'`,
        "display-id-pattern-enforcement",
        `${enforcement.value} (${enforcement.origin})`,
        `${child.displayIdPatternEnforcement} (${childOrigin})`,
      ));
      return undefined;
    }
    enforcement = {
      value: child.displayIdPatternEnforcement,
      origin: childOrigin,
    };
  }

  // Fold child's attributes + traceability + required (same additive/tightening
  // primitives as the existing fold).
  const attributes = unionAttrMap(
    effExisting.attributes,
    child.attributes,
    childOrigin,
    diagnostics,
  );
  const traceability = unionTraceMap(
    effExisting.traceability,
    child.traceability,
    childOrigin,
    diagnostics,
  );
  const required = unionList(
    effExisting.required,
    child.required,
    childOrigin,
  );

  const merged: EffectiveTypeDef = {
    name,
    shape: effExisting.shape,
    displayIdPattern,
    displayIdPatternEnforcement: enforcement,
    required,
    attributes,
    traceability,
  };
  const overrides = [
    ...(existing.overrides ?? []),
    existing.origin,
  ];
  return { value: merged, origin: childOrigin, overrides };
}

function mergeRelaxation(
  subject: string,
  field: string,
  parentView: string,
  childView: string,
): Diagnostic {
  return {
    code: "PROFILE-MERGE-001",
    severity: "error",
    message:
      `${subject}: field '${field}' relaxed by child (parent: ${parentView}, child: ${childView})`,
    location: { file: "<merge>", line: 1, column: 1 },
  };
}

function formatUpper(u: number): string {
  return u === Infinity ? "N" : String(u);
}

/**
 * Union of traceability rule maps, same pattern as attributes.
 */
function unionTraceMap(
  parent: ProvenancedMap<TraceRule>,
  childTrace: ReadonlyMap<string, TraceRule>,
  childOrigin: ProfileId,
  _diagnostics: Diagnostic[],
): ProvenancedMap<TraceRule> {
  const out = new Map(parent);
  for (const [name, rule] of childTrace) {
    const existing = out.get(name);
    if (!existing) {
      out.set(name, { value: rule, origin: childOrigin });
    } else {
      const overrides = [
        ...(existing.overrides ?? []),
        childOrigin,
      ];
      out.set(name, { ...existing, overrides });
    }
  }
  return out;
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
