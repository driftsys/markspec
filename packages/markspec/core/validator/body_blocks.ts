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
 * Each excluded construct maps to a distinct AST node kind or property:
 *
 *   - Headings  → `UnknownNode` with `subkind: "heading"`
 *   - HR        → `UnknownNode` with `subkind: "thematic-break"`
 *   - Task list → `ListNode` with `hasTaskItems: true`
 *   - Block HTML → `UnknownNode` with `subkind: "html"` (raw checked for
 *     the markspec-directive carve-out)
 *   - Inline HTML — remains inside `ParagraphNode.content.text` (remark
 *     does not extract inline HTML nodes into block-level nodes); each
 *     paragraph's text is scanned line-by-line using the same regex
 *     approach as the old walkProseLines path, but bounded to prose-only
 *     nodes (code/feature/math blocks are automatically excluded because
 *     the builder does not emit prose-bearing nodes for verbatim content).
 *
 * Code, Feature, and Math blocks are automatically excluded because the
 * builder emits opaque nodes for verbatim content — no prose text to scan.
 */

import type { Diagnostic, Entry } from "../model/mod.ts";
import type { BodyBlock } from "../ast/nodes.ts";
import { isMarkspecDirectiveComment } from "../parser/directives.ts";

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
 * Return `true` when `line` contains raw HTML the body model forbids:
 * any tag, or any comment that isn't a standalone markspec directive.
 */
function hasForbiddenHtml(line: string): boolean {
  if (HTML_TAG_RE.test(line)) return true;
  if (HTML_COMMENT_RE.test(line) && !isMarkspecDirectiveComment(line)) {
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
 * Scan `text` line-by-line for forbidden inline HTML, starting at
 * `startLine` (1-based body-relative). Returns one `{ diag, bodyLine }`
 * pair per violating line — the same shape returned by
 * {@linkcode violationsFromBlock}.
 *
 * Each branch in `violationsFromBlock` that checks for inline HTML
 * supplies its own `text` source (prose text for paragraph/note/blockquote,
 * verbatim raw source for table) and its own `startLine` anchor; this
 * helper factors the shared scan loop while preserving per-branch inputs.
 */
function htmlViolations(
  text: string,
  startLine: number,
): Array<{ diag: BodyDiag; bodyLine: number }> {
  const out: Array<{ diag: BodyDiag; bodyLine: number }> = [];
  const lines = text.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (line.trim() === "") continue;
    if (hasForbiddenHtml(line)) {
      out.push({ diag: RAW_HTML_DIAG, bodyLine: startLine + li });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// AST-based exclusion walker
// ---------------------------------------------------------------------------

/**
 * Collect body-block exclusion violations from a single BodyBlock.
 * Returns an array of `{ diag, bodyLine }` pairs where `bodyLine` is the
 * 1-based body-relative line number of the violation (maps to file line via
 * `entry.location.line + bodyLine`).
 */
function violationsFromBlock(
  block: BodyBlock,
): Array<{ diag: BodyDiag; bodyLine: number }> {
  const out: Array<{ diag: BodyDiag; bodyLine: number }> = [];

  switch (block.kind) {
    case "unknown": {
      const bodyLine = block.range.start.line;
      if (block.subkind === "heading") {
        out.push({ diag: HEADING_DIAG, bodyLine });
      } else if (block.subkind === "thematic-break") {
        out.push({ diag: HR_DIAG, bodyLine });
      } else if (block.subkind === "html") {
        // Block-level HTML: check if it is a markspec directive (exempt)
        // or forbidden HTML. The `raw` field carries the verbatim source.
        if (!isMarkspecDirectiveComment(block.raw)) {
          out.push({ diag: RAW_HTML_DIAG, bodyLine });
        }
      }
      break;
    }

    case "list": {
      if (block.hasTaskItems) {
        out.push({ diag: TASK_LIST_DIAG, bodyLine: block.range.start.line });
      } else {
        // Non-task list: recurse into items to catch nested excluded blocks.
        for (const item of block.items) {
          for (const sub of item.blocks) {
            out.push(...violationsFromBlock(sub));
          }
        }
      }
      break;
    }

    case "paragraph": {
      // Inline HTML remains inside paragraph text (remark does not
      // surface it as a separate block node). Scan each line of the
      // paragraph's prose text for forbidden HTML.
      out.push(...htmlViolations(block.content.text, block.range.start.line));
      break;
    }

    // Prose-bearing nodes that are not forbidden — scan for inline HTML.
    case "note":
    case "blockquote": {
      out.push(...htmlViolations(block.content.text, block.range.start.line));
      break;
    }

    // Table cells may contain inline HTML.
    case "table": {
      // Tables are in-scope for HTML scanning but their cell text is
      // structured. Scan the raw table source line-by-line instead,
      // since the `raw` field contains the verbatim source and avoids
      // needing to reconstruct cell content per-line. The raw field's
      // line offsets start at `range.start.line`.
      out.push(...htmlViolations(block.raw, block.range.start.line));
      break;
    }

    case "definition-list": {
      // Definition list items may contain inline HTML in term/definition.
      for (const item of block.items) {
        out.push(...htmlViolations(item.term.text, block.range.start.line));
        out.push(
          ...htmlViolations(item.definition.text, block.range.start.line),
        );
      }
      break;
    }

    // Verbatim / structural nodes: no prose to scan.
    case "code":
    case "feature":
    case "math":
    case "figure":
    case "caption":
      break;

    default:
      break;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate that an entry's body contains none of the excluded body
 * constructs. Emits at most one diagnostic per excluded construct per
 * line (so a paragraph with `<div>foo</div><span>bar</span>` still
 * fires MSL-B043 once for that line).
 */
export function validateBodyBlocks(entry: Entry): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const blocks = entry.bodyAst ?? [];
  for (const block of blocks) {
    for (const { diag, bodyLine } of violationsFromBlock(block)) {
      diagnostics.push({
        code: diag.code,
        severity: diag.severity,
        message: `${entry.displayId}: ${diag.summary}`,
        location: {
          file: entry.location.file,
          // bodyLine is 1-based body-relative. Body line 1 = file line
          // entry.location.line + 1 (the line after the title).
          line: entry.location.line + bodyLine,
          column: 1,
        },
      });
    }
  }

  return diagnostics;
}
