/**
 * @module core/parser/body_tokens
 *
 * Inline-construct token extraction (ADR-016). Scans entry body prose for
 * the six BodyTokenKind variants, skipping verbatim regions (code, math,
 * inline-code spans). Inside ` ```feature ` / ` ```gherkin ` fences the
 * modal/EARS/entity-ref scanners are suppressed and the gherkin
 * section/step scanners run instead.
 *
 * Single source of truth for inline-construct extraction. Replaces the
 * pre-ADR-016 marker mechanism (`InlineContent.markers`) and the
 * `Entry.entityRefs` field.
 */

import type { BodyToken, SourceLocation } from "../model/mod.ts";
import type { BodyBlock } from "../ast/nodes.ts";
import { classifyConvention } from "./entity_refs.ts";
import { processor } from "./remark.ts";
import type { Root, RootContent } from "mdast";

/** RFC 2119 modal verbs — matched case-insensitively as whole words. */
const MODAL_RE = /\b(shall|should|may|must|will)\b/gi;

/** EARS pattern triggers — capital-initial, whole word, case-sensitive. */
const EARS_RE = /\b(When|While|If|Where|Then)\b/g;

/** `$Identifier` entity reference (spec §2.5.2). */
const ENTITY_REF_RE = /\$([A-Za-z][A-Za-z0-9_]*)/g;

/**
 * Walk the mdast for the body and emit one `inline-code` token per
 * `inlineCode` node. Markdown line/column positions translate directly
 * to body-relative line/column.
 */
function emitInlineCode(
  body: string,
  out: BodyToken[],
  baseLocation: SourceLocation,
): void {
  const tree = processor.parse(body) as Root;
  const visit = (node: RootContent | Root): void => {
    if (
      node.type === "inlineCode" && node.position &&
      node.value !== undefined
    ) {
      out.push({
        kind: "inline-code",
        text: `\`${node.value}\``,
        location: {
          file: baseLocation.file,
          line: baseLocation.line + node.position.start.line - 1,
          column: node.position.start.column,
        },
      });
      return;
    }
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) visit(child as RootContent);
    }
  };
  visit(tree);
}

/**
 * Extract body-token stream from an entry body.
 *
 * @param body - entry body string (post-`splitBodyAndAttributes`)
 * @param bodyAst - canonical body AST for the same body (drives
 *   code/math/feature fence detection)
 * @param baseLocation - `SourceLocation` of the body's first line; the
 *   `file` field is propagated to every emitted token
 * @returns tokens sorted by `(line, column)`. Empty when no constructs
 *   are recognised.
 */
export function extractBodyTokens(
  body: string,
  bodyAst: readonly BodyBlock[],
  baseLocation: SourceLocation,
): readonly BodyToken[] {
  // bodyAst will drive verbatim-region exclusion in a later task.
  void bodyAst;

  const tokens: BodyToken[] = [];
  const lines = body.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineNo = baseLocation.line + li;
    MODAL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MODAL_RE.exec(line)) !== null) {
      const text = m[1];
      tokens.push({
        kind: "modal",
        text,
        case: text === text.toLowerCase() ? "lower" : "upper",
        location: {
          file: baseLocation.file,
          line: lineNo,
          column: m.index + 1,
        },
      });
    }

    EARS_RE.lastIndex = 0;
    while ((m = EARS_RE.exec(line)) !== null) {
      const text = m[1] as "When" | "While" | "If" | "Where" | "Then";
      tokens.push({
        kind: "ears-trigger",
        text,
        trigger: text,
        location: {
          file: baseLocation.file,
          line: lineNo,
          column: m.index + 1,
        },
      });
    }

    ENTITY_REF_RE.lastIndex = 0;
    while ((m = ENTITY_REF_RE.exec(line)) !== null) {
      // Skip second half of `$$…$$` math fence
      if (m.index > 0 && line[m.index - 1] === "$") continue;
      // Skip escaped `\$`
      if (m.index > 0 && line[m.index - 1] === "\\") continue;
      const ident = m[0]; // includes leading `$`
      const bare = m[1];
      tokens.push({
        kind: "entity-ref",
        text: ident,
        convention: classifyConvention(bare),
        location: {
          file: baseLocation.file,
          line: lineNo,
          column: m.index + 1,
        },
      });
    }
  }

  emitInlineCode(body, tokens, baseLocation);

  tokens.sort((a, b) =>
    a.location.line !== b.location.line
      ? a.location.line - b.location.line
      : a.location.column - b.location.column
  );
  return tokens;
}
