/**
 * @module core/lint/rules/suppression
 *
 * Two suppression-hygiene rules for PA-1:
 *   MSL-Q900  disable-without-rationale  (warn, score 3)
 *   MSL-Q901  disable-unknown-rule       (warn, score 3)
 *
 * These run on every Authored entry (not just in-scope ones) because
 * suppression hygiene applies to any entry that uses Markspec-disable.
 */

import type { Entry, SourceLocation } from "../../model/mod.ts";
import type { LintDiagnostic } from "../types.ts";
import { LEXICON_RULE_CODES } from "./lexicon.ts";
import { STRUCT_RULE_CODES } from "./struct.ts";

/** All rule codes shipped in PA-1. MSL-Q900/Q901 are self-referential. */
export const PA1_KNOWN_RULE_CODES: ReadonlySet<string> = new Set([
  ...LEXICON_RULE_CODES,
  ...STRUCT_RULE_CODES,
  "MSL-Q900",
  "MSL-Q901",
]);

/** Parse the Markspec-disable attribute value into individual rule tokens. */
export function parseDisableValue(value: string): string[] {
  return value.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
}

/** Return the Markspec-disable attribute value, or undefined. */
function getDisableValue(entry: Entry): string | undefined {
  for (const attr of entry.rawAttributes) {
    if (attr.key === "Markspec-disable") return attr.value;
  }
  return undefined;
}

/** Return whether the entry has a non-empty Rationale attribute. */
export function hasRationale(entry: Entry): boolean {
  for (const attr of entry.rawAttributes) {
    if (attr.key === "Rationale" && attr.value.trim().length > 0) return true;
  }
  return false;
}

/** Run MSL-Q900 and MSL-Q901 on an entry. Safe to call on all Authored entries. */
export function runSuppressionRules(entry: Entry): LintDiagnostic[] {
  const out: LintDiagnostic[] = [];
  const location: SourceLocation = entry.location;

  const disableValue = getDisableValue(entry);
  if (disableValue === undefined) return out;

  // MSL-Q900: disable without rationale
  if (!hasRationale(entry)) {
    out.push({
      code: "MSL-Q900",
      slug: "disable-without-rationale",
      severity: "warning",
      scoreContribution: 3,
      group: "disable",
      message:
        "disable-without-rationale: 'Markspec-disable' requires a companion 'Rationale' attribute",
      location,
    });
  }

  // MSL-Q901: disable-unknown-rule — check each token in the list
  const tokens = parseDisableValue(disableValue);
  for (const token of tokens) {
    if (!PA1_KNOWN_RULE_CODES.has(token)) {
      out.push({
        code: "MSL-Q901",
        slug: "disable-unknown-rule",
        severity: "warning",
        scoreContribution: 3,
        group: "disable",
        message:
          `disable-unknown-rule: '${token}' is not a known lint rule code`,
        location,
      });
    }
  }

  return out;
}
