/**
 * @module core/validator/body_blocks
 *
 * Body-block exclusion validator (spec §2.4.1). Detects constructs
 * forbidden inside entry bodies:
 *
 *   - MSL-B040 — headings
 *   - MSL-B041 — horizontal rules
 *   - MSL-B042 — task lists
 *   - MSL-B043 — raw HTML other than `<!-- markspec:* -->` directive
 *     comments
 *
 * The check walks each entry's `body` string line by line and skips
 * lines inside fenced code blocks (verbatim content is exempt).
 */

import type { Diagnostic, Entry } from "../model/mod.ts";

const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^\s*#{1,6}\s/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TASK_LIST_RE = /^\s*[-*+]\s+\[[ xX]\]/;

/**
 * HTML tag detection. Matches an opening, closing, or self-closing tag
 * (`<tag>`, `</tag>`, `<tag/>`). Doesn't match HTML comments — those
 * are handled by {@linkcode HTML_COMMENT_RE} below so we can allow
 * markspec directive comments while still flagging arbitrary HTML
 * comments (which spec §2.4.1 forbids).
 */
const HTML_TAG_RE = /<\/?[A-Za-z][A-Za-z0-9]*(\s[^>]*)?\/?>/;

/** Any HTML comment, `<!--…-->`. */
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/;

/**
 * A whole-line markspec directive comment: `<!-- markspec:<rest> -->`
 * occupying the line on its own (optional leading/trailing
 * whitespace). The directive form is the one exception spec §2.4.1
 * carves out from the "no raw HTML" rule.
 */
const MARKSPEC_DIRECTIVE_LINE_RE = /^\s*<!--\s*markspec:[\s\S]*?-->\s*$/;

/**
 * Return `true` when `line` contains raw HTML the body model forbids:
 * any tag, or any comment that isn't a standalone markspec directive.
 */
function hasForbiddenHtml(line: string): boolean {
  if (HTML_TAG_RE.test(line)) return true;
  if (HTML_COMMENT_RE.test(line) && !MARKSPEC_DIRECTIVE_LINE_RE.test(line)) {
    return true;
  }
  return false;
}

interface BodyDiag {
  readonly code: string;
  readonly severity: "error" | "warning" | "info";
  readonly summary: string;
}

const HEADING_DIAG: BodyDiag = {
  code: "MSL-B040",
  severity: "error",
  summary: "heading inside entry body — entries are flat (spec §2.4.1)",
};
const HR_DIAG: BodyDiag = {
  code: "MSL-B041",
  severity: "error",
  summary:
    "horizontal rule inside entry body — entry boundaries already separate content (spec §2.4.1)",
};
const TASK_LIST_DIAG: BodyDiag = {
  code: "MSL-B042",
  severity: "error",
  summary:
    "task list inside entry body — semantics conflict with traceability state (spec §2.4.1)",
};
const RAW_HTML_DIAG: BodyDiag = {
  code: "MSL-B043",
  severity: "error",
  summary:
    "raw HTML inside entry body — only `<!-- markspec:* -->` directive comments are permitted (spec §2.4.1)",
};

/**
 * Validate that an entry's body contains none of the excluded body
 * constructs. Emits at most one diagnostic per excluded construct per
 * line (so a paragraph with `<div>foo</div><span>bar</span>` still
 * fires MSL-B043 once for that line).
 */
export function validateBodyBlocks(entry: Entry): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = entry.body.split("\n");
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.trim() === "") continue;

    let diag: BodyDiag | undefined;
    if (HEADING_RE.test(line)) diag = HEADING_DIAG;
    else if (HR_RE.test(line)) diag = HR_DIAG;
    else if (TASK_LIST_RE.test(line)) diag = TASK_LIST_DIAG;
    else if (hasForbiddenHtml(line)) diag = RAW_HTML_DIAG;
    if (!diag) continue;

    diagnostics.push({
      code: diag.code,
      severity: diag.severity,
      message: `${entry.displayId}: ${diag.summary}`,
      location: {
        file: entry.location.file,
        line: entry.location.line + 1 + i,
        column: 1,
      },
    });
  }

  return diagnostics;
}
