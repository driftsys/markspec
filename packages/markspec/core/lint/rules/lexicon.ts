/**
 * @module core/lint/rules/lexicon
 *
 * Six INCOSE GtWR lexicon rules for PA-1. All operate by scanning
 * InlineContent.text in prose-bearing AST blocks for canonical
 * word/phrase matches. No sentence segmentation needed.
 *
 * Rules:
 *   MSL-Q302  incose-r7-vague-term         (warn, score 3)
 *   MSL-Q303  incose-r8-escape-clause      (warn, score 3)
 *   MSL-Q304  incose-r9-open-ended         (info, score 1)
 *   MSL-Q305  incose-r10-superfluous-inf   (info, score 1)
 *   MSL-Q310  incose-r26-absolute          (info, score 1)
 *   MSL-Q313  incose-r16-not               (info, score 1)
 */

import type { BodyBlock } from "../../ast/nodes.ts";
import type { Entry, Severity, SourceLocation } from "../../model/mod.ts";
import type { LintDiagnostic } from "../types.ts";

// ---------------------------------------------------------------------------
// Word/phrase lists (INCOSE GtWR canonical sets)
// ---------------------------------------------------------------------------

const Q302_TERMS = [
  "some",
  "several",
  "many",
  "few",
  "a number of",
  "approximate",
  "approximately",
  "adequate",
  "adequately",
  "sufficient",
  "sufficiently",
  "reasonable",
  "reasonably",
  "efficient",
  "efficiently",
  "appropriate",
  "appropriately",
  "effective",
  "effectively",
  "as needed",
  "as required",
];

const Q303_TERMS = [
  "as appropriate",
  "as required",
  "where possible",
  "if practicable",
  "if possible",
  "to the extent possible",
  "to the extent necessary",
  "where applicable",
  "to the extent practicable",
];

const Q304_TERMS = [
  "including but not limited to",
  "etc.",
  "et cetera",
  "and so on",
  "and/or",
];

const Q305_TERMS = [
  "be able to",
  "be capable of",
  "be designed to",
  "be required to",
  "to enable",
  "to allow",
  "in order to",
];

const Q310_TERMS = [
  "100%",
  "all of",
  "every",
  "all the",
  "always",
  "never",
  "none",
  "no instance",
  "complete",
  "completely",
  "entire",
  "entirely",
];

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

interface LexiconRule {
  readonly code: string;
  readonly slug: string;
  readonly severity: Severity;
  readonly scoreContribution: number;
  readonly terms: readonly string[];
  /** When true, use whole-word boundary matching instead of substring. */
  readonly wholeWord: boolean;
}

const LEXICON_RULES: readonly LexiconRule[] = [
  {
    code: "MSL-Q302",
    slug: "incose-r7-vague-term",
    severity: "warning",
    scoreContribution: 3,
    terms: Q302_TERMS,
    wholeWord: false,
  },
  {
    code: "MSL-Q303",
    slug: "incose-r8-escape-clause",
    severity: "warning",
    scoreContribution: 3,
    terms: Q303_TERMS,
    wholeWord: false,
  },
  {
    code: "MSL-Q304",
    slug: "incose-r9-open-ended",
    severity: "info",
    scoreContribution: 1,
    terms: Q304_TERMS,
    wholeWord: false,
  },
  {
    code: "MSL-Q305",
    slug: "incose-r10-superfluous-infinitive",
    severity: "info",
    scoreContribution: 1,
    terms: Q305_TERMS,
    wholeWord: false,
  },
  {
    code: "MSL-Q310",
    slug: "incose-r26-absolute",
    severity: "info",
    scoreContribution: 1,
    terms: Q310_TERMS,
    wholeWord: false,
  },
];

// Q313 uses whole-word boundary matching — "not" must not match "note", "notation"
const Q313_RULE: LexiconRule = {
  code: "MSL-Q313",
  slug: "incose-r16-not",
  severity: "info",
  scoreContribution: 1,
  terms: ["not"],
  wholeWord: true,
};

// ---------------------------------------------------------------------------
// Text extraction from AST blocks
// ---------------------------------------------------------------------------

/** Extract all InlineContent.text strings from prose-bearing AST blocks.
 * Walks Paragraph, Note, and List (recursively) per the PA-1 scope.
 * Skips Table, Code, Feature, Math, Blockquote, etc. */
function extractTexts(blocks: readonly BodyBlock[]): string[] {
  const texts: string[] = [];
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      texts.push(block.content.text);
    } else if (block.kind === "note") {
      texts.push(block.content.text);
    } else if (block.kind === "list") {
      for (const item of block.items) {
        texts.push(...extractTexts(item.blocks));
      }
    }
    // Table, Blockquote, Code, Feature, Math, Caption, Unknown: skip
  }
  return texts;
}

// ---------------------------------------------------------------------------
// Match helpers
// ---------------------------------------------------------------------------

/** Case-insensitive substring scan — returns true if any term found. */
function containsTerm(text: string, term: string): boolean {
  return text.toLowerCase().includes(term.toLowerCase());
}

/** Whole-word, case-insensitive match using word boundaries. */
function containsWholeWord(text: string, word: string): boolean {
  // Build a regex with word boundaries around the term.
  // Escape any regex metacharacters in the word (unlikely for "not" but safe).
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "i");
  return re.test(text);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Run all six lexicon rules on an entry's prose AST blocks.
 * Returns one LintDiagnostic per matching term per rule (one per rule
 * per entry — first match only, to avoid flooding). */
export function runLexiconRules(entry: Entry): LintDiagnostic[] {
  const blocks = entry.bodyAst ?? [];
  const texts = extractTexts(blocks);
  if (texts.length === 0) return [];

  const out: LintDiagnostic[] = [];
  const location: SourceLocation = entry.location;

  for (const rule of LEXICON_RULES) {
    let fired = false;
    for (const text of texts) {
      if (fired) break;
      for (const term of rule.terms) {
        if (containsTerm(text, term)) {
          out.push({
            code: rule.code,
            slug: rule.slug,
            severity: rule.severity,
            scoreContribution: rule.scoreContribution,
            group: "incose",
            message: `${rule.slug}: '${term}' found in entry body`,
            location,
          });
          fired = true;
          break;
        }
      }
    }
  }

  // Q313: whole-word "not"
  let q313Fired = false;
  for (const text of texts) {
    if (q313Fired) break;
    if (containsWholeWord(text, "not")) {
      out.push({
        code: Q313_RULE.code,
        slug: Q313_RULE.slug,
        severity: Q313_RULE.severity,
        scoreContribution: Q313_RULE.scoreContribution,
        group: "incose",
        message: `${Q313_RULE.slug}: 'not' found in entry body`,
        location,
      });
      q313Fired = true;
    }
  }

  return out;
}

/** Exported for test/diagnostic use: the set of rule codes this module emits. */
export const LEXICON_RULE_CODES: ReadonlySet<string> = new Set([
  "MSL-Q302",
  "MSL-Q303",
  "MSL-Q304",
  "MSL-Q305",
  "MSL-Q310",
  "MSL-Q313",
]);
