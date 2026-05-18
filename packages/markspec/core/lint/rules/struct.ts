/**
 * @module core/lint/rules/struct
 *
 * Two structural prose-quality rules for PA-1:
 *   MSL-Q400  struct-title-length   (info, score 1)
 *   MSL-Q401  struct-body-length    (info, score 1)
 *
 * Thresholds are hard-coded defaults; profile-level configuration
 * (prose.struct.title.minLength / maxLength, etc.) is wired in PA-2.
 */

import type { Entry, SourceLocation } from "../../model/mod.ts";
import type { LintDiagnostic } from "../types.ts";

// TODO(PA-2): wire these from prose.struct profile config
const TITLE_MIN_LENGTH = 3;
const TITLE_MAX_LENGTH = 120;
const BODY_MIN_WORDS = 5;
const BODY_MAX_WORDS = 500;

/** Run MSL-Q400 and MSL-Q401 on an entry. */
export function runStructRules(entry: Entry): LintDiagnostic[] {
  const out: LintDiagnostic[] = [];
  const location: SourceLocation = entry.location;

  // MSL-Q400: title length
  const titleLen = entry.title.length;
  if (titleLen < TITLE_MIN_LENGTH || titleLen > TITLE_MAX_LENGTH) {
    const dir = titleLen < TITLE_MIN_LENGTH ? "too short" : "too long";
    out.push({
      code: "MSL-Q400",
      slug: "struct-title-length",
      severity: "info",
      scoreContribution: 1,
      group: "struct",
      message:
        `struct-title-length: title is ${dir} (${titleLen} chars; expected ${TITLE_MIN_LENGTH}–${TITLE_MAX_LENGTH})`,
      location,
    });
  }

  // MSL-Q401: body word count — split entry.body on whitespace
  const words = entry.body.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  if (wordCount < BODY_MIN_WORDS || wordCount > BODY_MAX_WORDS) {
    const dir = wordCount < BODY_MIN_WORDS ? "too short" : "too long";
    out.push({
      code: "MSL-Q401",
      slug: "struct-body-length",
      severity: "info",
      scoreContribution: 1,
      group: "struct",
      message:
        `struct-body-length: body is ${dir} (${wordCount} words; expected ${BODY_MIN_WORDS}–${BODY_MAX_WORDS})`,
      location,
    });
  }

  return out;
}

/** Exported rule codes for suppression validation. */
export const STRUCT_RULE_CODES: ReadonlySet<string> = new Set([
  "MSL-Q400",
  "MSL-Q401",
]);
