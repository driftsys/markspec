/**
 * @module core/profile/introspect
 *
 * Unified introspection API for profile chains. All discovery surfaces
 * (CLI, MCP, LSP) consume this module instead of re-walking EffectiveProfile.
 *
 * Node-safe: no Deno.* APIs.
 */

import type {
  EffectiveProfile,
  EffectiveTypeDef,
  LabelConcernKind,
  ProfileChain,
  ProvenancedValue,
} from "../model/mod.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Discriminant for the five kinds of profile elements. */
export type ProfileElementKind =
  | "type"
  | "attribute"
  | "relation"
  | "label-concern"
  | "convention";

/**
 * A human-readable description with provenance: which profile tier contributed
 * it and which tiers it overrides.
 */
export interface ProvenancedDescription {
  readonly text?: string;
  readonly origin?: string;
  readonly overrides?: string[];
}

/**
 * A lightweight reference to a profile element, used in overview lists and
 * resolve results. `ref` is `"<kind>/<name>"`, e.g. `"type/software-requirement"`.
 */
export interface ProfileElementRef {
  readonly kind: ProfileElementKind;
  readonly name: string;
  readonly summary: string;
  /** `"<kind>/<name>"`, e.g. `"type/software-requirement"`. */
  readonly ref: string;
}

/**
 * High-level snapshot of the active profile chain: chain tiers and all
 * declared elements as lightweight refs.
 */
export interface ProfileOverview {
  readonly tiers: readonly { id: string; version: string; summary: string }[];
  readonly elements: readonly ProfileElementRef[];
}

/** Detailed description of a profile-declared entry type. */
export interface TypeDetail {
  readonly kind: "type";
  readonly name: string;
  readonly description: ProvenancedDescription;
  readonly extendsTarget: string;
  readonly shape: string;
  readonly displayIdPattern?: string;
  readonly color?: string;
  readonly requiredAttributes: readonly ProfileElementRef[];
  readonly allowedAttributes: readonly ProfileElementRef[];
  readonly outgoingRelations: readonly ProfileElementRef[];
  readonly incomingRelations: readonly ProfileElementRef[];
}

/** Detailed description of a universal or type-scoped attribute declaration. */
export interface AttributeDetail {
  readonly kind: "attribute";
  readonly name: string;
  readonly description: ProvenancedDescription;
  readonly valueType: string;
  readonly cardinality: string;
  readonly required: boolean;
  readonly enumValues?: readonly string[];
  readonly inverse?: { name: string; category: string };
  readonly declaredBy: readonly string[];
}

/**
 * Detailed description of a traceability relation, aggregated across all types
 * that declare it.
 */
export interface RelationDetail {
  readonly kind: "relation";
  readonly name: string;
  readonly description: ProvenancedDescription;
  readonly targets: readonly string[];
  readonly cardinality?: string;
  readonly required: boolean;
  readonly declaredBy: readonly string[];
}

/** Detailed description of a label concern (enum, set, or flag). */
export interface LabelConcernDetail {
  readonly kind: "label-concern";
  readonly name: string;
  readonly description: ProvenancedDescription;
  readonly concernKind: LabelConcernKind;
  readonly values: readonly { name: string; description?: string }[];
}

/**
 * Detailed description of a named profile convention (e.g. `modal-keywords`).
 */
export interface ConventionDetail {
  readonly kind: "convention";
  readonly name: string;
  readonly description: ProvenancedDescription;
  readonly settings: Readonly<Record<string, string>>;
}

/**
 * Discriminated union of all per-element detail types returned by
 * `ProfileIntrospection.describe`.
 */
export type ProfileElementDetail =
  | TypeDetail
  | AttributeDetail
  | RelationDetail
  | LabelConcernDetail
  | ConventionDetail;

/**
 * Unified read-only view of a profile chain. Consumed by CLI, MCP, and LSP
 * instead of walking `EffectiveProfile` directly.
 */
export interface ProfileIntrospection {
  /** Return a lazily computed, cached overview of all profile elements. */
  overview(): ProfileOverview;
  /**
   * Return full detail for the named element, or `undefined` if not found.
   */
  describe(
    kind: ProfileElementKind,
    name: string,
  ): ProfileElementDetail | undefined;
  /**
   * Return elements whose kind/name/summary contain all whitespace-separated
   * query tokens (case-insensitive).
   */
  resolve(query: string): ProfileElementRef[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a `ProfileIntrospection` from a profile chain (or `null` when
 * no profile is configured for the project).
 *
 * The returned object is lazy — `overview()` caches after the first call.
 */
export function buildProfileIntrospection(
  chain: ProfileChain | null,
): ProfileIntrospection {
  if (!chain) {
    return {
      overview: () => ({
        tiers: [
          { id: "(none)", version: "", summary: "No profile configured" },
        ],
        elements: [],
      }),
      describe: () => undefined,
      resolve: () => [],
    };
  }

  // Capture non-null references so inner closures type-check.
  const nonNullChain = chain;
  const effective = nonNullChain.effective;
  let cachedOverview: ProfileOverview | undefined;

  function getOverview(): ProfileOverview {
    if (cachedOverview) return cachedOverview;

    const tiers = nonNullChain.tiers.map((tier) => ({
      id: tier.id,
      version: tier.version,
      summary: tier.manifest.description ?? tier.id,
    }));

    const elements: ProfileElementRef[] = [];

    // Types
    for (const [name, entry] of effective.types) {
      const tdef = entry.value;
      const summary = tdef.description.value ?? tdef.extends;
      elements.push({
        kind: "type",
        name,
        summary,
        ref: `type/${name}`,
      });
    }

    // Universal attributes
    for (const [name, entry] of effective.attributes) {
      const decl = entry.value;
      const summary = decl.description ??
        `${decl.type}, ${formatCardinality(decl.cardinality)}`;
      elements.push({
        kind: "attribute",
        name,
        summary,
        ref: `attribute/${name}`,
      });
    }

    // Relations (deduplicated across types)
    const seenRelations = new Map<
      string,
      { targets: Set<string>; description?: string }
    >();
    for (const [, typeEntry] of effective.types) {
      const tdef = typeEntry.value;
      for (const [relName, ruleEntry] of tdef.traceability) {
        const existing = seenRelations.get(relName);
        const desc = tdef.relationDescriptions.get(relName);
        if (!existing) {
          seenRelations.set(relName, {
            targets: new Set(
              ruleEntry.value.target.map(targetToString),
            ),
            description: desc?.value,
          });
        } else {
          for (const t of ruleEntry.value.target.map(targetToString)) {
            existing.targets.add(t);
          }
          if (desc?.value !== undefined && existing.description === undefined) {
            existing.description = desc.value;
          }
        }
      }
    }
    for (const [name, info] of seenRelations) {
      const summary = info.description ??
        `targets: ${[...info.targets].join(", ")}`;
      elements.push({
        kind: "relation",
        name,
        summary,
        ref: `relation/${name}`,
      });
    }

    // Label concerns
    for (const [name, entry] of effective.labels) {
      const concern = entry.value;
      const summary = concern.description ??
        `${concern.kind}, ${concern.values.length} values`;
      elements.push({
        kind: "label-concern",
        name,
        summary,
        ref: `label/${name}`,
      });
    }

    // Conventions
    for (const [name, entry] of effective.conventions) {
      const conv = entry.value;
      const summary = conv.description ??
        Object.entries(conv.settings).map(([k, v]) => `${k}=${v}`).join(" ");
      elements.push({
        kind: "convention",
        name,
        summary,
        ref: `convention/${name}`,
      });
    }

    // Sort by kind order, then name within kind.
    const KIND_ORDER: Record<ProfileElementKind, number> = {
      "type": 0,
      "attribute": 1,
      "relation": 2,
      "label-concern": 3,
      "convention": 4,
    };
    elements.sort((a, b) => {
      const kDiff = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      return kDiff !== 0 ? kDiff : a.name.localeCompare(b.name);
    });

    cachedOverview = { tiers, elements };
    return cachedOverview;
  }

  function describe(
    kind: ProfileElementKind,
    name: string,
  ): ProfileElementDetail | undefined {
    switch (kind) {
      case "type":
        return describeType(name, effective);
      case "attribute":
        return describeAttribute(name, effective);
      case "relation":
        return describeRelation(name, effective);
      case "label-concern":
        return describeLabelConcern(name, effective);
      case "convention":
        return describeConvention(name, effective);
    }
  }

  function resolve(query: string): ProfileElementRef[] {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const overview = getOverview();
    return overview.elements.filter((ref) => {
      const haystack = `${ref.kind} ${ref.name} ${ref.summary}`.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }

  return { overview: getOverview, describe, resolve };
}

// ---------------------------------------------------------------------------
// Per-element describe helpers
// ---------------------------------------------------------------------------

function describeType(
  name: string,
  effective: EffectiveProfile,
): TypeDetail | undefined {
  const entry = effective.types.get(name);
  if (!entry) return undefined;
  const tdef: EffectiveTypeDef = entry.value;

  const description = provenancedFromValue(tdef.description);

  // Required attributes: those listed in tdef.required
  const requiredAttributes: ProfileElementRef[] = tdef.required.value
    .map((attrName) => attrRef(attrName, effective, tdef));

  // Allowed attributes: all declared attrs minus required
  const requiredSet = new Set(tdef.required.value);
  const allAttrNames = [
    ...tdef.attributes.keys(),
    ...effective.attributes.keys(),
  ].filter((attrName, i, arr) => arr.indexOf(attrName) === i); // dedupe
  const allowedAttributes: ProfileElementRef[] = allAttrNames
    .filter((attrName) => !requiredSet.has(attrName))
    .map((attrName) => attrRef(attrName, effective, tdef));

  // Outgoing relations
  const outgoingRelations: ProfileElementRef[] = [
    ...tdef.traceability.keys(),
  ].map((relName) => {
    const descEntry = tdef.relationDescriptions.get(relName);
    const rule = tdef.traceability.get(relName)!;
    const summary = descEntry?.value ??
      `targets: ${rule.value.target.map(targetToString).join(", ")}`;
    return {
      kind: "relation" as const,
      name: relName,
      summary,
      ref: `relation/${relName}`,
    };
  });

  // Incoming relations: types whose traceability targets this type by name
  const incomingRelations: ProfileElementRef[] = [];
  const seenIn = new Set<string>();
  for (const [otherTypeName, otherEntry] of effective.types) {
    if (otherTypeName === name) continue;
    for (const [relName, ruleEntry] of otherEntry.value.traceability) {
      if (seenIn.has(relName)) continue;
      const targets = ruleEntry.value.target;
      const matches = targets.some((t) =>
        typeof t === "string" ? t === name : false
      );
      if (matches) {
        seenIn.add(relName);
        const relDesc = otherEntry.value.relationDescriptions.get(relName);
        const summary = relDesc?.value ?? `from ${otherTypeName}`;
        incomingRelations.push({
          kind: "relation" as const,
          name: relName,
          summary,
          ref: `relation/${relName}`,
        });
      }
    }
  }

  return {
    kind: "type",
    name,
    description,
    extendsTarget: tdef.extends,
    shape: tdef.extends,
    displayIdPattern: tdef.displayIdPattern.value,
    color: tdef.color.value,
    requiredAttributes,
    allowedAttributes,
    outgoingRelations,
    incomingRelations,
  };
}

function attrRef(
  attrName: string,
  effective: EffectiveProfile,
  tdef: EffectiveTypeDef,
): ProfileElementRef {
  // Look in type-specific scope first, then universal.
  const typeAttr = tdef.attributes.get(attrName)?.value;
  const universalAttr = effective.attributes.get(attrName)?.value;
  const attrDecl = typeAttr ?? universalAttr;
  const attrDesc = tdef.attrDescriptions.get(attrName);
  const summary = attrDesc?.value ??
    attrDecl?.description ??
    (attrDecl
      ? `${attrDecl.type}, ${formatCardinality(attrDecl.cardinality)}`
      : attrName);
  return {
    kind: "attribute",
    name: attrName,
    summary,
    ref: `attribute/${attrName}`,
  };
}

function describeAttribute(
  name: string,
  effective: EffectiveProfile,
): AttributeDetail | undefined {
  const entry = effective.attributes.get(name);
  if (!entry) return undefined;
  const decl = entry.value;

  // Find which types also declare this attribute.
  const declaredBy: string[] = ["universal"];
  for (const [typeName, typeEntry] of effective.types) {
    if (typeEntry.value.attributes.has(name)) {
      declaredBy.push(typeName);
    }
  }

  const description: ProvenancedDescription = {
    text: decl.description,
    origin: decl.description !== undefined ? entry.origin : undefined,
  };

  return {
    kind: "attribute",
    name,
    description,
    valueType: decl.type,
    cardinality: formatCardinality(decl.cardinality),
    required: decl.required,
    enumValues: decl.values,
    inverse: decl.inverse,
    declaredBy,
  };
}

function describeRelation(
  name: string,
  effective: EffectiveProfile,
): RelationDetail | undefined {
  const declaredBy: string[] = [];
  let bestDesc: ProvenancedDescription = {};
  const targets: string[] = [];
  let required = false;
  let cardinality: string | undefined;

  for (const [typeName, typeEntry] of effective.types) {
    const tdef = typeEntry.value;
    const ruleEntry = tdef.traceability.get(name);
    if (!ruleEntry) continue;
    declaredBy.push(typeName);
    const rule = ruleEntry.value;
    for (const t of rule.target.map(targetToString)) {
      if (!targets.includes(t)) targets.push(t);
    }
    if (rule.required) required = true;
    if (rule.cardinality) {
      cardinality = formatCardinality(rule.cardinality);
    }
    const descEntry = tdef.relationDescriptions.get(name);
    if (descEntry?.value !== undefined && bestDesc.text === undefined) {
      bestDesc = {
        text: descEntry.value,
        origin: descEntry.origin,
        overrides: descEntry.overrides ? [...descEntry.overrides] : undefined,
      };
    }
  }

  if (declaredBy.length === 0) return undefined;

  return {
    kind: "relation",
    name,
    description: bestDesc,
    targets,
    cardinality,
    required,
    declaredBy,
  };
}

function describeLabelConcern(
  name: string,
  effective: EffectiveProfile,
): LabelConcernDetail | undefined {
  const entry = effective.labels.get(name);
  if (!entry) return undefined;
  const concern = entry.value;

  const description: ProvenancedDescription = {
    text: concern.description,
    origin: concern.description !== undefined ? entry.origin : undefined,
    overrides: entry.overrides ? [...entry.overrides] : undefined,
  };

  return {
    kind: "label-concern",
    name,
    description,
    concernKind: concern.kind,
    values: concern.values,
  };
}

function describeConvention(
  name: string,
  effective: EffectiveProfile,
): ConventionDetail | undefined {
  const entry = effective.conventions.get(name);
  if (!entry) return undefined;
  const conv = entry.value;

  const description: ProvenancedDescription = {
    text: conv.description,
    origin: conv.description !== undefined ? entry.origin : undefined,
    overrides: entry.overrides ? [...entry.overrides] : undefined,
  };

  return {
    kind: "convention",
    name,
    description,
    settings: conv.settings,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function provenancedFromValue(
  pv: ProvenancedValue<string | undefined>,
): ProvenancedDescription {
  return {
    text: pv.value,
    origin: pv.value !== undefined ? pv.origin : undefined,
  };
}

function formatCardinality(card: {
  lower: number;
  upper: number;
}): string {
  const upper = card.upper === Infinity ? "N" : String(card.upper);
  return `${card.lower}..${upper}`;
}

function targetToString(
  t: string | { readonly shape: "Authored" | "Reference" },
): string {
  return typeof t === "string" ? t : `{shape:${t.shape}}`;
}
