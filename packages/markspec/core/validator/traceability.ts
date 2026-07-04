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
 *   - Target match against the rule's target matchers (MSL-L004; skipped
 *     when the resolved target is an upstream entry — its `type` comes from
 *     the upstream's own profile, a vocabulary the consumer never
 *     re-classifies against, federated upstream slice 4)
 *   - Target existence (MSL-L006, warning; scheme-qualified URIs exempt) —
 *     or MSL-T014 (warning) instead of MSL-L006 when the caller declares a
 *     non-empty upstream set (federated upstream, slice 4)
 *
 * Referenced entries are skipped entirely — the profile manifest parser
 * rejects `referenced.traceability` at load time, so referenced entries
 * never have declared outgoing links.
 */

import {
  type Diagnostic,
  type EffectiveProfile,
  type Entry,
  isUpstreamEntry,
  type TargetMatcher,
  type TraceRule,
  URI_SCHEME_RE,
} from "../model/mod.ts";

/**
 * Effective trace rules for an entry: type-scope rules only.
 * Type-scope rules are applied only when the entry is classified.
 *
 * Reference entries (shape !== "Authored") always return an empty map.
 */
export function effectiveTraceRules(
  entry: Entry,
  profile: EffectiveProfile,
): ReadonlyMap<string, TraceRule> {
  const out = new Map<string, TraceRule>();
  if (entry.shape !== "Authored") return out;

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

/**
 * Run Stage 4 traceability checks for one entry.
 *
 * Skips referenced entries entirely. For identified entries, iterates the
 * effective trace rules and emits MSL-L001..L004 as appropriate.
 *
 * @param entry - The entry to validate (after Stage 2 classification +
 *                Stage 2.5 normalization)
 * @param profile - The effective profile (null → never called)
 * @param graph - Index keyed by entry.id (ULID) for target lookup
 * @param byDisplayId - Index keyed by entry.displayId for target lookup
 *                      (issue #593 — display-ID targets). Defaults to empty.
 * @param declaredUpstreamIds - Upstream ids the downstream project declares
 *                      via `project.yaml` `dependencies:`/`references:`
 *                      (federated upstream, slice 4). When non-empty, an
 *                      otherwise-unresolved trace target fires MSL-T014
 *                      (warning), naming the searched upstream set, instead
 *                      of the generic MSL-L006. Defaults to empty — MSL-L006
 *                      unchanged.
 */
export function validateTraceabilityForEntry(
  entry: Entry,
  profile: EffectiveProfile,
  graph: ReadonlyMap<string, Entry>,
  byDisplayId: ReadonlyMap<string, Entry> = new Map(),
  declaredUpstreamIds: readonly string[] = [],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (entry.shape !== "Authored") return diagnostics;

  const rules = effectiveTraceRules(entry, profile);
  const present = entry.typedAttributes;

  for (const [linkName, rule] of rules) {
    const values = present.get(linkName);
    const count = values?.length ?? 0;
    const card = rule.cardinality ?? { lower: 0, upper: Infinity };

    // MSL-L001: required link missing.
    if (rule.required && count === 0) {
      diagnostics.push({
        code: "MSL-L001",
        severity: "error",
        message:
          `${entry.displayId}: required link attribute '${linkName}' is missing`,
        location: entry.location,
      });
      continue;
    }

    if (count === 0) continue;

    // MSL-L002: upper cardinality.
    if (count > card.upper) {
      diagnostics.push({
        code: "MSL-L002",
        severity: "error",
        message:
          `${entry.displayId}: link '${linkName}' has ${count} values but max is ${
            formatUpper(card.upper)
          }`,
        location: entry.location,
      });
    }

    // MSL-L003: lower cardinality.
    if (count < card.lower) {
      diagnostics.push({
        code: "MSL-L003",
        severity: "error",
        message:
          `${entry.displayId}: link '${linkName}' has ${count} values but min is ${card.lower}`,
        location: entry.location,
      });
    }

    // MSL-L004 target match + MSL-L006 existence, for each resolved value.
    // Resolve by ULID (graph) first, then by display ID (byDisplayId) — the
    // dual-resolution spine (issue #593).
    for (const v of values!) {
      const target = graph.get(v) ?? byDisplayId.get(v);
      if (!target) {
        // Scheme-qualified URIs are intentionally external — never local
        // graph targets, so they are not "broken references".
        if (URI_SCHEME_RE.test(v)) continue;
        // Federated upstream (slice 4): when the project declares an
        // upstream set, an unresolved target replaces MSL-L006 with
        // MSL-T014, naming the searched set — the same target fires
        // exactly one of the two codes, never both.
        if (declaredUpstreamIds.length > 0) {
          diagnostics.push({
            code: "MSL-T014",
            severity: "warning",
            message:
              `${entry.displayId}: link '${linkName}' target '${v}' not ` +
              `found in project or upstreams: ${
                declaredUpstreamIds.join(", ")
              }`,
            location: entry.location,
          });
          continue;
        }
        diagnostics.push({
          code: "MSL-L006",
          severity: "warning",
          message:
            `${entry.displayId}: link '${linkName}' target '${v}' does not ` +
            `resolve to any entry`,
          location: entry.location,
        });
        continue;
      }
      // Federated upstream (slice 4): an upstream target's `type` is
      // classified by the upstream's OWN profile — a foreign vocabulary the
      // consumer's profile cannot map (design §4.5/D6: the consumer never
      // re-classifies). The link still resolves (no L006/T014 — handled
      // above); only the consumer's own target-type enforcement is skipped
      // for this target. A project-authored target with a mismatched type
      // still fires MSL-L004 below.
      if (isUpstreamEntry(target)) continue;
      if (!matchesAnyTarget(target, rule.target)) {
        diagnostics.push({
          code: "MSL-L004",
          severity: "error",
          message:
            `${entry.displayId}: link '${linkName}' targets ${target.displayId} ` +
            `whose type '${
              target.type ?? "<unclassified>"
            }' / shape '${target.shape}' ` +
            `is not accepted by rule target ${stringifyMatchers(rule.target)}`,
          location: entry.location,
        });
      }
    }
  }

  return diagnostics;
}

function formatUpper(u: number): string {
  return u === Infinity ? "N" : String(u);
}

function stringifyMatchers(matchers: readonly TargetMatcher[]): string {
  const parts = matchers.map((m) =>
    typeof m === "string" ? m : `{shape: ${m.shape}}`
  );
  return `[${parts.join(", ")}]`;
}
