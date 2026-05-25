/**
 * @module core/lint/rules/ears
 *
 * EARS (Easy Approach to Requirements Syntax) pattern rules for PA-3.
 * Five rules targeting normative sentences that violate or misapply the
 * six canonical EARS patterns (Mavin 2009):
 *
 *   Ubiquitous      — `The <system> shall <response>`
 *   State-driven    — `While <precondition>, the <system> shall <response>`
 *   Event-driven    — `When <trigger>, the <system> shall <response>`
 *   Optional-feat.  — `Where <feature>, the <system> shall <response>`
 *   Unwanted-behav. — `If <trigger>, then the <system> shall <response>`
 *   Complex         — `While <precondition>, when <trigger>, the <system> shall <response>`
 *
 * Rules:
 *   MSL-Q100  ears-no-pattern             (info,  score 1)
 *   MSL-Q101  ears-missing-actor          (warn,  score 3)
 *   MSL-Q102  ears-negative-response      (info,  score 1)
 *   MSL-Q103  ears-stacked-preconditions  (warn,  score 3)
 *   MSL-Q104  ears-malformed-attempt      (info,  score 1)
 *
 * All rules are heuristic and intentionally fire narrow rather than broad.
 * Q100 and Q101 are the most likely to have false-positive risk; their
 * detection conditions are tighter than the full grammar.
 */

import type { Entry } from "../../model/mod.ts";
import type { ParagraphNode } from "../../ast/nodes.ts";
import type { BodyBlock } from "../../ast/nodes.ts";
import type { LintDiagnostic } from "../types.ts";
import { segmentSentences } from "../segmenter.ts";
import { loadLexicon } from "../../lexicons/mod.ts";
import { offsetToRange } from "../range_util.ts";

const ABBREVS = loadLexicon("sentence-abbrev");

// ---------------------------------------------------------------------------
// Regexes — all case-insensitive unless noted
// ---------------------------------------------------------------------------

/** RFC 2119 modal verbs — bare forms and compound "shall not" etc. */
const MODAL_RE =
  /\b(shall not|should not|must not|shall|should|may|must|will)\b/i;

/** RFC 2119 negative compound modals (Q102). */
const NEGATIVE_MODAL_RE = /\b(shall not|should not|must not|may not)\b/i;

/** EARS leading-clause keywords — capital-initial only (sentence-initial). */
const EARS_LEADING_RE = /^(While|When|Where|If)\b/i;

/**
 * EARS precondition-style keywords counting stacked clauses (Q103).
 * Counts `While`, `When`, and `If` occurrences (not `Where` — it marks
 * optional features, not preconditions). Case-insensitive, whole word.
 */
const EARS_PRECONDITION_RE = /\b(While|When|If)\b/gi;

/**
 * Actor detection: `the <noun phrase>` immediately before the modal.
 *
 * An actor is considered PRESENT when the noun phrase has either:
 *   (a) at least one Capitalized (PascalCase) word, OR
 *   (b) two or more lowercase words (a compound noun phrase like
 *       "the brake controller" or "the pedal unit").
 *
 * An actor is considered ABSENT (Q101 fires) when the noun phrase is
 * a single bare lowercase word ("the brake shall", "the system shall").
 *
 * This heuristic deliberately passes "the brake controller shall"
 * (compound noun = named subsystem) and fires on "the brake shall"
 * (single generic noun = too vague). It is intentionally narrow to
 * keep false-positive risk low.
 *
 * `ACTOR_SINGLE_LOWERCASE_RE` matches the problematic form:
 * `the <single-lowercase-word> <modal>`. After matching, the captured
 * noun is checked against {@linkcode GENERIC_ACTOR_ALLOWLIST}; nouns in
 * the allowlist are accepted as valid (if imprecise) actors.
 */
const ACTOR_SINGLE_LOWERCASE_RE =
  /\b[Tt]he\s+([a-z][a-z0-9]*)\s+(?:shall not|should not|must not|shall|should|may|must|will)\b/;

/**
 * Single-word lowercase nouns that are conventionally accepted as generic
 * system-level actor names in requirements prose. "The system shall…" and
 * "The controller shall…" are ubiquitous in requirements engineering and
 * are treated as valid actors even though they are technically vague.
 *
 * Q101 fires when the noun is NOT in this list — e.g. "the brake shall"
 * (component reference without qualification) triggers the warning.
 *
 * Profile-extensible in a future iteration; for now the list is narrow.
 */
const GENERIC_ACTOR_ALLOWLIST: ReadonlySet<string> = new Set([
  "system",
  "controller",
  "module",
  "unit",
  "device",
  "software",
  "firmware",
  "application",
  "processor",
  "subsystem",
  "component",
  "platform",
  "service",
  "driver",
  "manager",
]);

// ---------------------------------------------------------------------------
// Pattern matchers
// ---------------------------------------------------------------------------

/**
 * Returns true when the sentence text contains at least one RFC 2119 modal
 * verb. This is the normative-sentence gate: only normative sentences receive
 * Q100–Q103 analysis.
 */
function isNormative(sentence: string): boolean {
  return MODAL_RE.test(sentence);
}

/**
 * Returns true when the sentence matches one of the six EARS patterns.
 *
 * Detection heuristics (intentionally narrow to keep false-positive risk low):
 *
 * - State-driven:      starts with `While`  + contains modal
 * - Event-driven:      starts with `When`   + contains modal
 * - Optional-feature:  starts with `Where`  + contains modal
 * - Unwanted-behav.:   starts with `If`     + contains `, then` + modal
 * - Complex:           starts with `While`  + contains `when` (mid-sentence) + modal
 * - Ubiquitous:        does NOT start with EARS keyword + starts with `The` + modal
 *
 * Note: Ubiquitous requires an explicit `The` to reduce false-positives
 * from non-EARS prose that happens to contain a modal.
 */
function matchesEarsPattern(sentence: string): boolean {
  if (!isNormative(sentence)) return false;

  const trimmed = sentence.trim();

  // Leading EARS keyword → one of the event/state/optional/unwanted/complex patterns.
  if (EARS_LEADING_RE.test(trimmed)) {
    // Unwanted-behaviour requires `, then` somewhere before the modal.
    if (/^If\b/i.test(trimmed)) {
      return /,\s*then\b/i.test(trimmed);
    }
    // State-driven, Event-driven, Optional-feature, Complex all pass when the
    // leading keyword is present and a modal follows.
    return true;
  }

  // Ubiquitous: no EARS leading keyword, starts with `The <noun>`, has modal.
  if (/^The\s+/i.test(trimmed)) {
    return MODAL_RE.test(trimmed);
  }

  return false;
}

/**
 * Returns false (actor is MISSING) when the sentence's modal is
 * preceded by a single bare lowercase noun that is not a generic
 * system-level term (e.g. "the brake shall"). Returns true (actor
 * PRESENT) for:
 *   - compound noun phrases ("the brake controller shall"),
 *   - Capitalized/PascalCase nouns ("the BrakeController shall"), or
 *   - generic system nouns in {@linkcode GENERIC_ACTOR_ALLOWLIST}
 *     ("the system shall", "the controller shall").
 *
 * Q101 fires when this returns false.
 */
function hasActor(sentence: string): boolean {
  const m = ACTOR_SINGLE_LOWERCASE_RE.exec(sentence);
  if (!m) return true; // compound or Capitalized → actor present
  const noun = m[1].toLowerCase();
  return GENERIC_ACTOR_ALLOWLIST.has(noun);
}

/**
 * Count the number of EARS precondition keywords (While/When/If) in the
 * sentence. Used by Q103 to detect stacked preconditions.
 */
function countPreconditions(sentence: string): number {
  EARS_PRECONDITION_RE.lastIndex = 0;
  let count = 0;
  while (EARS_PRECONDITION_RE.exec(sentence) !== null) count++;
  return count;
}

// ---------------------------------------------------------------------------
// Rule implementations
// ---------------------------------------------------------------------------

function emitQ100(
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
    code: "MSL-Q100",
    slug: "ears-no-pattern",
    severity: "info",
    scoreContribution: 1,
    group: "ears",
    message:
      `ears-no-pattern: normative sentence does not conform to any EARS pattern (Ubiquitous, State-driven, Event-driven, Optional-feature, Unwanted-behaviour, Complex)`,
    location: entry.location,
    range,
  };
}

function emitQ101(
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
    code: "MSL-Q101",
    slug: "ears-missing-actor",
    severity: "warning",
    scoreContribution: 3,
    group: "ears",
    message:
      `ears-missing-actor: EARS sentence has no explicit actor ('the <System>') before the modal verb`,
    location: entry.location,
    range,
  };
}

function emitQ102(
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
    code: "MSL-Q102",
    slug: "ears-negative-response",
    severity: "info",
    scoreContribution: 1,
    group: "ears",
    message:
      `ears-negative-response: response clause is bare negation ('shall not …'); prefer a positive form where possible`,
    location: entry.location,
    range,
  };
}

function emitQ103(
  sentence: string,
  sentenceOffset: number,
  paragraphText: string,
  baseLine: number,
  baseCol: number,
  entry: Entry,
  count: number,
): LintDiagnostic {
  const range = offsetToRange(
    paragraphText,
    sentenceOffset,
    sentence.length,
    baseLine,
    baseCol,
  );
  return {
    code: "MSL-Q103",
    slug: "ears-stacked-preconditions",
    severity: "warning",
    scoreContribution: 3,
    group: "ears",
    message:
      `ears-stacked-preconditions: ${count} stacked preconditions (While/When/If) in one sentence; split or restructure as canonical Complex pattern`,
    location: entry.location,
    range,
  };
}

function emitQ104(
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
    code: "MSL-Q104",
    slug: "ears-malformed-attempt",
    severity: "info",
    scoreContribution: 1,
    group: "ears",
    message:
      `ears-malformed-attempt: sentence opens with EARS keyword (When/While/Where/If) but has no modal+response clause`,
    location: entry.location,
    range,
  };
}

// ---------------------------------------------------------------------------
// Rule code registry (for suppression hygiene)
// ---------------------------------------------------------------------------

/** All EARS rule codes exported for the suppression-hygiene known-code set. */
export const EARS_RULE_CODES: ReadonlySet<string> = new Set([
  "MSL-Q100",
  "MSL-Q101",
  "MSL-Q102",
  "MSL-Q103",
  "MSL-Q104",
]);

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run EARS rules (Q100–Q104) on an entry's paragraph bodies.
 *
 * For each paragraph, segments into sentences. For each sentence:
 *   - Q104 fires on ANY sentence that opens with an EARS keyword but lacks
 *     a modal anywhere (catches malformed attempts even in non-normative prose).
 *   - Q100–Q103 fire ONLY on normative sentences (those containing a modal).
 */
export function runEarsRules(entry: Entry): LintDiagnostic[] {
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

      // Q104: fires on non-normative malformed EARS attempts too.
      // Sentence opens with an EARS keyword but has NO modal anywhere.
      if (EARS_LEADING_RE.test(s.trim()) && !MODAL_RE.test(s)) {
        out.push(emitQ104(s, off, text, absLine, baseCol, entry));
        continue; // malformed → skip other EARS rules for this sentence
      }

      // Remaining rules only fire on normative sentences.
      if (!isNormative(s)) continue;

      // Q103: ≥3 stacked preconditions (fires before Q100 to avoid double-flagging).
      const precondCount = countPreconditions(s);
      if (precondCount >= 3) {
        out.push(emitQ103(s, off, text, absLine, baseCol, entry, precondCount));
        // Don't also fire Q100 on the same sentence — the sentence IS EARS-shaped,
        // just over-complex. Q103 is the actionable diagnostic.
        // Still check Q101 and Q102.
      } else if (!matchesEarsPattern(s)) {
        // Q100: normative sentence matches no EARS pattern.
        out.push(emitQ100(s, off, text, absLine, baseCol, entry));
        // Q101 is inapplicable when no pattern matches — Q100 already flags it.
        // Q102 still applies (a "shall not" in a non-pattern sentence is still
        // a negation concern).
      }

      // Q101: EARS pattern detected but no explicit actor.
      // Only fire when the sentence DOES match an EARS pattern (no Q100).
      if (precondCount < 3 && matchesEarsPattern(s) && !hasActor(s)) {
        out.push(emitQ101(s, off, text, absLine, baseCol, entry));
      }

      // Q102: bare negation in response clause.
      if (NEGATIVE_MODAL_RE.test(s)) {
        out.push(emitQ102(s, off, text, absLine, baseCol, entry));
      }
    }
  }
  return out;
}
