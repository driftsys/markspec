/**
 * @module core/lint/runner
 *
 * Lint pipeline entry point. Filters entries to in-scope prose targets,
 * runs lexicon and structural rules, runs Q500 xref rules, runs
 * suppression hygiene on all Authored entries, applies suppression, and
 * returns the final diagnostics.
 */

import type { Entry } from "../model/mod.ts";
import { CORE_TYPE_HIERARCHY } from "../model/mod.ts";
import { resolvedCoreType } from "../validator/type_resolution.ts";
import type { LintDiagnostic } from "./types.ts";
import { runLexiconRules } from "./rules/lexicon.ts";
import { runStructRules } from "./rules/struct.ts";
import {
  hasRationale,
  parseDisableValue,
  runSuppressionRules,
  runUnusedSuppressionCheck,
} from "./rules/suppression.ts";
import { buildGlossaryIndex } from "./glossary.ts";
import type { FileReader, GlossaryIndex } from "./glossary.ts";
import {
  buildIdentifierIndex,
  buildIsIdentifierHook,
  runXrefRules,
} from "./rules/xref.ts";
import { runEarsRules } from "./rules/ears.ts";
import { runModalSentenceRules } from "./rules/modal_sentence.ts";
import { runIncoseSentenceRules } from "./rules/incose_sentence.ts";
import { runPassiveRules } from "./rules/passive.ts";
import { loadLexicon } from "../lexicons/mod.ts";
import { computeScoreRollup } from "./score.ts";
import type { ScoreRollup } from "./score.ts";

// ---------------------------------------------------------------------------
// In-scope predicate
// ---------------------------------------------------------------------------

/** Walk the CORE_TYPE_HIERARCHY parent chain to check ancestry. */
function isSpecificationDescendant(typeName: string): boolean {
  let cursor: string | null = typeName;
  while (cursor !== null) {
    if (cursor === "Specification") return true;
    cursor = CORE_TYPE_HIERARCHY[cursor]?.parent ?? null;
  }
  return false;
}

/**
 * Returns true when prose-analysis rules should run on this entry.
 *
 * In-scope: Authored shape AND resolved core type is Specification or
 * a direct subtype (Requirement, Test, Contract, Record, Risk).
 * Reference-shape entries are always excluded.
 */
export function isProseScope(entry: Entry): boolean {
  if (entry.shape === "Reference") return false;
  const coreType = resolvedCoreType(entry);
  if (!coreType) return false;
  return isSpecificationDescendant(coreType);
}

// ---------------------------------------------------------------------------
// Pipeline types
// ---------------------------------------------------------------------------

export interface LintOptions {
  readonly entries: readonly Entry[];
  /** Profile-extended capitalized-allow lexicon. Defaults to core baseline. */
  readonly capitalizedAllow?: ReadonlySet<string>;
  /** Glossary file paths discovered by the listing-directive validator. */
  readonly glossaryFilePaths?: readonly string[];
  /** File reader for glossary index construction. */
  readonly readFile?: FileReader;
}

export interface LintResult {
  readonly diagnostics: readonly LintDiagnostic[];
  readonly score: ScoreRollup;
}

// ---------------------------------------------------------------------------
// Suppression application
// ---------------------------------------------------------------------------

/** Parse the Markspec-disable list for an entry into a Set of codes/slugs. */
function disabledCodes(entry: Entry): ReadonlySet<string> {
  for (const attr of entry.rawAttributes) {
    if (attr.key === "Markspec-disable") {
      return new Set(parseDisableValue(attr.value));
    }
  }
  return new Set();
}

// ---------------------------------------------------------------------------
// runLint
// ---------------------------------------------------------------------------

/**
 * Run the lint pipeline on a set of entries.
 *
 * Pipeline:
 *   1. Filter to in-scope entries (Specification subtypes, Authored shape).
 *   2. Build glossary index from DefinitionList nodes and glossary files.
 *   3. Run lexicon rules on each in-scope entry's prose blocks.
 *   4. Run structural rules on each in-scope entry.
 *   5. Run Q500 xref rules on each in-scope entry.
 *   6. Run EARS rules (Q100–Q104) on each in-scope entry.
 *   7. Run modal sentence rules (Q200–Q201) on each in-scope entry.
 *   8. Run INCOSE sentence rules (Q306–Q312, Q402) on each in-scope entry.
 *   9. Run passive-voice rules (Q300–Q301) on each in-scope entry.
 *  10. Run suppression hygiene on ALL Authored entries.
 *  11. Apply suppression: drop in-scope diagnostics where the entry's
 *      Markspec-disable list includes the rule's code and the entry
 *      has a Rationale. Track which codes were actually suppressed.
 *      Suppression-hygiene diagnostics (Q900/Q901/Q902) are never
 *      suppressed.
 *  12. Run Q902 (disable-unused): emit one info diagnostic per disabled
 *      code that did not match any diagnostic this run (stale escape hatch).
 *  13. Compute score roll-up (per-entry scores, band-counts, mean).
 *  14. Return diagnostics and score.
 */
export async function runLint(options: LintOptions): Promise<LintResult> {
  const { entries } = options;
  const allow = options.capitalizedAllow ?? loadLexicon("capitalized-allow");
  const glossary: GlossaryIndex = await buildGlossaryIndex(
    entries,
    options.readFile ?? (() => Promise.resolve(undefined)),
    options.glossaryFilePaths ?? [],
  );
  // Corpus-scan resolver leg (issue #502, ADR-021 Decision 1). Built once
  // per invocation; reused across every in-scope entry. Honors the
  // additive-enrichment invariant — Q500 fires *less* as the resolver
  // grows, never *more*.
  const isIdHook = buildIsIdentifierHook(buildIdentifierIndex(entries));

  // Steps 1–9: collect diagnostics keyed by entry
  const inScopeDiags = new Map<Entry, LintDiagnostic[]>();
  for (const entry of entries) {
    if (!isProseScope(entry)) continue;
    const diags: LintDiagnostic[] = [];
    // Step 3: lexicon rules
    diags.push(...runLexiconRules(entry));
    // Step 4: structural rules
    diags.push(...runStructRules(entry));
    // Step 5: xref rules (Q500)
    diags.push(...runXrefRules(entry, glossary, allow, isIdHook));
    // Step 6: EARS rules (Q100–Q104)
    diags.push(...runEarsRules(entry));
    // Step 7: modal sentence rules (Q200–Q201)
    diags.push(...runModalSentenceRules(entry));
    // Step 8: INCOSE sentence rules (Q306–Q312, Q402)
    diags.push(...runIncoseSentenceRules(entry));
    // Step 9: passive-voice rules (Q300–Q301)
    diags.push(...runPassiveRules(entry));
    inScopeDiags.set(entry, diags);
  }

  // Step 10: suppression hygiene on all Authored entries
  const hygieneDiags: LintDiagnostic[] = [];
  for (const entry of entries) {
    if (entry.shape !== "Authored") continue;
    hygieneDiags.push(...runSuppressionRules(entry));
  }

  // Step 11: apply suppression to in-scope diagnostics; track matched codes
  // per entry so Step 12 can detect unused suppressions (Q902).
  const out: LintDiagnostic[] = [];
  for (const [entry, diags] of inScopeDiags) {
    const disabled = disabledCodes(entry);
    const entryHasRationale = hasRationale(entry);
    const matched = new Set<string>();
    for (const diag of diags) {
      // Suppression requires both a matching code AND a Rationale.
      if (entryHasRationale && disabled.has(diag.code)) {
        matched.add(diag.code);
        continue;
      }
      out.push(diag);
    }
    // Step 12: Q902 — emit one info diagnostic per disabled code that
    // did not suppress any diagnostic during this run.
    if (disabled.size > 0) {
      out.push(
        ...runUnusedSuppressionCheck({
          entry,
          disabledCodes: disabled,
          matchedCodes: matched,
        }),
      );
    }
  }

  // Append hygiene diagnostics (Q900/Q901 — never suppressed)
  out.push(...hygieneDiags);

  // Step 13: compute score roll-up across all entries (including 0-score ones).
  const score = computeScoreRollup(out, entries);

  return { diagnostics: out, score };
}
