/**
 * @module core/validator/trace_types
 *
 * Cross-file trace target-type compatibility check (spec §4.8 — MSL-R083).
 *
 * For each authored trace attribute on each entry, the target must
 * resolve to an entry whose type is allowed by ADR-003 §Part 2 (taking
 * inheritance into account — e.g., a Requirement target is valid where
 * the rule allows Specification).
 *
 * Unresolved targets are intentionally not flagged here — that is the
 * job of MSL-R080 / MSL-T012 / MSL-T005 in other passes.
 */

import type { Diagnostic, Entry } from "../model/mod.ts";
import { CORE_TYPE_HIERARCHY, inferTypeFromUriScheme } from "../model/mod.ts";

/**
 * Trace-relation target-type rules. Each entry maps a trace attribute
 * key to the set of acceptable target types. Inheritance is respected
 * at check time: e.g., `Satisfies: <Requirement>` is OK because
 * Requirement is a Specification.
 */
interface TraceRule {
  readonly attr: string;
  readonly allowedTargetTypes: readonly string[];
}

const TRACE_RULES: readonly TraceRule[] = [
  // Specification family
  { attr: "Satisfies", allowedTargetTypes: ["Specification"] },
  { attr: "Derived-from", allowedTargetTypes: ["Specification"] },
  { attr: "Allocated-to", allowedTargetTypes: ["Component"] },
  // Test (extends Specification)
  { attr: "Verifies", allowedTargetTypes: ["Requirement", "Contract"] },
  { attr: "Tests", allowedTargetTypes: ["Component", "Unit"] },
  // Component / Unit
  { attr: "Realizes", allowedTargetTypes: ["Specification"] },
  {
    attr: "Provides",
    allowedTargetTypes: ["SoftwareInterface", "HardwareInterface"],
  },
  {
    attr: "Requires",
    allowedTargetTypes: ["SoftwareInterface", "HardwareInterface"],
  },
  { attr: "Depends-on", allowedTargetTypes: ["Component", "Unit"] },
  { attr: "Part-of", allowedTargetTypes: ["Component"] },
  // Risk
  { attr: "Mitigated-by", allowedTargetTypes: ["Specification"] },
  // Record
  { attr: "Affects", allowedTargetTypes: ["Component", "Unit"] },
  // `Caused-by` is polymorphic between Record (cause = Requirement/Risk/
  // Contract/Record) and Risk (cause = Component/Unit/Specification).
  // The simplest correct rule is the union — handled by the loop below.
];

/** Polymorphic relations where the source type's role widens the targets. */
const POLYMORPHIC_CAUSED_BY: readonly {
  source: string;
  allowed: readonly string[];
}[] = [
  {
    source: "Record",
    allowed: ["Requirement", "Risk", "Contract", "Record"],
  },
  {
    source: "Risk",
    allowed: ["Component", "Unit", "Specification"],
  },
];

/** Find the explicit `Type:` attribute on an entry. */
function explicitType(entry: Entry): string | undefined {
  for (const attr of entry.rawAttributes) {
    if (attr.key === "Type") return attr.value.trim();
  }
  return undefined;
}

/**
 * Resolve an entry's effective core type. Tries (in order):
 *
 *   1. Explicit `Type:` attribute (spec §1.3.1 step 1).
 *   2. Profile-classified `entry.type` (set upstream when a profile is
 *      loaded — spec §1.3.1 step 2 fall-out).
 *   3. URI-scheme inference for Reference-shape entries
 *      (ADR-003 §Part 6 / spec §1.3.1 step 5).
 *
 * Steps 3-4 + 6-8 of the spec chain are not consulted here — they're
 * handled by validateCoreTypeAttribute / inferTypeFromDisplayIdShape
 * in earlier validator stages.
 */
function resolvedCoreType(entry: Entry): string | undefined {
  const explicit = explicitType(entry);
  if (explicit && CORE_TYPE_HIERARCHY[explicit]) return explicit;
  if (entry.type && CORE_TYPE_HIERARCHY[entry.type]) return entry.type;
  if (entry.shape === "referenced" && entry.id) {
    const inferred = inferTypeFromUriScheme(entry.id);
    if (inferred && CORE_TYPE_HIERARCHY[inferred]) return inferred;
  }
  return undefined;
}

/** True when the entry carries a non-empty `Deprecated:` attribute. */
function isRetired(entry: Entry): boolean {
  for (const a of entry.rawAttributes) {
    if (a.key === "Deprecated" && a.value.trim().length > 0) return true;
  }
  return false;
}

/** True when the entry's `Labels:` set contains `DRAFT`. */
function isDraft(entry: Entry): boolean {
  for (const a of entry.rawAttributes) {
    if (a.key !== "Labels") continue;
    const values = a.value.split(/[,\s]+/).map((s) => s.trim());
    if (values.includes("DRAFT")) return true;
  }
  return false;
}

/**
 * Trace attribute keys subject to link-target severity diagnostics
 * (MSL-R081 / MSL-R082). `Supersedes` is intentionally excluded: its
 * target IS the predecessor, expected to be retired, so flagging a
 * Deprecated predecessor would be noise.
 */
const SEVERITY_TRACKED_ATTRS: readonly string[] = [
  ...new Set(TRACE_RULES.map((r) => r.attr)),
  "Caused-by",
  "References",
];

/**
 * Check whether `targetType` is compatible with any type in
 * `allowedTypes` by walking the parent chain (inheritance-aware).
 */
function isTargetTypeCompatible(
  targetType: string,
  allowedTypes: readonly string[],
): boolean {
  if (allowedTypes.length === 0) return true;
  let cursor: string | null = targetType;
  while (cursor !== null && CORE_TYPE_HIERARCHY[cursor]) {
    if (allowedTypes.includes(cursor)) return true;
    cursor = CORE_TYPE_HIERARCHY[cursor].parent;
  }
  return false;
}

/**
 * Validate that every authored trace attribute targets an entry of an
 * allowed type. Emits MSL-R083 for each type mismatch and MSL-R084
 * when `Supersedes` crosses the Authored↔Reference shape boundary
 * (ADR-002 §Part 1 — "Supersedes operates within a shape").
 *
 * Unresolved targets are silently skipped — they're caught elsewhere
 * (MSL-R080 / MSL-T012 / MSL-T005). Targets without a resolvable core
 * type are also skipped (no compat call to make).
 */
export function validateTraceTargetTypes(
  entries: readonly Entry[],
): readonly Diagnostic[] {
  const byDisplayId = new Map<string, Entry>();
  const byId = new Map<string, Entry>();
  for (const e of entries) {
    if (!byDisplayId.has(e.displayId)) byDisplayId.set(e.displayId, e);
    if (e.id && !byId.has(e.id)) byId.set(e.id, e);
  }

  const diagnostics: Diagnostic[] = [];

  for (const entry of entries) {
    // MSL-R084: Supersedes target must be the same shape as the source.
    for (const attr of entry.rawAttributes) {
      if (attr.key !== "Supersedes") continue;
      const target = attr.value.trim();
      const resolved = byId.get(target) ?? byDisplayId.get(target);
      if (!resolved) continue;
      if (resolved.shape === entry.shape) continue;
      diagnostics.push({
        code: "MSL-R084",
        severity: "error",
        message: `${entry.displayId}: Supersedes: target '${target}' is ` +
          `shape '${resolved.shape}' but source is '${entry.shape}' — ` +
          `Supersedes operates within a shape (ADR-002 §Part 1)`,
        location: entry.location,
      });
    }

    for (const rule of TRACE_RULES) {
      for (const attr of entry.rawAttributes) {
        if (attr.key !== rule.attr) continue;
        const target = attr.value.trim();
        const resolved = byId.get(target) ?? byDisplayId.get(target);
        if (!resolved) continue;
        const targetType = resolvedCoreType(resolved);
        if (!targetType) continue;
        if (isTargetTypeCompatible(targetType, rule.allowedTargetTypes)) {
          continue;
        }
        diagnostics.push({
          code: "MSL-R083",
          severity: "error",
          message: `${entry.displayId}: ${rule.attr}: target '${target}' is ` +
            `of type '${targetType}' — expected one of [${
              rule.allowedTargetTypes.join(", ")
            }]`,
          location: entry.location,
        });
      }
    }

    // Polymorphic Caused-by: choose the allowed set from the source's
    // resolved type, falling back to the union if the source is the
    // shared Specification parent or unclassified.
    const sourceType = resolvedCoreType(entry);
    for (const attr of entry.rawAttributes) {
      if (attr.key !== "Caused-by") continue;
      const target = attr.value.trim();
      const resolved = byId.get(target) ?? byDisplayId.get(target);
      if (!resolved) continue;
      const targetType = resolvedCoreType(resolved);
      if (!targetType) continue;

      const role = POLYMORPHIC_CAUSED_BY.find((r) => sourceType === r.source);
      const allowed = role ? role.allowed : [
        ...new Set(POLYMORPHIC_CAUSED_BY.flatMap((r) => r.allowed)),
      ];
      if (isTargetTypeCompatible(targetType, allowed)) continue;
      diagnostics.push({
        code: "MSL-R083",
        severity: "error",
        message: `${entry.displayId}: Caused-by: target '${target}' is ` +
          `of type '${targetType}' — expected one of [${allowed.join(", ")}]`,
        location: entry.location,
      });
    }

    // Link-target severity diagnostics (MSL-R081 / MSL-R082) for all
    // forward-pointing trace attributes. Supersedes is excluded — its
    // predecessor target is meant to be retired.
    for (const attr of entry.rawAttributes) {
      if (!SEVERITY_TRACKED_ATTRS.includes(attr.key)) continue;
      // Citations may carry a free-text locator after the slug — take
      // the first whitespace-separated token as the target.
      const target = attr.value.trim().split(/\s+/)[0];
      if (!target) continue;
      const resolved = byId.get(target) ?? byDisplayId.get(target);
      if (!resolved) continue;
      if (isRetired(resolved)) {
        diagnostics.push({
          code: "MSL-R081",
          severity: "warning",
          message: `${entry.displayId}: ${attr.key}: target '${target}' is ` +
            `retired (Deprecated set on the target entry)`,
          location: entry.location,
        });
      }
      if (isDraft(resolved)) {
        diagnostics.push({
          code: "MSL-R082",
          severity: "info",
          message: `${entry.displayId}: ${attr.key}: target '${target}' ` +
            `carries Labels: DRAFT`,
          location: entry.location,
        });
      }
    }
  }

  return diagnostics;
}
