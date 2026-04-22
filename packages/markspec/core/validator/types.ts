/**
 * @module core/validator/types
 *
 * Validator Stage 2 — entry classification.
 *
 * Each entry is assigned a profile-declared type either by an explicit
 * `Type:` trailer attribute or by display-ID pattern matching. Un-classified
 * entries in a strict profile (types declared) produce MSL-T003.
 */

import type { Diagnostic, EffectiveProfile, Entry } from "../model/mod.ts";
import { compileDisplayIdPattern } from "./pattern.ts";

/** Result of classifying a single entry. */
export interface ClassifyResult {
  /** The assigned type name, or `undefined` if un-classified. */
  readonly type: string | undefined;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Classify one {@linkcode Entry} against the profile's type vocabulary.
 *
 * Order of precedence:
 *   1. Explicit `Type:` trailer attribute (if present).
 *   2. Display-ID pattern match across types whose `shape` matches
 *      `entry.shape`.
 *
 * Emits:
 *   - `MSL-T001` when explicit `Type:` value is not in the profile's type
 *     vocabulary.
 *   - `MSL-T002` when the display ID matches more than one type's pattern.
 *   - `MSL-T003` when strict mode (types declared) and no classification
 *     could be assigned.
 */
export function classifyEntry(
  entry: Entry,
  profile: EffectiveProfile,
): ClassifyResult {
  const diagnostics: Diagnostic[] = [];

  // 1. Explicit Type: trailer?
  const explicitType = findExplicitTypeAttribute(entry);
  if (explicitType !== undefined) {
    if (profile.types.has(explicitType)) {
      return { type: explicitType, diagnostics };
    }
    diagnostics.push({
      code: "MSL-T001",
      severity: "error",
      message:
        `${entry.displayId}: explicit Type: '${explicitType}' is not a declared type`,
      location: entry.location,
    });
    return { type: undefined, diagnostics };
  }

  // 2. Display-ID pattern match across same-shape types.
  const matches: string[] = [];
  for (const [typeName, typeEntry] of profile.types) {
    if (typeEntry.value.shape !== entry.shape) continue;
    const pattern = typeEntry.value.displayIdPattern.value;
    if (pattern === undefined) continue;
    const regex = compileDisplayIdPattern(pattern);
    if (regex.test(entry.displayId)) {
      matches.push(typeName);
    }
  }

  if (matches.length === 1) {
    return { type: matches[0], diagnostics };
  }

  if (matches.length > 1) {
    diagnostics.push({
      code: "MSL-T002",
      severity: "error",
      message:
        `${entry.displayId}: display ID matches multiple type patterns ` +
        `(${
          matches.join(", ")
        }); add an explicit 'Type:' trailer to disambiguate`,
      location: entry.location,
    });
    return { type: undefined, diagnostics };
  }

  // 0 matches. Strict mode → MSL-T003; permissive → OK.
  if (profile.types.size > 0) {
    diagnostics.push({
      code: "MSL-T003",
      severity: "error",
      message: `${entry.displayId}: un-classified entry ` +
        `(profile declares ${profile.types.size} types; display ID matched none)`,
      location: entry.location,
    });
  }
  return { type: undefined, diagnostics };
}

function findExplicitTypeAttribute(entry: Entry): string | undefined {
  for (const attr of entry.attributes) {
    if (attr.key === "Type") {
      return attr.value.trim();
    }
  }
  return undefined;
}
