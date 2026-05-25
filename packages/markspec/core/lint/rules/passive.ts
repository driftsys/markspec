/**
 * @module core/lint/rules/passive
 *
 * Passive-voice and subject-verb rules for PA-3 (slice 10):
 *
 *   MSL-Q300  incose-r2-active-voice  (warn, score 3)
 *   MSL-Q301  incose-r3-subject-verb  (info, score 1)
 *
 * Q300 — passive voice construction in a normative sentence.
 *
 *   Detection heuristic: be-verb immediately before a past-participial
 *   form in the same sentence AND the sentence contains a normative modal.
 *
 *   Two surface forms are detected:
 *     (a) Modal + "be" + past-participial word:
 *         "shall be applied", "should be processed", "must be done"
 *     (b) Copular be-verb (is/are/was/were) + past-participial word in a
 *         normative sentence:
 *         "Pressure is applied within 200 ms." with a modal elsewhere in
 *         the sentence.
 *
 *   Past-participial heuristic: word ending in `-ed` (regular) OR a
 *   known irregular list. Words ending in `-ed` that are NOT passive
 *   participials (e.g. "needed", "provided") are intentionally included
 *   — false-positive risk is acknowledged and the `warn` severity is
 *   calibrated for it. Adjectives like "ready", "busy", "free" do NOT
 *   end in `-ed` and are therefore NOT flagged. "shall be ready" does
 *   NOT trigger Q300 — the heuristic correctly skips it because "ready"
 *   is not past-participial shaped.
 *
 *   Known limit: "shall be based on" is a borderline case — "based" is
 *   past-participial, so Q300 fires. Authors should rewrite as "shall
 *   derive from" or suppress with Markspec-disable + Rationale.
 *
 * Q301 — subject/verb appropriateness heuristic.
 *
 *   Two narrow sub-patterns:
 *     (a) Pronoun subject: sentence starts with It/This/That + modal.
 *         "It shall be possible to …" is a common non-actor construction.
 *     (b) Existential-there construction: sentence starts with
 *         "There shall/should/must …".
 *
 *   Both patterns indicate the sentence lacks a clear actor and are
 *   captured by the incose-r3 guidance. Q309 (pronouns) may co-fire
 *   with (a) — both are valid; they fire for different reasons.
 *
 * All rules operate on paragraph-kind body blocks only.
 */

import type { Entry } from "../../model/mod.ts";
import type { BodyBlock, ParagraphNode } from "../../ast/nodes.ts";
import type { LintDiagnostic } from "../types.ts";
import { segmentSentences } from "../segmenter.ts";
import { loadLexicon } from "../../lexicons/mod.ts";
import { offsetToRange } from "../range_util.ts";
import { MODAL_COMPOUND_RE } from "./modal_sentence.ts";

const ABBREVS = loadLexicon("sentence-abbrev");

// ---------------------------------------------------------------------------
// Regexes
// ---------------------------------------------------------------------------

/**
 * Be-verb set used in passive detection. Covers all finite and non-finite
 * forms of "be". Compound negations with `not` are included so "shall not
 * be applied" is also caught.
 */
// Bare be-verb forms only. Listing `is not`/`are not`/etc. as additional
// alternatives would be dead code — left-to-right alternation would match
// the bare form first. Accepted limitation: `"is not applied"` is NOT
// detected as passive (the post-be-verb scan in `detectPassive` finds
// `not` and stops). Negated passive through a modal (`"shall not be
// applied"`) IS detected because the be-verb matched is `be`, not `is`.
const BE_VERB_RE = /\b(is|are|was|were|be|been|being)\b/i;

/**
 * Known irregular past participials. These words do not end in `-ed`
 * but are unambiguously past participials in a passive construction
 * (e.g. "shall be done", "shall be made", "shall be seen").
 *
 * Kept deliberately narrow. Words like "known" and "given" are omitted
 * because they function as adjectives most of the time in requirements
 * prose ("a given condition", "a known limit").
 */
const IRREGULAR_PARTICIPIALS: ReadonlySet<string> = new Set([
  "done",
  "made",
  "seen",
  "held",
  "built",
  "sent",
  "set",
  "put",
  "run",
  "cut",
  "read",
  "fed",
  "led",
  "met",
  "kept",
  "left",
  "lost",
  "shown",
  "found",
  "bound",
  "born",
  "brought",
  "bought",
  "caught",
  "drawn",
  "driven",
  "eaten",
  "fallen",
  "flown",
  "forgotten",
  "frozen",
  "gotten",
  // 'given' deliberately omitted — adjective-ambiguous ("a given condition").
  "grown",
  "hidden",
  "hit",
  "hung",
  // 'known' deliberately omitted — adjective-ambiguous ("a known limit").
  "laid",
  "lain",
  "paid",
  "proven",
  "ridden",
  "risen",
  "said",
  "spoken",
  "stolen",
  "taken",
  "thrown",
  "told",
  "understood",
  "woken",
  "worn",
  "written",
]);

/**
 * Returns true when `word` looks like a past participial:
 *   - ends in `-ed` (regular), OR
 *   - is in the irregular list.
 */
function isPastParticipial(word: string): boolean {
  const lower = word.toLowerCase();
  if (lower.endsWith("ed")) return true;
  return IRREGULAR_PARTICIPIALS.has(lower);
}

/**
 * Detect a passive construction in a sentence.
 *
 * Strategy: scan for a be-verb. If found, look at the next non-whitespace
 * word after it. If that word is past-participial shaped, it is a passive
 * construction.
 *
 * First-match scan — only the first be-verb in the sentence is inspected.
 * A sentence with `is critical and shall be applied` is detected via the
 * `be applied` pair (the first be-verb `is` would be followed by `critical`
 * which isn't past-participial; the regex finds the first be-verb only, so
 * this sentence WON'T detect — accepted limitation, narrow heuristic).
 *
 * Handles:
 *   - "shall be applied" — modal before be-verb (be + applied)
 *   - "is required" — copular be + required
 *   - "shall be fully processed" — adverb between be and participial
 *     (NOT detected by this heuristic — the "next word" check would
 *     see "fully" and stop. Accepted limitation.)
 */
function detectPassive(sentence: string): boolean {
  // Reset before each use — BE_VERB_RE has no `g` flag, but for safety
  // we use a fresh exec each call.
  const beMatch = BE_VERB_RE.exec(sentence);
  if (!beMatch) return false;
  // Look at the word immediately after the be-verb match.
  const afterBe = sentence.slice(beMatch.index + beMatch[0].length);
  // Skip leading whitespace.
  const trimmed = afterBe.trimStart();
  if (trimmed.length === 0) return false;
  // Extract the first word.
  const wordMatch = /^([a-zA-Z]+)/.exec(trimmed);
  if (!wordMatch) return false;
  return isPastParticipial(wordMatch[1]);
}

/**
 * Q301 pronoun-subject heuristic: sentence starts with It/This/That
 * (case-insensitive after initial capital) followed by whitespace and a
 * modal verb somewhere in the sentence.
 */
const PRONOUN_SUBJECT_RE = /^(it|this|that|there)\s/i;

/**
 * Detect a pronoun or existential-there sentence subject.
 * Fires when the sentence starts with It/This/That/There and the
 * sentence is normative (already checked before calling).
 */
function detectPronounSubject(sentence: string): boolean {
  return PRONOUN_SUBJECT_RE.test(sentence.trim());
}

// ---------------------------------------------------------------------------
// Rule code registry
// ---------------------------------------------------------------------------

/** All passive-voice rule codes exported for the suppression-hygiene set. */
export const PASSIVE_RULE_CODES: ReadonlySet<string> = new Set([
  "MSL-Q300",
  "MSL-Q301",
]);

// ---------------------------------------------------------------------------
// Emit helpers
// ---------------------------------------------------------------------------

function emitQ300(
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
    code: "MSL-Q300",
    slug: "incose-r2-active-voice",
    severity: "warning",
    scoreContribution: 3,
    group: "incose",
    message:
      `incose-r2-active-voice: passive construction detected in normative sentence; rewrite in active voice`,
    location: entry.location,
    range,
  };
}

function emitQ301(
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
    code: "MSL-Q301",
    slug: "incose-r3-subject-verb",
    severity: "info",
    scoreContribution: 1,
    group: "incose",
    message:
      `incose-r3-subject-verb: sentence subject is a pronoun or existential 'there'; replace with the explicit actor`,
    location: entry.location,
    range,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run passive-voice rules (Q300–Q301) on an entry's paragraph bodies.
 *
 * For each paragraph, segments into sentences. For each normative sentence
 * (one containing a modal verb):
 *   - Q300 fires when a passive construction is detected (be-verb +
 *     past-participial word).
 *   - Q301 fires when the sentence subject is a pronoun (It/This/That)
 *     or existential-there construction.
 */
export function runPassiveRules(entry: Entry): LintDiagnostic[] {
  const out: LintDiagnostic[] = [];
  const blocks: readonly BodyBlock[] = entry.bodyAst ?? [];

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

      // Only normative sentences (containing a modal verb).
      MODAL_COMPOUND_RE.lastIndex = 0;
      const isNormative = MODAL_COMPOUND_RE.test(s);
      MODAL_COMPOUND_RE.lastIndex = 0;
      if (!isNormative) continue;

      // Q300: passive voice detection (be-verb + past participial).
      if (detectPassive(s)) {
        out.push(emitQ300(s, off, text, absLine, baseCol, entry));
      }

      // Q301: pronoun or existential-there subject.
      if (detectPronounSubject(s)) {
        out.push(emitQ301(s, off, text, absLine, baseCol, entry));
      }
    }
  }

  return out;
}
