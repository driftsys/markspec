/**
 * @module core/lint/rules/suppression
 *
 * Three suppression-hygiene rules for PA-1 through PA-3:
 *   MSL-Q900  disable-without-rationale  (warn, score 3)
 *   MSL-Q901  disable-unknown-rule       (warn, score 3)
 *   MSL-Q902  disable-unused             (info, score 0)
 *
 * Q900/Q901 run on every Authored entry (not just in-scope ones) because
 * suppression hygiene applies to any entry that uses Markspec-disable.
 *
 * Q902 is runner-level: it is emitted by the runner after the suppression
 * filter, once we know which codes actually matched a diagnostic. The
 * {@linkcode runUnusedSuppressionCheck} helper is called from the runner
 * after the filter step — it compares the set of disabled codes to the
 * set of codes that were actually suppressed.
 */

import type { Entry, SourceLocation } from "../../model/mod.ts";
import type { LintDiagnostic } from "../types.ts";
import { LEXICON_RULE_CODES } from "./lexicon.ts";
import { STRUCT_RULE_CODES } from "./struct.ts";
import { EARS_RULE_CODES } from "./ears.ts";
import { MODAL_SENTENCE_RULE_CODES } from "./modal_sentence.ts";
import { INCOSE_SENTENCE_RULE_CODES } from "./incose_sentence.ts";
import { PASSIVE_RULE_CODES } from "./passive.ts";

/** All rule codes shipped in PA-1 through PA-3 (slices 1–10).
 * MSL-Q900/Q901/Q902 are self-referential. */
export const PA1_KNOWN_RULE_CODES: ReadonlySet<string> = new Set([
  ...LEXICON_RULE_CODES,
  ...STRUCT_RULE_CODES,
  ...EARS_RULE_CODES,
  ...MODAL_SENTENCE_RULE_CODES,
  ...INCOSE_SENTENCE_RULE_CODES,
  ...PASSIVE_RULE_CODES,
  // Q500: xref-glossary-undefined (slice 5)
  "MSL-Q500",
  "MSL-Q900",
  "MSL-Q901",
  "MSL-Q902",
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

// ---------------------------------------------------------------------------
// Q902 — disable-unused (runner integration)
// ---------------------------------------------------------------------------

/**
 * Context supplied by the runner after the suppression filter step.
 * Carries both the full set of disabled codes/slugs from the entry's
 * `Markspec-disable:` attribute and the subset that actually matched
 * (i.e., suppressed) a diagnostic during this run.
 */
export interface UnusedSuppressionContext {
  readonly entry: Entry;
  /** Codes/slugs listed in `Markspec-disable:`. */
  readonly disabledCodes: ReadonlySet<string>;
  /** Codes that matched at least one diagnostic (were actually suppressed). */
  readonly matchedCodes: ReadonlySet<string>;
}

/**
 * Emit MSL-Q902 for each disabled code/slug that did not match any
 * diagnostic during this run (stale escape hatch).
 *
 * One Q902 is emitted per unused code, not per entry. Emitted at the
 * entry location (entry-level range — no sentence span).
 *
 * Suppression-hygiene diagnostics (Q900/Q901/Q902 themselves) are never
 * suppressed, so unused checks for Q900/Q901/Q902 are intentionally
 * allowed to fire — they serve as documentation of over-suppression.
 */
export function runUnusedSuppressionCheck(
  ctx: UnusedSuppressionContext,
): LintDiagnostic[] {
  const out: LintDiagnostic[] = [];
  const location: SourceLocation = ctx.entry.location;
  for (const code of ctx.disabledCodes) {
    if (!ctx.matchedCodes.has(code)) {
      out.push({
        code: "MSL-Q902",
        slug: "disable-unused",
        severity: "info",
        scoreContribution: 0,
        group: "disable",
        message:
          `disable-unused: '${code}' is listed in 'Markspec-disable' but no matching diagnostic was emitted for this entry`,
        location,
      });
    }
  }
  return out;
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
