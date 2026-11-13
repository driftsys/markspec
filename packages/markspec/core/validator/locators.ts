/**
 * @module core/validator/locators
 *
 * Locator and scenario-name diagnostics (epic #915, scenario-locator
 * slice):
 *
 * - `MSL-L007` (warning): a locator on a `"criterion"` relation
 *   (`Satisfies`, `Verifies`) names no addressable scenario of a resolved,
 *   criteria-bearing target. The edge to the target is kept.
 * - `MSL-L008` (warning): a locator on a trace relation that does not
 *   accept one (every relation without a locator mode, including
 *   profile-declared relations and a hand-written `Verified-by`). The
 *   edge to the target is kept.
 * - `MSL-L009` (warning): a trace value has a `[` after whitespace that
 *   no `]` closes. The value has no locator and is read as it was before
 *   scenario locators existed.
 * - `MSL-B060` (warning): a scenario name occurs more than once in one
 *   entry; reported on the second and later occurrences.
 * - `MSL-B061` (info): a scenario has an empty name.
 *
 * A locator on an unresolved target raises only `MSL-L006`, and a locator
 * on a target that carries no criteria (not a Requirement or Contract, or a
 * Reference entry) is free text: neither raises `MSL-L007`.
 */

import type {
  Diagnostic,
  EffectiveProfile,
  Entry,
  SourceLocation,
} from "../model/mod.ts";
import {
  ATTRIBUTE_CATALOG,
  CORE_RELATIONS,
  emittableEntries,
  relationLocatorMode,
} from "../model/mod.ts";
import { buildCriteria, isCriteriaBearing } from "../criteria/scenarios.ts";
import {
  isUnterminatedLocator,
  parseTraceValue,
  splitTraceValues,
} from "../refs/split.ts";
import { classifyEntry } from "./types.ts";

/** Value types whose values reference other entries. */
const REFERENCE_VALUE_TYPES: ReadonlySet<string> = new Set([
  "id",
  "id-list",
  "citation",
]);

/** Core relations that accept a locator, for the MSL-L008 message. */
const LOCATOR_RELATIONS: string = (() => {
  const names = CORE_RELATIONS.filter((r) => r.locator !== undefined).map(
    (r) => r.attr,
  );
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
})();

/**
 * Report the locator and scenario-name diagnostics for `entries`.
 * Targets resolve against every entry (upstream entries included);
 * diagnostics are emitted for emittable entries only. When `profile` is
 * given, an entry without a `type` is classified against it first.
 */
export function validateLocators(
  entries: readonly Entry[],
  profile: EffectiveProfile | null,
): Diagnostic[] {
  const typed = entries.map((e) => withType(e, profile));
  const byKey = new Map<string, Entry>();
  for (const e of typed) {
    if (!byKey.has(e.displayId)) byKey.set(e.displayId, e);
    if (e.id && !byKey.has(e.id)) byKey.set(e.id, e);
  }
  const relations = relationKeys(profile);
  const diagnostics: Diagnostic[] = [];
  for (const entry of emittableEntries(typed)) {
    if (isCriteriaBearing(entry, profile)) {
      diagnostics.push(...scenarioNameDiagnostics(entry));
    }
    entry.rawAttributes.forEach((attr, index) => {
      if (!relations.has(attr.key)) return;
      const location = attributeLocation(entry, index);
      for (const part of splitTraceValues(attr.value)) {
        if (isUnterminatedLocator(part)) {
          diagnostics.push({
            code: "MSL-L009",
            severity: "warning",
            message: `${entry.displayId}: '${attr.key}' value '${part}' has ` +
              "a '[' with no closing ']'. Add the closing ']'",
            location,
          });
          continue;
        }
        const parsed = parseTraceValue(part);
        if (parsed.locator === undefined) continue;
        const mode = relationLocatorMode(attr.key);
        if (mode === undefined) {
          diagnostics.push({
            code: "MSL-L008",
            severity: "warning",
            message: `${entry.displayId}: '${attr.key}' does not accept a ` +
              `locator ('${parsed.locator}'); only ${LOCATOR_RELATIONS} do. ` +
              `The link to ${parsed.target} is kept`,
            location,
          });
          continue;
        }
        if (mode !== "criterion") continue;
        const target = byKey.get(parsed.target);
        if (!target || !isCriteriaBearing(target, profile)) continue;
        const resolved = buildCriteria(target).some((c) =>
          c.addressable && c.name === parsed.locator
        );
        if (resolved) continue;
        diagnostics.push({
          code: "MSL-L007",
          severity: "warning",
          message: `${entry.displayId}: locator '${parsed.locator}' matches ` +
            `no scenario of ${target.displayId}`,
          location,
        });
      }
    });
  }
  return diagnostics;
}

/** MSL-B060 and MSL-B061 for the scenarios of one entry. */
function scenarioNameDiagnostics(entry: Entry): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const criterion of buildCriteria(entry)) {
    if (criterion.name === "") {
      diagnostics.push({
        code: "MSL-B061",
        severity: "info",
        message: `${entry.displayId}: scenario has no name; ` +
          "a locator cannot address it",
        location: criterion.location,
      });
      continue;
    }
    if (seen.has(criterion.name)) {
      diagnostics.push({
        code: "MSL-B060",
        severity: "warning",
        message: `${entry.displayId}: scenario name '${criterion.name}' ` +
          "is used more than once; a locator cannot address it",
        location: criterion.location,
      });
    }
    seen.add(criterion.name);
  }
  return diagnostics;
}

/** `entry` with its type classified against `profile` when unset. */
function withType(entry: Entry, profile: EffectiveProfile | null): Entry {
  if (entry.type !== undefined || profile === null) return entry;
  const type = classifyEntry(entry, profile).type;
  return type === undefined ? entry : { ...entry, type };
}

/**
 * Trailer keys that are trace relations: the core relations, core
 * attributes whose values reference entries (such as `Verified-by`), and
 * the profile's reference-valued attributes and traceability links.
 */
function relationKeys(profile: EffectiveProfile | null): Set<string> {
  const keys = new Set<string>(CORE_RELATIONS.map((r) => r.attr));
  const isRelation = (key: string, type: string | undefined) =>
    type !== undefined && REFERENCE_VALUE_TYPES.has(type) && keys.add(key);
  for (const spec of ATTRIBUTE_CATALOG) isRelation(spec.key, spec.type);
  if (profile === null) return keys;
  for (const [, a] of profile.attributes) {
    isRelation(a.value.name, a.value.type);
  }
  for (const [, t] of profile.types) {
    for (const [, a] of t.value.attributes) {
      isRelation(a.value.name, a.value.type);
    }
    for (const name of t.value.traceability.keys()) keys.add(name);
  }
  return keys;
}

/** The location of the trailer line of `entry.rawAttributes[index]`. */
function attributeLocation(entry: Entry, index: number): SourceLocation {
  const lines = entry.attributeLines;
  if (!lines || lines.length !== entry.rawAttributes.length) {
    return entry.location;
  }
  return { file: entry.location.file, line: lines[index], column: 1 };
}
