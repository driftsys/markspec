/**
 * @module core/validator/types
 *
 * Validator Stage 2 — entry classification.
 *
 * Each entry is assigned a profile-declared type either by an explicit
 * `Type:` trailer attribute or by display-ID pattern matching. Un-classified
 * entries in a strict profile (types declared) produce MSL-T003.
 */

import type {
  Diagnostic,
  EffectiveProfile,
  EffectiveTypeDef,
  Entry,
  ProvenancedMapEntry,
} from "../model/mod.ts";
import { CORE_TYPES } from "../model/mod.ts";
import { compileDisplayIdPattern } from "./pattern.ts";

/**
 * Profile-declared concrete-type naming convention (spec §1.3): lowercase
 * alphanumeric with hyphens, starting with a letter. Used to distinguish a
 * "looks like a profile type but no profile is loaded" diagnostic
 * (MSL-T023) from a generic "unknown type" diagnostic (MSL-T020).
 */
const PROFILE_TYPE_NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Display-ID shape that infers Unit at chain step 8 (spec §1.3.1).
 * Matches when the display ID carries a path-like separator (`::` for
 * Rust/C++ symbol paths, `/` for filesystem-style hierarchies).
 */
const UNIT_DISPLAY_ID_RE = /(::|\/)/;

/**
 * Late-stage type inference per spec §1.3.1 step 8 (Authored shape).
 *
 * When no explicit `Type:` is present and the display ID carries a
 * path-like separator, infer `Unit` and emit MSL-T021 as a warning so the
 * author can promote the inferred type to an explicit declaration. This
 * implements the narrowest slice of the spec's late-stage chain — the
 * URI-scheme map (step 5), discriminating-attribute inference (step 6),
 * and document-directive inference (step 7) land in later slices.
 */
export function inferTypeFromDisplayIdShape(
  entry: Entry,
): readonly Diagnostic[] {
  if (entry.shape !== "identified") return [];
  if (findExplicitTypeAttribute(entry) !== undefined) return [];
  if (!UNIT_DISPLAY_ID_RE.test(entry.displayId)) return [];
  return [{
    code: "MSL-T021",
    severity: "warning",
    message: `${entry.displayId}: Type inferred as 'Unit' from display-ID ` +
      `shape (late-stage inference); declare 'Type:' explicitly to silence`,
    location: entry.location,
  }];
}

/**
 * Validate the `Type:` attribute value against the core type taxonomy plus
 * any profile-declared types. Runs in every mode (with or without a loaded
 * profile) — see spec §1.3 and ADR-003 §Part 1.
 *
 * Emits:
 *   - `MSL-T020` when `Type:` is present but the value is neither a core
 *     abstract/concrete type nor a profile-declared type.
 *   - `MSL-T023` when `Type:` matches the profile-declared naming convention
 *     (lowercase-with-hyphens) but no profile is loaded — i.e., the value
 *     is plausibly a profile type, just unreachable in core-only mode.
 */
export function validateCoreTypeAttribute(
  entry: Entry,
  profile: EffectiveProfile | null,
): readonly Diagnostic[] {
  const explicitType = findExplicitTypeAttribute(entry);
  if (explicitType === undefined) return [];
  if (CORE_TYPES.has(explicitType)) return [];
  if (profile !== null && profile.types.has(explicitType)) return [];

  // Core-only mode: distinguish "profile-only type" (T023) from "unknown" (T020).
  if (profile === null && PROFILE_TYPE_NAME_RE.test(explicitType)) {
    return [{
      code: "MSL-T023",
      severity: "error",
      message: `${entry.displayId}: Type: '${explicitType}' looks like a ` +
        `profile-declared type but no profile is loaded (core-only mode)`,
      location: entry.location,
    }];
  }

  return [{
    code: "MSL-T020",
    severity: "error",
    message: `${entry.displayId}: Type: '${explicitType}' is not a core type ` +
      `or a profile-declared type`,
    location: entry.location,
  }];
}

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
  for (const attr of entry.rawAttributes) {
    if (attr.key === "Type") {
      return attr.value.trim();
    }
  }
  return undefined;
}

/** Result of running the classification stage over a batch of entries. */
export interface ClassifyStageResult {
  /** Entries with `type` set on successful classification. */
  readonly entries: readonly Entry[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Run classification across all entries. Produces new {@linkcode Entry}
 * objects with `type` set when classification succeeds; un-classified
 * entries pass through with `type` unchanged.
 *
 * Also emits `MSL-T004` when a classified entry's display ID violates the
 * type's `display-id-pattern-enforcement` level.
 */
export function classifyEntriesStage(
  entries: readonly Entry[],
  profile: EffectiveProfile,
): ClassifyStageResult {
  const diagnostics: Diagnostic[] = [];
  const out: Entry[] = [];

  for (const entry of entries) {
    const classified = classifyEntry(entry, profile);
    diagnostics.push(...classified.diagnostics);

    if (classified.type !== undefined) {
      const typeEntry = profile.types.get(classified.type);
      if (typeEntry !== undefined) {
        const enforceDiag = checkEnforcement(entry, typeEntry);
        if (enforceDiag !== undefined) {
          diagnostics.push(enforceDiag);
        }
      }
      out.push({ ...entry, type: classified.type });
    } else {
      out.push(entry);
    }
  }

  return { entries: out, diagnostics };
}

/**
 * If the classified type declares a display-id-pattern and the entry's
 * display ID doesn't match it, emit an MSL-T004 at the configured severity.
 * Returns `undefined` when the display ID matches or enforcement is `off`.
 */
function checkEnforcement(
  entry: Entry,
  typeEntry: ProvenancedMapEntry<EffectiveTypeDef>,
): Diagnostic | undefined {
  const pattern = typeEntry.value.displayIdPattern.value;
  if (pattern === undefined) return undefined;
  const level = typeEntry.value.displayIdPatternEnforcement.value;
  if (level === "off") return undefined;
  const regex = compileDisplayIdPattern(pattern);
  if (regex.test(entry.displayId)) return undefined;
  return {
    code: "MSL-T004",
    severity: level === "error" ? "error" : "warning",
    message: `${entry.displayId}: display ID doesn't match pattern ` +
      `'${pattern}' for type '${typeEntry.value.name}'`,
    location: entry.location,
  };
}
