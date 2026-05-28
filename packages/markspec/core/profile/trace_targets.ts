/**
 * @module core/profile/trace_targets
 *
 * Pure helpers for resolving the legal target types of a trace
 * attribute (e.g. `Satisfies:`, `Derived-from:`) given the source
 * entry's type and the active profile chain.
 *
 * A profile declares per-type `traceability:` rules — each relation
 * maps to a `TraceRule.target` list of {@linkcode TargetMatcher}s.
 * A matcher is either a type name (string) or a shape selector
 * (`{ shape: "Authored" | "Reference" }`). An entry matches when its
 * `type` equals or extends a string matcher, or its `shape` equals a
 * shape matcher.
 *
 * The LSP uses these helpers to narrow trace-attribute completion
 * suggestions to the IDs the profile actually allows in that slot.
 * Callers fall back to the unfiltered workspace listing when no
 * rule applies (no source type known, relation undeclared, profile
 * absent).
 */

import type { Entry } from "../model/mod.ts";
import type { EffectiveProfile, TargetMatcher } from "../model/profile.ts";
import { extendsTransitively } from "./discipline_mode.ts";

/**
 * Return the `TargetMatcher[]` for a given source-entry type and
 * relation name, or `undefined` when no rule constrains it. Callers
 * MUST treat `undefined` as "do not filter" rather than "no targets
 * allowed" — the latter would silently hide every suggestion.
 */
export function targetsForRelation(
  profile: EffectiveProfile,
  sourceType: string | undefined,
  relationName: string,
): readonly TargetMatcher[] | undefined {
  if (!sourceType) return undefined;
  const typeDef = profile.types.get(sourceType);
  if (!typeDef) return undefined;
  const rule = typeDef.value.traceability.get(relationName);
  if (!rule) return undefined;
  return rule.value.target;
}

/**
 * Whether `entry` satisfies any matcher in `targets`. A string
 * matcher matches when the entry's `type` equals or transitively
 * extends the named type. A shape matcher matches when the entry's
 * `shape` equals the matcher's shape. An entry with no resolved
 * `type` only matches shape selectors.
 */
export function entryMatchesTargets(
  entry: Entry,
  targets: readonly TargetMatcher[],
  profile: EffectiveProfile,
): boolean {
  for (const target of targets) {
    if (typeof target === "string") {
      if (!entry.type) continue;
      if (entry.type === target) return true;
      if (extendsTransitively(entry.type, target, profile)) return true;
    } else {
      if (entry.shape === target.shape) return true;
    }
  }
  return false;
}

/**
 * Filter `entries` to those that satisfy at least one of `targets`.
 * Order is preserved.
 */
export function filterEntriesByTraceTargets(
  entries: Iterable<Entry>,
  targets: readonly TargetMatcher[],
  profile: EffectiveProfile,
): Entry[] {
  const out: Entry[] = [];
  for (const entry of entries) {
    if (entryMatchesTargets(entry, targets, profile)) out.push(entry);
  }
  return out;
}
