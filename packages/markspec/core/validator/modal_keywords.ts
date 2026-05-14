/**
 * @module core/validator/modal_keywords
 *
 * MSL-M060 — uppercase modal keyword (`SHALL`, `SHOULD`, `MAY`, `MUST`,
 * optionally `… NOT`) in entry-body prose. The formatter normalises
 * these to lowercase per spec §3.4.1; the validator flags them so a
 * lint-only flow (no `fmt` run) surfaces the deviation from canonical
 * form. Profiles may promote the severity.
 *
 * Fence-aware: matches inside fenced code blocks are intentionally
 * skipped (code samples and verbatim quotes from RFC 2119 itself stay
 * uppercase). Attribute trailers (4-space-indented blocks) sit below
 * the body and never appear in the body string the parser hands us, so
 * no additional skipping is needed for them.
 */

import type { Diagnostic, Entry } from "../model/mod.ts";
import { walkProseLines } from "../util/fence.ts";

/**
 * RFC 2119 modal keywords in uppercase form, with optional ` NOT`.
 * Matched as whole words (`\b...\b`) so `SHALLOW` is not flagged.
 */
const UPPERCASE_MODAL_RE = /\b(SHALL|SHOULD|MAY|MUST)(\s+NOT)?\b/g;

/**
 * Scan an entry's body for uppercase modal keywords and emit MSL-M060
 * for each occurrence. Severity is `warning`; the formatter rewrites
 * them on the next run.
 */
export function validateModalKeywords(entry: Entry): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  walkProseLines(entry.body, (line, lineOffset) => {
    UPPERCASE_MODAL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = UPPERCASE_MODAL_RE.exec(line)) !== null) {
      const keyword = match[0];
      diagnostics.push({
        code: "MSL-M060",
        severity: "warning",
        message: `${entry.displayId}: modal keyword '${keyword}' in body ` +
          `prose is uppercase (spec §3.4.1 canonical form is lowercase; ` +
          `'markspec format' will rewrite it)`,
        location: {
          file: entry.location.file,
          line: entry.location.line + lineOffset,
          column: match.index + 1,
        },
      });
    }
  });
  return diagnostics;
}
