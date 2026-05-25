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
} from "./rules/suppression.ts";
import { buildGlossaryIndex } from "./glossary.ts";
import type { FileReader, GlossaryIndex } from "./glossary.ts";
import { runXrefRules } from "./rules/xref.ts";
import type { IsIdentifierHook } from "./rules/xref.ts";
import { runEarsRules } from "./rules/ears.ts";
import { runModalSentenceRules } from "./rules/modal_sentence.ts";
import { runIncoseSentenceRules } from "./rules/incose_sentence.ts";
import { loadLexicon } from "../lexicons/mod.ts";

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
 *   9. Run suppression hygiene on ALL Authored entries.
 *  10. Apply suppression: drop in-scope diagnostics where the entry's
 *      Markspec-disable list includes the rule's code and the entry
 *      has a Rationale. Suppression-hygiene diagnostics (Q900/Q901)
 *      are never suppressed.
 *  11. Return remaining diagnostics.
 */
export async function runLint(options: LintOptions): Promise<LintResult> {
  const { entries } = options;
  const allow = options.capitalizedAllow ?? loadLexicon("capitalized-allow");
  const glossary: GlossaryIndex = await buildGlossaryIndex(
    entries,
    options.readFile ?? (() => Promise.resolve(undefined)),
    options.glossaryFilePaths ?? [],
  );
  const isIdHook: IsIdentifierHook = () => false;

  // Steps 1–8: collect diagnostics keyed by entry
  const inScopeDiags = new Map<Entry, LintDiagnostic[]>();
  for (const entry of entries) {
    if (!isProseScope(entry)) continue;
    const diags: LintDiagnostic[] = [];
    diags.push(...runLexiconRules(entry));
    diags.push(...runStructRules(entry));
    diags.push(...runXrefRules(entry, glossary, allow, isIdHook));
    diags.push(...runEarsRules(entry));
    diags.push(...runModalSentenceRules(entry));
    // Step 8: INCOSE sentence rules (Q306–Q312, Q402)
    diags.push(...runIncoseSentenceRules(entry));
    inScopeDiags.set(entry, diags);
  }

  // Step 9: suppression hygiene on all Authored entries
  const hygieneDiags: LintDiagnostic[] = [];
  for (const entry of entries) {
    if (entry.shape !== "Authored") continue;
    hygieneDiags.push(...runSuppressionRules(entry));
  }

  // Step 10: apply suppression to in-scope diagnostics
  const out: LintDiagnostic[] = [];
  for (const [entry, diags] of inScopeDiags) {
    const disabled = disabledCodes(entry);
    const entryHasRationale = hasRationale(entry);
    for (const diag of diags) {
      // Suppression requires both a matching code AND a Rationale.
      if (entryHasRationale && disabled.has(diag.code)) continue;
      out.push(diag);
    }
  }

  // Step 11: append hygiene diagnostics (never suppressed)
  out.push(...hygieneDiags);

  return { diagnostics: out };
}
