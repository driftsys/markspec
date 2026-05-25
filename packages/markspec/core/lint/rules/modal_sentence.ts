/**
 * @module core/lint/rules/modal_sentence
 *
 * Modal sentence rules for PA-3:
 *
 *   MSL-Q200  modal-multiple           (warn, score 3)
 *   MSL-Q201  modal-soft-in-normative  (info, score 1)
 *
 * Q200: ≥2 normative modals in one sentence — a compound requirement.
 * Q201: `should`/`may` (with or without `not`) in a Requirement-rooted entry.
 *
 * Q202 (modal-prohibited) is NOT in scope for this slice — deferred per
 * ADR-021 Decision 6 (needs profile config plumbing not yet in core).
 *
 * Both rules operate on paragraph-kind body blocks only. Gherkin DocStrings
 * live in `feature` blocks (not paragraph-kind) and are excluded by design.
 */

import type { Entry } from "../../model/mod.ts";
import type { BodyBlock, ParagraphNode } from "../../ast/nodes.ts";
import type { LintDiagnostic } from "../types.ts";
import { segmentSentences } from "../segmenter.ts";
import { loadLexicon } from "../../lexicons/mod.ts";
import { offsetToRange } from "../range_util.ts";
import { resolvedCoreType } from "../../validator/type_resolution.ts";

const ABBREVS = loadLexicon("sentence-abbrev");

// ---------------------------------------------------------------------------
// Regexes
// ---------------------------------------------------------------------------

/**
 * RFC 2119 modal verbs — compound negations FIRST so `shall not` is
 * captured as a single token rather than `shall` + `not`. The `gi`
 * flags enable case-insensitive matching and allow `exec`-loop reuse
 * after resetting `lastIndex`.
 *
 * `will` is intentionally excluded — it is not a normative modal per
 * RFC 2119 and its presence is handled by the Q202 rule (deferred).
 */
export const MODAL_COMPOUND_RE =
  /\b(shall not|should not|must not|may not|shall|should|must|may)\b/gi;

/**
 * Soft modal check — `should`/`may` with or without `not`. Used by
 * Q201 to detect hedge modals in Requirement-typed entries. Stateless
 * (no `g` flag); reset not required.
 */
const SOFT_MODAL_RE = /\b(should not|may not|should|may)\b/i;

// ---------------------------------------------------------------------------
// Rule code registry
// ---------------------------------------------------------------------------

/** All modal-sentence rule codes exported for the suppression-hygiene set. */
export const MODAL_SENTENCE_RULE_CODES: ReadonlySet<string> = new Set([
  "MSL-Q200",
  "MSL-Q201",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count the number of modal occurrences in `text`.
 *
 * Compound negations (`shall not`, `should not`, `must not`, `may not`) each
 * count as ONE modal, not two — they are single rhetorical tokens. The regex
 * places compound forms before bare forms so greedy matching handles the
 * `not` suffix as part of the token.
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

function emitQ200(
  sentence: string,
  sentenceOffset: number,
  paragraphText: string,
  baseLine: number,
  baseCol: number,
  entry: Entry,
  modalCount: number,
): LintDiagnostic {
  const range = offsetToRange(
    paragraphText,
    sentenceOffset,
    sentence.length,
    baseLine,
    baseCol,
  );
  return {
    code: "MSL-Q200",
    slug: "modal-multiple",
    severity: "warning",
    scoreContribution: 3,
    group: "modal",
    message:
      `modal-multiple: ${modalCount} modal verbs in one sentence; split into separate single-obligation requirements`,
    location: entry.location,
    range,
  };
}

function emitQ201(
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
    code: "MSL-Q201",
    slug: "modal-soft-in-normative",
    severity: "info",
    scoreContribution: 1,
    group: "modal",
    message:
      `modal-soft-in-normative: 'should'/'may' in a Requirement entry is a hedge, not an obligation; use 'shall' or 'must' instead`,
    location: entry.location,
    range,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run modal sentence rules (Q200–Q201) on an entry's paragraph bodies.
 *
 * For each paragraph, segments into sentences. For each sentence:
 *   - Q200 fires when ≥2 modal verbs appear in the same sentence
 *     (compound requirement).
 *   - Q201 fires when a soft modal (`should`/`may`) appears in a sentence
 *     of a Requirement-typed entry.
 *
 * One Q200 diagnostic is emitted per offending sentence regardless of how
 * many modals (≥2) the sentence contains. Q201 similarly emits once per
 * offending sentence.
 */
export function runModalSentenceRules(entry: Entry): LintDiagnostic[] {
  const out: LintDiagnostic[] = [];
  const blocks: readonly BodyBlock[] = entry.bodyAst ?? [];

  // Q201 only fires for Requirement-rooted entries. Conservatively skip when
  // the core type is unresolved (profile-less project or unknown display-ID).
  const isRequirement = resolvedCoreType(entry) === "Requirement";

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

      // Q200: ≥2 modals in a single sentence.
      const modalCount = countModals(s);
      if (modalCount >= 2) {
        out.push(emitQ200(s, off, text, absLine, baseCol, entry, modalCount));
      }

      // Q201: soft modal in a Requirement-typed entry.
      if (isRequirement && SOFT_MODAL_RE.test(s)) {
        out.push(emitQ201(s, off, text, absLine, baseCol, entry));
      }
    }
  }

  return out;
}
