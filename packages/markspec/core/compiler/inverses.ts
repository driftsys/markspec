/**
 * @module compiler/inverses
 *
 * Inverse attribute generation — walks forward link attributes that carry
 * an `inverse:` declaration and emits synthetic back-link values on target
 * entries.
 */

import type {
  Diagnostic,
  EffectiveProfile,
  Entry,
  InverseDecl,
} from "../model/mod.ts";

/** Result of inverse generation. */
export interface GenerateInversesResult {
  readonly entries: readonly Entry[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Collected inverse declaration: the attribute name that carries forward
 * links, the inverse target attribute name, the category filter, and the
 * scope (type name or `null` for universal/shape scopes).
 */
interface InverseSpec {
  readonly attrName: string;
  readonly inverse: InverseDecl;
  /** Type scope this declaration belongs to, or `null` for universal/shape. */
  readonly sourceType: string | null;
}

/**
 * Generate inverse (back-link) attributes from forward link declarations.
 *
 * Walks every identified entry's `typedAttributes` for attributes that match
 * an `inverse:` declaration in the effective profile, then accumulates
 * back-links on target entries.
 */
export function generateInverses(
  entries: readonly Entry[],
  profile: EffectiveProfile,
): GenerateInversesResult {
  if (entries.length === 0) {
    return { entries: [], diagnostics: [] };
  }

  // Step 1: Collect all inverse declarations from the profile
  const inverseSpecs = collectInverseSpecs(profile);
  if (inverseSpecs.length === 0) {
    return { entries: [...entries], diagnostics: [] };
  }

  // Step 2: Index entries by id
  const byId = new Map<string, Entry>();
  for (const e of entries) {
    if (e.id !== undefined) {
      byId.set(e.id, e);
    }
  }

  // Step 3–5: Walk entries, accumulate back-links
  // Map: targetId → Map<inverseAttrName, Set<sourceId>>
  const generated = new Map<string, Map<string, Set<string>>>();

  for (const source of entries) {
    if (source.shape !== "identified" || source.id === undefined) continue;

    const applicableSpecs = resolveApplicableSpecs(
      inverseSpecs,
      source.type,
    );

    for (const spec of applicableSpecs) {
      const forwardValues = source.typedAttributes.get(spec.attrName);
      if (!forwardValues) continue;

      for (const targetId of forwardValues) {
        const target = byId.get(targetId);
        if (!target || target.type !== spec.inverse.category) continue;

        let targetMap = generated.get(targetId);
        if (!targetMap) {
          targetMap = new Map();
          generated.set(targetId, targetMap);
        }
        let idSet = targetMap.get(spec.inverse.name);
        if (!idSet) {
          idSet = new Set();
          targetMap.set(spec.inverse.name, idSet);
        }
        idSet.add(source.id!);
      }
    }
  }

  // Step 6–7: Merge generated values into entries, emit diagnostics
  const diagnostics: Diagnostic[] = [];
  const result: Entry[] = [];

  for (const e of entries) {
    const targetInverses = e.id ? generated.get(e.id) : undefined;
    if (!targetInverses) {
      result.push(e);
      continue;
    }

    const newAttrs = new Map<string, readonly string[]>(
      e.typedAttributes,
    );
    let changed = false;

    for (const [inverseName, generatedIds] of targetInverses) {
      const generatedArr = [...generatedIds];
      const authored = e.typedAttributes.get(inverseName);

      if (authored && authored.length > 0) {
        const authoredSet = new Set(authored);
        const genSet = generatedIds;
        const match = authoredSet.size === genSet.size &&
          [...authoredSet].every((v) => genSet.has(v));

        if (!match) {
          diagnostics.push({
            code: "MSL-L005",
            severity: "warning",
            message:
              `authored "${inverseName}" on ${e.displayId} differs from generated inverse values`,
            location: e.location,
          });
          // Union authored + generated
          const union = new Set([...authored, ...generatedArr]);
          newAttrs.set(inverseName, [...union]);
          changed = true;
        }
        // If match, keep as-is
      } else {
        newAttrs.set(inverseName, generatedArr);
        changed = true;
      }
    }

    if (changed) {
      result.push({ ...e, typedAttributes: newAttrs });
    } else {
      result.push(e);
    }
  }

  return { entries: result, diagnostics };
}

/** Collect all inverse-bearing attribute declarations from the profile. */
function collectInverseSpecs(profile: EffectiveProfile): InverseSpec[] {
  const specs: InverseSpec[] = [];

  // Universal scope
  for (const [, entry] of profile.attributes) {
    if (entry.value.inverse) {
      specs.push({
        attrName: entry.value.name,
        inverse: entry.value.inverse,
        sourceType: null,
      });
    }
  }

  // Identified shape scope
  for (const [, entry] of profile.identified.attributes) {
    if (entry.value.inverse) {
      specs.push({
        attrName: entry.value.name,
        inverse: entry.value.inverse,
        sourceType: null,
      });
    }
  }

  // Type scopes
  for (const [typeName, typeEntry] of profile.types) {
    for (const [, attrEntry] of typeEntry.value.attributes) {
      if (attrEntry.value.inverse) {
        specs.push({
          attrName: attrEntry.value.name,
          inverse: attrEntry.value.inverse,
          sourceType: typeName,
        });
      }
    }
  }

  return specs;
}

/** Filter specs applicable to a source entry's type. */
function resolveApplicableSpecs(
  specs: readonly InverseSpec[],
  sourceType: string | undefined,
): readonly InverseSpec[] {
  return specs.filter((s) =>
    s.sourceType === null || s.sourceType === sourceType
  );
}
