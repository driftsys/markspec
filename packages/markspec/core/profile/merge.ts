/**
 * @module core/profile/merge
 *
 * Fold a {@linkcode ProfileChain} into a single {@linkcode EffectiveProfile},
 * applying additive, tightening, and subset merge rules across tiers
 * (root → leaf). Violations surface as `PROFILE-MERGE-*` diagnostics.
 *
 * Merge happens once at load. Callers should not call `mergeChain` lazily.
 */

import { CORE_KINDS } from "../model/mod.ts";
import type {
  AttrDecl,
  Diagnostic,
  DisciplineMode,
  DocTypeDef,
  EffectiveProfile,
  EffectiveTypeDef,
  KindDecl,
  LabelConcern,
  LoadedProfile,
  ProfileChain,
  ProfileConvention,
  ProfileId,
  ProvenancedMap,
  ProvenancedMapEntry,
  ProvenancedValue,
  TargetMatcher,
  TraceRule,
  TypeDef,
} from "../model/mod.ts";
import { resolveDisciplineMode } from "./discipline_mode.ts";

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

  // TODO(Phase 5): §3.3 cross-scope layering within one profile.
  // The spec requires that tightening rules apply across scopes within a
  // single tier (profile.required ⊂ shape.required ⊂ type.required etc.).
  // Phase 3 implements cross-tier merging only; within-tier scope coherence
  // is deferred to the validator pipeline which sees the final EffectiveProfile.
  // When Phase 5 lands the validator, add a check here (or in a separate
  // validateScopeLayering helper) to catch a profile whose type-scope
  // required is narrower than its shape-scope required, for example.

  // Start from root, fold each subsequent tier.
  let effective = seedFromTier(tiers[0]);

  // ADR-017 Slice 5: LWW accumulator for declared discipline-mode across
  // tiers. Initialized from the seed tier; updated on each subsequent tier
  // that supplies a value. Resolved post-fold via resolveDisciplineMode().
  let declaredMode:
    | { value: DisciplineMode; origin: ProfileId }
    | undefined;
  const seedMode = tiers[0].manifest.disciplineMode;
  if (seedMode !== undefined) {
    declaredMode = {
      value: seedMode,
      origin: tiers[0].manifest.id as ProfileId,
    };
  }

  for (let i = 1; i < tiers.length; i++) {
    effective = foldTier(effective, tiers[i], diagnostics);
    const tierMode = tiers[i].manifest.disciplineMode;
    if (tierMode !== undefined) {
      declaredMode = {
        value: tierMode,
        origin: tiers[i].manifest.id as ProfileId,
      };
    }
  }

  // Validate per-type color references against the FINAL merged colors map.
  // Running this only after all tiers fold avoids false positives when a parent
  // tier references a color that a child tier supplies in its colors: block.
  validateTypeColors(
    effective,
    diagnostics,
    tiers[tiers.length - 1].sourcePath,
  );
  validateTypeDisciplines(
    effective,
    diagnostics,
    tiers[tiers.length - 1].sourcePath,
  );

  // ADR-017 Slice 5: resolve disciplineMode AFTER the full chain has folded
  // so inference sees the final type graph. The accumulator `declaredMode`
  // (set above) carries the LWW-declared value across tiers.
  effective = {
    ...effective,
    disciplineMode: resolveDisciplineMode(effective, declaredMode),
  };

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
  const labels = unionLabelMap(base.labels, m.labels, origin, diagnostics);
  const conventions = unionConventionsMap(
    base.conventions,
    m.conventions,
    origin,
  );
  const attributes = unionAttrMap(
    base.attributes,
    m.universalAttributes,
    origin,
    diagnostics,
  );

  // Colors map: last-write-wins per key, additive across tiers.
  const colors = unionColorsMap(base.colors, m.colors, origin);

  // Kinds map: additive across tiers, child wins on description.
  const kinds = unionKindsMap(base.kinds, m.kinds, origin);

  // Types — add new types, fold existing ones.
  const types = new Map(base.types);
  for (const [name, td] of m.types) {
    const existing = types.get(name);
    if (!existing) {
      // Fresh type contributed by this tier.
      const eff: EffectiveTypeDef = {
        name,
        extends: td.extends,
        displayIdPattern: { value: td.displayIdPattern, origin },
        displayIdPatternEnforcement: {
          value: td.displayIdPatternEnforcement,
          origin,
        },
        color: { value: td.color, origin },
        required: { value: td.required, origin },
        attributes: mapFromAttrList(td.attributes, origin),
        traceability: mapFromTrace(td.traceability, origin),
        description: { value: td.description, origin },
        attrDescriptions: mapFromAttrDescriptions(td.attributes, origin),
        relationDescriptions: mapFromTraceDescriptions(td.traceability, origin),
        discipline: { value: td.discipline, origin },
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

  // Prose lexicons: list-additive across tiers (profile-schema §5.1).
  const capAllow = unionList(
    base.prose.lexicons["capitalized-allow"],
    m.prose.lexicons["capitalized-allow"],
    origin,
  );
  const sentAbbrev = unionList(
    base.prose.lexicons["sentence-abbrev"],
    m.prose.lexicons["sentence-abbrev"],
    origin,
  );

  const result: EffectiveProfile = {
    attributes,
    labels,
    conventions,
    colors,
    types,
    documents: {
      types: docTypes,
      frontMatter,
    },
    kinds,
    prose: {
      lexicons: {
        "capitalized-allow": capAllow,
        "sentence-abbrev": sentAbbrev,
      },
    },
    disciplineMode: { value: "none", origin: "inferred" },
  };

  return result;
}

// ---------------------------------------------------------------------------
// Additive merge primitives
// ---------------------------------------------------------------------------

/**
 * Union of color maps: last-write-wins per key, additive across tiers.
 * Each redefinition in a child tier overrides the parent's binding for that
 * key while preserving the override history for provenance.
 */
function unionColorsMap(
  parent: ProvenancedMap<string>,
  childColors: ReadonlyMap<string, string>,
  childOrigin: ProfileId,
): ProvenancedMap<string> {
  if (childColors.size === 0) {
    return parent;
  }
  const out = new Map(parent);
  for (const [name, hue] of childColors) {
    const prior = out.get(name);
    out.set(name, {
      value: hue,
      origin: childOrigin,
      overrides: prior ? [...(prior.overrides ?? []), prior.origin] : undefined,
    });
  }
  return out;
}

/**
 * Validate per-type `color:` references resolve to a name declared in the
 * effective `colors:` map. Emits MSL-PROFILE-COLOR-003 for unknown names.
 * Validation runs against the FINAL effective type entry (after all tiers
 * have folded), so only the latest tier's color choice is checked.
 */
function validateTypeColors(
  effective: EffectiveProfile,
  diagnostics: Diagnostic[],
  fallbackFile: string,
): void {
  for (const [typeName, entry] of effective.types) {
    const colorName = entry.value.color.value;
    if (colorName === undefined) continue;
    if (!effective.colors.has(colorName)) {
      diagnostics.push({
        code: "MSL-PROFILE-COLOR-003",
        severity: "error",
        message:
          `type '${typeName}' references unknown color '${colorName}' (not declared in profile.colors of this profile or any parent)`,
        location: { file: fallbackFile, line: 1, column: 1 },
      });
    }
  }
}

/**
 * After the full chain folds, verify each type's `discipline.value` (when
 * set) names a kind that is in the merged `effective.kinds` map ∪
 * CORE_KINDS. Emits PROFILE-DISCIPLINE-004 for each violation. Runs after
 * the merge because a parent tier's kind must be visible to a child
 * tier's type.
 */
function validateTypeDisciplines(
  effective: EffectiveProfile,
  diagnostics: Diagnostic[],
  fallbackFile: string,
): void {
  for (const [typeName, entry] of effective.types) {
    const value = entry.value.discipline.value;
    if (value === undefined) continue;
    if (CORE_KINDS.has(value)) continue;
    if (effective.kinds.has(value)) continue;
    diagnostics.push({
      code: "PROFILE-DISCIPLINE-004",
      severity: "error",
      message:
        `type '${typeName}' references unknown discipline kind '${value}' (declare it under profile.kinds: in this profile or a parent)`,
      location: { file: fallbackFile, line: 1, column: 1 },
    });
  }
}

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
      "PROFILE-MERGE-011",
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
    description: child.description !== undefined
      ? child.description
      : parent.description,
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

  // extends: must match — conflicting core-type targets is a merge error.
  if (effExisting.extends !== child.extends) {
    diagnostics.push(mergeRelaxation(
      `type '${name}'`,
      "extends",
      `${effExisting.extends} (${existing.origin})`,
      `${child.extends} (${childOrigin})`,
      "PROFILE-MERGE-012",
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

  // Color: child overrides parent when set; otherwise parent's color stays.
  const color = child.color !== undefined
    ? { value: child.color, origin: childOrigin }
    : effExisting.color;

  // Description: child wins when set; else inherit parent provenance unchanged.
  const description: ProvenancedValue<string | undefined> =
    child.description !== undefined
      ? { value: child.description, origin: childOrigin }
      : effExisting.description;

  // Discipline: child wins when set; otherwise parent stays.
  const discipline: ProvenancedValue<string | undefined> =
    child.discipline !== undefined
      ? { value: child.discipline, origin: childOrigin }
      : effExisting.discipline;

  const attrDescriptions = mergeDescriptionMap(
    effExisting.attrDescriptions,
    child.attributes.map((a) => ({ name: a.name, desc: a.description })),
    childOrigin,
  );

  const relationDescriptions = mergeDescriptionMap(
    effExisting.relationDescriptions,
    [...child.traceability.entries()].map(([name, r]) => ({
      name,
      desc: r.description,
    })),
    childOrigin,
  );

  const merged: EffectiveTypeDef = {
    name,
    extends: effExisting.extends,
    displayIdPattern,
    displayIdPatternEnforcement: enforcement,
    color,
    required,
    attributes,
    traceability,
    description,
    attrDescriptions,
    relationDescriptions,
    discipline,
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
  code: string = "PROFILE-MERGE-010",
): Diagnostic {
  return {
    code,
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
  diagnostics: Diagnostic[],
): ProvenancedMap<TraceRule> {
  const out = new Map(parent);
  for (const [name, rule] of childTrace) {
    const existing = out.get(name);
    if (!existing) {
      out.set(name, { value: rule, origin: childOrigin });
      continue;
    }
    const tightened = tightenTraceRule(
      existing,
      name,
      rule,
      childOrigin,
      diagnostics,
    );
    if (tightened) {
      out.set(name, tightened);
    }
  }
  return out;
}

function tightenTraceRule(
  existing: ProvenancedMapEntry<TraceRule>,
  linkName: string,
  child: TraceRule,
  childOrigin: ProfileId,
  diagnostics: Diagnostic[],
): ProvenancedMapEntry<TraceRule> | undefined {
  const parent = existing.value;

  // Subset check: every child target must be covered by some parent target.
  for (const ct of child.target) {
    if (!targetCoveredBy(ct, parent.target)) {
      diagnostics.push({
        code: "PROFILE-MERGE-002",
        severity: "error",
        message: `traceability '${linkName}': child target ${
          stringifyMatcher(ct)
        } not covered by parent target [${
          parent.target.map(stringifyMatcher).join(", ")
        }] (${existing.origin} vs ${childOrigin})`,
        location: { file: "<merge>", line: 1, column: 1 },
      });
      return undefined;
    }
  }

  // Cardinality tightening (same rule as attribute cardinality).
  let cardinality = parent.cardinality;
  if (child.cardinality !== undefined) {
    const parentCard = parent.cardinality ?? { lower: 0, upper: Infinity };
    if (child.cardinality.lower < parentCard.lower) {
      diagnostics.push(mergeRelaxation(
        `traceability '${linkName}'`,
        "cardinality.lower",
        `${parentCard.lower} (${existing.origin})`,
        `${child.cardinality.lower} (${childOrigin})`,
      ));
      return undefined;
    }
    if (child.cardinality.upper > parentCard.upper) {
      diagnostics.push(mergeRelaxation(
        `traceability '${linkName}'`,
        "cardinality.upper",
        `${formatUpper(parentCard.upper)} (${existing.origin})`,
        `${formatUpper(child.cardinality.upper)} (${childOrigin})`,
      ));
      return undefined;
    }
    cardinality = child.cardinality;
  }

  // Required flag: once required, cannot be un-required.
  if (parent.required === true && child.required === false) {
    diagnostics.push(mergeRelaxation(
      `traceability '${linkName}'`,
      "required",
      `true (${existing.origin})`,
      `false (${childOrigin})`,
    ));
    return undefined;
  }

  const merged: TraceRule = {
    target: child.target, // already proven to be a subset
    cardinality,
    required: parent.required || child.required,
  };
  const overrides = [
    ...(existing.overrides ?? []),
    existing.origin,
  ];
  return { value: merged, origin: childOrigin, overrides };
}

/**
 * True when a child target matcher is covered by the parent's target list.
 * - Type-name child covered by identical type-name in parent OR by ANY shape
 *   matcher in parent.
 * - Shape-matcher child covered only by identical shape matcher in parent.
 */
function targetCoveredBy(
  child: TargetMatcher,
  parentList: readonly TargetMatcher[],
): boolean {
  if (typeof child === "string") {
    for (const p of parentList) {
      if (typeof p === "string" && p === child) return true;
      if (typeof p !== "string") return true; // any shape matcher covers type names
    }
    return false;
  }
  for (const p of parentList) {
    if (typeof p !== "string" && p.shape === child.shape) return true;
  }
  return false;
}

function stringifyMatcher(m: TargetMatcher): string {
  return typeof m === "string" ? m : `{shape: ${m.shape}}`;
}

// ---------------------------------------------------------------------------
// Helpers: construct an EffectiveProfile from a single tier's manifest.
// ---------------------------------------------------------------------------

function seedFromTier(tier: LoadedProfile): EffectiveProfile {
  const origin: ProfileId = tier.id;
  const m = tier.manifest;

  return {
    attributes: mapFromAttrList(m.universalAttributes, origin),
    labels: mapFromLabelConcerns(m.labels, origin),
    conventions: mapFromConventions(m.conventions, origin),
    colors: mapFromColors(m.colors, origin),
    types: mapFromTypes(m.types, origin),
    documents: {
      types: mapFromDocTypes(m.documents.types, origin),
      frontMatter: mapFromAttrList(m.documents.frontMatter, origin),
    },
    kinds: mapFromKinds(m.kinds, origin),
    prose: {
      lexicons: {
        "capitalized-allow": {
          value: m.prose.lexicons["capitalized-allow"],
          origin,
        },
        "sentence-abbrev": {
          value: m.prose.lexicons["sentence-abbrev"],
          origin,
        },
      },
    },
    disciplineMode: { value: "none", origin: "inferred" },
  };
}

function mapFromColors(
  colors: ReadonlyMap<string, string>,
  origin: ProfileId,
): ProvenancedMap<string> {
  const out = new Map<string, ProvenancedMapEntry<string>>();
  for (const [name, hue] of colors) {
    out.set(name, { value: hue, origin });
  }
  return out;
}

/**
 * Union of `kinds:` maps across tiers. Additive: every tier's kinds are
 * carried. When two tiers declare the same kind, the child wins on
 * description and `overrides` records the displaced parent.
 */
function unionKindsMap(
  parent: ProvenancedMap<KindDecl>,
  childKinds: ReadonlyMap<string, KindDecl>,
  childOrigin: ProfileId,
): ProvenancedMap<KindDecl> {
  if (childKinds.size === 0) return parent;
  const out = new Map(parent);
  for (const [name, kd] of childKinds) {
    const prior = out.get(name);
    out.set(name, {
      value: kd,
      origin: childOrigin,
      overrides: prior ? [...(prior.overrides ?? []), prior.origin] : undefined,
    });
  }
  return out;
}

function mapFromKinds(
  kinds: ReadonlyMap<string, KindDecl>,
  origin: ProfileId,
): ProvenancedMap<KindDecl> {
  const out = new Map<string, ProvenancedMapEntry<KindDecl>>();
  for (const [name, kd] of kinds) {
    out.set(name, { value: kd, origin });
  }
  return out;
}

function mapFromLabelConcerns(
  concerns: readonly LabelConcern[],
  origin: ProfileId,
): ProvenancedMap<LabelConcern> {
  const out = new Map<string, ProvenancedMapEntry<LabelConcern>>();
  for (const c of concerns) {
    out.set(c.name, { value: c, origin });
  }
  return out;
}

function mapFromConventions(
  conventions: readonly ProfileConvention[],
  origin: ProfileId,
): ProvenancedMap<ProfileConvention> {
  const out = new Map<string, ProvenancedMapEntry<ProfileConvention>>();
  for (const c of conventions) {
    out.set(c.name, { value: c, origin });
  }
  return out;
}

function unionLabelMap(
  parent: ProvenancedMap<LabelConcern>,
  childConcerns: readonly LabelConcern[],
  childOrigin: ProfileId,
  diagnostics: Diagnostic[],
): ProvenancedMap<LabelConcern> {
  if (childConcerns.length === 0) return parent;
  const out = new Map(parent);
  for (const c of childConcerns) {
    const existing = out.get(c.name);
    if (!existing) {
      out.set(c.name, { value: c, origin: childOrigin });
      continue;
    }
    if (existing.value.kind !== c.kind) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message:
          `label concern '${c.name}': kind '${c.kind}' (${childOrigin}) conflicts with '${existing.value.kind}' (${existing.origin})`,
        location: { file: "<merge>", line: 1, column: 1 },
      });
      continue;
    }
    // Union values; child description wins when set.
    const parentValueNames = new Set(existing.value.values.map((v) => v.name));
    const mergedValues = [
      ...existing.value.values,
      ...c.values.filter((v) => !parentValueNames.has(v.name)),
    ];
    const merged: LabelConcern = {
      name: c.name,
      kind: c.kind,
      description: c.description !== undefined
        ? c.description
        : existing.value.description,
      values: mergedValues,
    };
    out.set(c.name, {
      value: merged,
      origin: childOrigin,
      overrides: [...(existing.overrides ?? []), existing.origin],
    });
  }
  return out;
}

function unionConventionsMap(
  parent: ProvenancedMap<ProfileConvention>,
  childConventions: readonly ProfileConvention[],
  childOrigin: ProfileId,
): ProvenancedMap<ProfileConvention> {
  if (childConventions.length === 0) return parent;
  const out = new Map(parent);
  for (const c of childConventions) {
    const existing = out.get(c.name);
    out.set(c.name, {
      value: c,
      origin: childOrigin,
      overrides: existing
        ? [...(existing.overrides ?? []), existing.origin]
        : undefined,
    });
  }
  return out;
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

function mapFromAttrDescriptions(
  attrs: readonly AttrDecl[],
  origin: ProfileId,
): ProvenancedMap<string> {
  const out = new Map<string, ProvenancedMapEntry<string>>();
  for (const a of attrs) {
    if (a.description !== undefined) {
      out.set(a.name, { value: a.description, origin });
    }
  }
  return out;
}

function mapFromTraceDescriptions(
  trace: ReadonlyMap<string, TraceRule>,
  origin: ProfileId,
): ProvenancedMap<string> {
  const out = new Map<string, ProvenancedMapEntry<string>>();
  for (const [name, rule] of trace) {
    if (rule.description !== undefined) {
      out.set(name, { value: rule.description, origin });
    }
  }
  return out;
}

function mergeDescriptionMap(
  parent: ProvenancedMap<string>,
  childItems: readonly { name: string; desc: string | undefined }[],
  childOrigin: ProfileId,
): ProvenancedMap<string> {
  const out = new Map(parent);
  for (const { name, desc } of childItems) {
    if (desc !== undefined) {
      const existing = out.get(name);
      out.set(name, {
        value: desc,
        origin: childOrigin,
        overrides: existing
          ? [...(existing.overrides ?? []), existing.origin]
          : undefined,
      });
    }
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
      extends: td.extends,
      displayIdPattern: { value: td.displayIdPattern, origin },
      displayIdPatternEnforcement: {
        value: td.displayIdPatternEnforcement,
        origin,
      },
      color: { value: td.color, origin },
      required: { value: td.required, origin },
      attributes: mapFromAttrList(td.attributes, origin),
      traceability: mapFromTrace(td.traceability, origin),
      description: { value: td.description, origin },
      attrDescriptions: mapFromAttrDescriptions(td.attributes, origin),
      relationDescriptions: mapFromTraceDescriptions(td.traceability, origin),
      discipline: { value: td.discipline, origin },
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
