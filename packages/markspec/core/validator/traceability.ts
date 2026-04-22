/**
 * @module core/validator/traceability
 *
 * Validator Stage 4 — traceability rule enforcement.
 *
 * Runs after Stage 3. For each classified identified entry, checks the
 * profile's declared trace rules against the entry's outgoing link
 * attributes:
 *   - Required (MSL-L001)
 *   - Cardinality bounds (MSL-L002 upper / MSL-L003 lower)
 *   - Target match against the rule's target matchers (MSL-L004)
 *
 * Referenced entries are skipped entirely — the profile manifest parser
 * rejects `referenced.traceability` at load time, so referenced entries
 * never have declared outgoing links.
 */

import type {
  EffectiveProfile,
  Entry,
  TargetMatcher,
  TraceRule,
} from "../model/mod.ts";

/**
 * Effective trace rules for an entry: union of identified-shape-scope rules
 * and (when classified) type-scope rules. Type-scope rules win on
 * link-attribute-name collision.
 *
 * Referenced entries always return an empty map.
 */
export function effectiveTraceRules(
  entry: Entry,
  profile: EffectiveProfile,
): ReadonlyMap<string, TraceRule> {
  const out = new Map<string, TraceRule>();
  if (entry.shape !== "identified") return out;

  // Shape scope.
  for (const [name, ruleEntry] of profile.identified.traceability) {
    out.set(name, ruleEntry.value);
  }

  // Type scope (only when classified AND type is declared in the profile).
  if (entry.type !== undefined) {
    const typeEntry = profile.types.get(entry.type);
    if (typeEntry !== undefined) {
      for (const [name, ruleEntry] of typeEntry.value.traceability) {
        out.set(name, ruleEntry.value);
      }
    }
  }

  return out;
}

/**
 * Return true if the target entry matches any of the rule's target matchers.
 * OR semantics across the list.
 *
 * - Type-name matcher (string): target's classified type equals the name.
 *   An un-classified target never matches a type-name matcher.
 * - Shape matcher ({shape: "identified"|"referenced"}): target's shape
 *   equals the matcher's shape.
 */
export function matchesAnyTarget(
  target: Entry,
  matchers: readonly TargetMatcher[],
): boolean {
  for (const m of matchers) {
    if (typeof m === "string") {
      if (target.type === m) return true;
    } else {
      if (target.shape === m.shape) return true;
    }
  }
  return false;
}
