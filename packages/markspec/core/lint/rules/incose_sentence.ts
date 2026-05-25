/**
 * @module core/lint/rules/incose_sentence
 *
 * INCOSE sentence-level rules for PA-3 plus the entry-level Q402:
 *
 *   MSL-Q306  incose-r11-separate-clauses   (info, score 1)
 *   MSL-Q307  incose-r18-single-thought      (warn, score 3)
 *   MSL-Q308  incose-r19-combinator          (info, score 1)
 *   MSL-Q309  incose-r24-pronouns            (info, score 1)
 *   MSL-Q311  incose-r27-explicit-conditions (info, score 1)
 *   MSL-Q312  incose-r33-range-of-values     (info, score 1)
 *   MSL-Q402  struct-multiple-shall          (warn, score 3)
 *
 * Q300 (passive voice) and Q301 (subject-verb) are deferred to slice 10
 * due to heuristic complexity.
 *
 * All rules are heuristic. Default to `info` severity to avoid training
 * authors to ignore the catalog. Q307 and Q402 are `warn` because they
 * indicate multi-obligation requirements — structural issues, not style.
 *
 * Q402 is entry-level: it fires when ≥2 normative modals appear across
 * the whole body but no single sentence already triggered Q200 (the
 * per-sentence modal-multiple rule). This catches requirements where
 * obligations are spread across separate sentences/paragraphs rather
 * than concentrated in one.
 */

import type { Entry } from "../../model/mod.ts";
import type { BodyBlock, ParagraphNode } from "../../ast/nodes.ts";
import type { LintDiagnostic } from "../types.ts";
import { segmentSentences } from "../segmenter.ts";
import { loadLexicon } from "../../lexicons/mod.ts";
import { offsetToRange } from "../range_util.ts";
// Re-use MODAL_COMPOUND_RE from modal_sentence to avoid further duplication.
// Importing it avoids a separate modal_tokens.ts extraction (option b) while
// keeping option c (copy/paste) off the table.
import { MODAL_COMPOUND_RE } from "./modal_sentence.ts";

const ABBREVS = loadLexicon("sentence-abbrev");

// ---------------------------------------------------------------------------
// Regexes
// ---------------------------------------------------------------------------

/**
 * EARS condition keywords counted by Q306 (2 conditions triggers Q306;
 * ≥3 is Q103 territory). Same set as EARS_PRECONDITION_RE in ears.ts
 * but this counts `where` too — Q306 is about clause-packing, not just
 * preconditions.
 */
const CONDITION_KEYWORD_RE = /\b(when|while|if|where)\b/gi;

/**
 * Q307 — single thought: detect `and` joining two independent clauses
 * each with their own modal verb. Fires when a sentence contains `and`
 * and ≥2 modal occurrences.
 */
const AND_RE = /\band\b/i;

/**
 * Q308 — combinator: `however`, `whereas`, `meanwhile`, `but`, `unless`
 * joining clauses that should be separate. These are discourse connectives
 * that signal the sentence contains multiple thoughts.
 */
const COMBINATOR_RE = /\b(however|whereas|meanwhile|but|unless)\b/i;

/**
 * Q309 — pronouns: personal/indefinite pronouns heuristically indicating
 * a missing antecedent. Whole-word, case-insensitive.
 *
 * `that` is included here but filtered separately by the relative-clause
 * heuristic — see {@linkcode hasThatRelativeClause}.
 */
const PRONOUN_RE = /\b(it|this|that|they|them)\b/gi;

/**
 * Q309 — `it` exception: `it` immediately after an EARS leading-clause
 * pattern (comma + EARS keyword). Heuristic: "When X, it shall…" is a
 * common shorthand and should not fire.
 *
 * Detection: the SPECIFIC `it` occurrence at position `idx` is preceded
 * (after stripping leading whitespace from `idx`) by a `,`. Checked
 * per-occurrence — not sentence-wide — so a sentence like
 * "When X, it shall log and then it shall store it." correctly flags
 * the second and third `it` while exempting the first.
 */
function isItAfterComma(sentence: string, idx: number): boolean {
  // Walk back from idx skipping whitespace; the first non-space char
  // must be a comma.
  let k = idx - 1;
  while (k >= 0 && sentence[k] === " ") k--;
  return k >= 0 && sentence[k] === ",";
}

/**
 * Q309 — `that` exception: `that` acting as a relative-clause introducer
 * rather than a demonstrative pronoun. Heuristic: `that` followed by a
 * word character (a verb/adjective in the relative clause) is acceptable.
 * `that` at end-of-clause or followed by punctuation signals a
 * demonstrative use.
 *
 * Conservative approach: treat `that` followed by `\w` as a relative
 * clause (skip). Only flag `that` NOT followed by `\w`.
 */
function hasThatRelativeClause(sentence: string, thatIdx: number): boolean {
  // Skip any whitespace after "that"
  const afterThat = thatIdx + 4; // length of "that"
  let k = afterThat;
  while (k < sentence.length && sentence[k] === " ") k++;
  if (k >= sentence.length) return false;
  return /\w/.test(sentence[k]);
}

/**
 * Q311 — implicit condition phrases. A normative sentence containing one of
 * these vague applicability phrases fires Q311, unless the sentence
 * starts with an explicit EARS leading clause (When/While/Where/If).
 *
 * Profile-extensible in a future iteration; for now the set is narrow and
 * documented here for reference.
 */
const IMPLICIT_CONDITION_PHRASES: readonly string[] = [
  "when applicable",
  "as appropriate",
  "in some cases",
  "where relevant",
  "if necessary",
  "as needed",
];

/** Pre-compiled phrase regexes for Q311. */
const IMPLICIT_CONDITION_RES: readonly RegExp[] = IMPLICIT_CONDITION_PHRASES
  .map((p) => new RegExp(`\\b${p.replace(/\s+/g, "\\s+")}\\b`, "i"));

/**
 * Q311 — EARS explicit condition guard: sentence starts with a leading
 * EARS keyword (When/While/Where/If), indicating the condition is already
 * stated explicitly. Q311 should skip such sentences.
 */
const EARS_LEADING_EXPLICIT_RE = /^\s*(When|While|Where|If)\b/i;

/**
 * Q312 — bare numeric quantity with unit but without a tolerance marker.
 *
 * The unit set covers common engineering domains. Deliberately narrow to
 * avoid false positives on plain numbers (version numbers, counts, etc.).
 * Profile-extensible in a future iteration.
 *
 * Units (case-sensitive to avoid `A` matching article "a"):
 *   Force:       N, kN
 *   Length:      m, mm, cm, km
 *   Time:        s, ms, μs, us
 *   Temperature: °C, °F, K (uppercase only — avoid "k" as suffix)
 *   Electrical:  V, A, W, kW (uppercase — avoid "v" = verb)
 *   Frequency:   Hz, kHz, MHz, GHz
 *   Percentage:  %
 *   Angle:       °
 *   Mass:        kg, g (but NOT bare "g" after digits — too many false positives)
 *
 * The pattern requires a digit before the unit and uses word-boundary or
 * end-of-token anchors to avoid partial matches.
 *
 * Note: `kg` is included; bare `g` is excluded (too many false positives
 * from abbreviations). `K` (Kelvin) is included as capital-K only.
 */
const QUANTITY_WITH_UNIT_RE =
  /\b(\d+(?:\.\d+)?)\s*(kN|kHz|MHz|GHz|kW|ms|μs|us|mm|cm|km|°C|°F|Hz|N|m|s|V|A|W|K|kg|%|°)\b/g;

/**
 * Q312 — tolerance markers in the same sentence. If any of these patterns
 * appear, the quantity is considered to carry a tolerance and Q312 is
 * suppressed.
 *
 * Covers: ±, +/-, "within ±", "between X and Y" (via \bbetween\b),
 * comparison operators ≤, ≥, <, >, "tolerance of", "up to", "at most",
 * "at least".
 */
const TOLERANCE_MARKER_RE =
  /±|\+\s*\/\s*-|tolerance\s+of|\bbetween\b|≤|≥|[<>]|\bup\s+to\b|\bat\s+most\b|\bat\s+least\b|\bno\s+more\s+than\b|\bno\s+less\s+than\b/i;

// ---------------------------------------------------------------------------
// Rule code registry
// ---------------------------------------------------------------------------

/** All INCOSE sentence rule codes exported for suppression-hygiene set. */
export const INCOSE_SENTENCE_RULE_CODES: ReadonlySet<string> = new Set([
  "MSL-Q306",
  "MSL-Q307",
  "MSL-Q308",
  "MSL-Q309",
  "MSL-Q311",
  "MSL-Q312",
  "MSL-Q402",
]);

// ---------------------------------------------------------------------------
// Modal counting helper (reusing MODAL_COMPOUND_RE from modal_sentence.ts)
// ---------------------------------------------------------------------------

/**
 * Count the number of modal occurrences in `text`. Resets `MODAL_COMPOUND_RE`
 * lastIndex before every call to prevent state leakage across uses.
 */
function countModals(text: string): number {
  MODAL_COMPOUND_RE.lastIndex = 0;
  let count = 0;
  while (MODAL_COMPOUND_RE.exec(text) !== null) count++;
  return count;
}

// ---------------------------------------------------------------------------
// Emit helpers
// ---------------------------------------------------------------------------

function emit(
  code: string,
  slug: string,
  severity: "info" | "warning",
  scoreContribution: number,
  message: string,
  sentence: string,
  sentenceOffset: number,
  paragraphText: string,
  baseLine: number,
  baseCol: number,
  entry: Entry,
): LintDiagnostic {
  const range = offsetToRange(
    paragraphText,
    sentenceOffset,
    sentence.length,
    baseLine,
    baseCol,
  );
  return {
    code,
    slug,
    severity,
    scoreContribution,
    group: "incose",
    message,
    location: entry.location,
    range,
  };
}

function emitEntryLevel(
  code: string,
  slug: string,
  severity: "info" | "warning",
  scoreContribution: number,
  message: string,
  entry: Entry,
): LintDiagnostic {
  return {
    code,
    slug,
    severity,
    scoreContribution,
    group: "incose",
    message,
    location: entry.location,
  };
}

// ---------------------------------------------------------------------------
// Q306 — incose-r11-separate-clauses
// ---------------------------------------------------------------------------

/**
 * Count EARS condition keywords (when/while/if/where) in `text`. Used by
 * Q306 (fires on 2 conditions) and the Q103-overlap guard (skip when ≥3).
 */
function countConditionKeywords(text: string): number {
  CONDITION_KEYWORD_RE.lastIndex = 0;
  let count = 0;
  while (CONDITION_KEYWORD_RE.exec(text) !== null) count++;
  return count;
}

function checkQ306(
  sentence: string,
  sentenceOffset: number,
  paragraphText: string,
  baseLine: number,
  baseCol: number,
  entry: Entry,
): LintDiagnostic | undefined {
  // Only normative sentences.
  if (countModals(sentence) === 0) return undefined;
  const condCount = countConditionKeywords(sentence);
  // Q306 fires on exactly 2 conditions. ≥3 is Q103 territory for
  // When/While/If — defer to EARS. Note: Q103 does NOT count `where`,
  // so ≥3 stacked `where` clauses fall through both rules silently —
  // an accepted gap for that rare construction.
  if (condCount !== 2) return undefined;
  return emit(
    "MSL-Q306",
    "incose-r11-separate-clauses",
    "info",
    1,
    `incose-r11-separate-clauses: normative sentence packs ${condCount} conditions into one clause; consider splitting into separate requirements`,
    sentence,
    sentenceOffset,
    paragraphText,
    baseLine,
    baseCol,
    entry,
  );
}

// ---------------------------------------------------------------------------
// Q307 — incose-r18-single-thought
// ---------------------------------------------------------------------------

function checkQ307(
  sentence: string,
  sentenceOffset: number,
  paragraphText: string,
  baseLine: number,
  baseCol: number,
  entry: Entry,
): LintDiagnostic | undefined {
  // Fire when the sentence contains `and` AND ≥2 modal verbs.
  // This is broader than Q200 (which fires on any ≥2 modals) but Q307
  // specifically targets the "and joining two obligations" smell.
  // Both Q200 and Q307 may co-fire — both are valid signals.
  if (!AND_RE.test(sentence)) return undefined;
  if (countModals(sentence) < 2) return undefined;
  return emit(
    "MSL-Q307",
    "incose-r18-single-thought",
    "warning",
    3,
    `incose-r18-single-thought: sentence carries more than one obligation joined by 'and'; split into separate single-obligation requirements`,
    sentence,
    sentenceOffset,
    paragraphText,
    baseLine,
    baseCol,
    entry,
  );
}

// ---------------------------------------------------------------------------
// Q308 — incose-r19-combinator
// ---------------------------------------------------------------------------

function checkQ308(
  sentence: string,
  sentenceOffset: number,
  paragraphText: string,
  baseLine: number,
  baseCol: number,
  entry: Entry,
): LintDiagnostic | undefined {
  // Only normative sentences.
  if (countModals(sentence) === 0) return undefined;
  const m = COMBINATOR_RE.exec(sentence);
  if (!m) return undefined;
  const word = m[1].toLowerCase();
  return emit(
    "MSL-Q308",
    "incose-r19-combinator",
    "info",
    1,
    `incose-r19-combinator: discourse combinator '${word}' joins clauses that should be separate requirements`,
    sentence,
    sentenceOffset,
    paragraphText,
    baseLine,
    baseCol,
    entry,
  );
}

// ---------------------------------------------------------------------------
// Q309 — incose-r24-pronouns
// ---------------------------------------------------------------------------

function checkQ309(
  sentence: string,
  sentenceOffset: number,
  paragraphText: string,
  baseLine: number,
  baseCol: number,
  entry: Entry,
): LintDiagnostic | undefined {
  // Only normative sentences.
  if (countModals(sentence) === 0) return undefined;

  PRONOUN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PRONOUN_RE.exec(sentence)) !== null) {
    const pronoun = m[0].toLowerCase();
    const idx = m.index;

    // Exception 1: `it` after a comma (EARS conditional lead-in like "When X, it shall").
    // Per-occurrence check, not sentence-wide — see isItAfterComma JSDoc.
    if (pronoun === "it" && isItAfterComma(sentence, idx)) continue;

    // Exception 2: `that` as a relative-clause introducer.
    if (pronoun === "that" && hasThatRelativeClause(sentence, idx)) continue;

    return emit(
      "MSL-Q309",
      "incose-r24-pronouns",
      "info",
      1,
      `incose-r24-pronouns: pronoun '${pronoun}' may lack an explicit antecedent; replace with the noun it refers to`,
      sentence,
      sentenceOffset,
      paragraphText,
      baseLine,
      baseCol,
      entry,
    );
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Q311 — incose-r27-explicit-conditions
// ---------------------------------------------------------------------------

function checkQ311(
  sentence: string,
  sentenceOffset: number,
  paragraphText: string,
  baseLine: number,
  baseCol: number,
  entry: Entry,
): LintDiagnostic | undefined {
  // Only normative sentences.
  if (countModals(sentence) === 0) return undefined;
  // If the sentence starts with an explicit EARS condition, the applicability
  // IS stated; skip Q311.
  if (EARS_LEADING_EXPLICIT_RE.test(sentence)) return undefined;
  for (const re of IMPLICIT_CONDITION_RES) {
    if (re.test(sentence)) {
      return emit(
        "MSL-Q311",
        "incose-r27-explicit-conditions",
        "info",
        1,
        `incose-r27-explicit-conditions: sentence uses a vague applicability phrase; state the condition explicitly using an EARS leading clause (When/While/Where/If)`,
        sentence,
        sentenceOffset,
        paragraphText,
        baseLine,
        baseCol,
        entry,
      );
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Q312 — incose-r33-range-of-values
// ---------------------------------------------------------------------------

function checkQ312(
  sentence: string,
  sentenceOffset: number,
  paragraphText: string,
  baseLine: number,
  baseCol: number,
  entry: Entry,
): LintDiagnostic | undefined {
  // Only normative sentences.
  if (countModals(sentence) === 0) return undefined;
  // If any tolerance marker appears in the sentence, all quantities are
  // considered covered. This is intentionally conservative — a sentence
  // with one tolerance marker and one bare quantity still passes because
  // the marker signals the author is aware of tolerances.
  if (TOLERANCE_MARKER_RE.test(sentence)) return undefined;
  // Check for at least one bare quantity with a unit.
  QUANTITY_WITH_UNIT_RE.lastIndex = 0;
  if (QUANTITY_WITH_UNIT_RE.exec(sentence) !== null) {
    return emit(
      "MSL-Q312",
      "incose-r33-range-of-values",
      "info",
      1,
      `incose-r33-range-of-values: numeric quantity appears without a tolerance or range; add ±, between…and, ≤/≥, or a tolerance clause`,
      sentence,
      sentenceOffset,
      paragraphText,
      baseLine,
      baseCol,
      entry,
    );
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Q402 — struct-multiple-shall (entry-level)
// ---------------------------------------------------------------------------

/**
 * Entry-level check: fire when the whole body contains ≥2 modal
 * occurrences but no single sentence contains ≥2 (which would be Q200
 * territory). The two checks are performed over `entry.bodyAst` so that
 * paragraph-boundary-spanning counts are correct.
 */
function checkQ402(
  entry: Entry,
  totalBodyModals: number,
  anysentenceHasTwoModals: boolean,
): LintDiagnostic | undefined {
  if (totalBodyModals < 2) return undefined;
  // Defer to Q200 when any single sentence already concentrates ≥2 modals.
  if (anysentenceHasTwoModals) return undefined;
  return emitEntryLevel(
    "MSL-Q402",
    "struct-multiple-shall",
    "warning",
    3,
    `struct-multiple-shall: body contains ${totalBodyModals} normative modal verbs across separate sentences; consider splitting into ${totalBodyModals} single-obligation requirements`,
    entry,
  );
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run INCOSE sentence rules (Q306–Q312) and entry-level Q402.
 *
 * For each paragraph, segments into sentences. For each normative sentence:
 *   - Q306 fires on exactly 2 EARS condition keywords (separate-clauses).
 *   - Q307 fires when `and` joins ≥2 modal verbs (single-thought).
 *   - Q308 fires on discourse combinators (however/whereas/meanwhile/but/unless).
 *   - Q309 fires on personal/indefinite pronouns without explicit antecedent.
 *   - Q311 fires on vague applicability phrases when no EARS leading clause.
 *   - Q312 fires on bare numeric quantities without a tolerance marker.
 *
 * Entry-level Q402 fires when the whole body has ≥2 modals but no single
 * sentence concentrated them (which would be Q200 territory).
 */
export function runIncoseSentenceRules(entry: Entry): LintDiagnostic[] {
  const out: LintDiagnostic[] = [];
  const blocks: readonly BodyBlock[] = entry.bodyAst ?? [];

  // Q402 tracking across the whole entry body.
  let totalBodyModals = 0;
  let anysentenceHasTwoModals = false;

  for (const block of blocks) {
    if (block.kind !== "paragraph") continue;
    const p = block as ParagraphNode;
    const text = p.content.text;

    // Compute file-absolute base line for this paragraph.
    // p.range.start.line is body-relative (line 1 = first body line).
    // entry.bodyStartLine is file-absolute. Fall back to entry.location.line + 1.
    const absBodyStart = entry.bodyStartLine ?? (entry.location.line + 1);
    const absLine = absBodyStart + p.range.start.line - 1;
    const baseCol = p.range.start.column;

    const sentences = segmentSentences(text, ABBREVS);
    for (const sentence of sentences) {
      const s = sentence.text;
      const off = sentence.offset;

      const modalsInSentence = countModals(s);
      totalBodyModals += modalsInSentence;
      if (modalsInSentence >= 2) anysentenceHasTwoModals = true;

      const q306 = checkQ306(s, off, text, absLine, baseCol, entry);
      if (q306) out.push(q306);

      const q307 = checkQ307(s, off, text, absLine, baseCol, entry);
      if (q307) out.push(q307);

      const q308 = checkQ308(s, off, text, absLine, baseCol, entry);
      if (q308) out.push(q308);

      const q309 = checkQ309(s, off, text, absLine, baseCol, entry);
      if (q309) out.push(q309);

      const q311 = checkQ311(s, off, text, absLine, baseCol, entry);
      if (q311) out.push(q311);

      const q312 = checkQ312(s, off, text, absLine, baseCol, entry);
      if (q312) out.push(q312);
    }
  }

  // Entry-level Q402.
  const q402 = checkQ402(entry, totalBodyModals, anysentenceHasTwoModals);
  if (q402) out.push(q402);

  return out;
}
