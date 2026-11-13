/**
 * @module core/parser/body_tokens
 *
 * Inline-construct token extraction (ADR-016). Scans entry body prose for
 * the six BodyTokenKind variants, skipping verbatim regions (code, math,
 * inline-code spans). Inside ` ```feature ` / ` ```gherkin ` fences the
 * modal/EARS/entity-ref scanners are suppressed and the gherkin
 * section/step tokens come from the normalized Gherkin AST instead.
 *
 * Single source of truth for inline-construct extraction. Replaces the
 * pre-ADR-016 marker mechanism (`InlineContent.markers`) and the
 * `Entry.entityRefs` field.
 */

import type {
  BodyToken,
  EntityRefConvention,
  SourceLocation,
} from "../model/mod.ts";
import type { BodyBlock, SourceRange } from "../ast/nodes.ts";
import { processor } from "./remark.ts";
import type { Root, RootContent } from "mdast";

/**
 * Decide the case convention of an entity-reference identifier per spec
 * §2.5.2:
 *
 *   - `constant` — all-uppercase letters/digits/underscores, contains at
 *     least one underscore or digit, ends with `[A-Z0-9]`. Distinguishes
 *     `$DEBOUNCE_WINDOW` from a single-segment PascalCase like `$ASIL`.
 *   - `type` — starts with an uppercase letter (PascalCase / single
 *     uppercase segment).
 *   - `instance` — starts with a lowercase letter (camelCase).
 */
function classifyConvention(ident: string): EntityRefConvention {
  if (/^[A-Z][A-Z0-9_]*[A-Z0-9]$/.test(ident) && /[_0-9]/.test(ident)) {
    return "constant";
  }
  if (/^[A-Z]/.test(ident)) return "type";
  return "instance";
}

/** RFC 2119 modal verbs — matched case-insensitively as whole words.
 * Multi-word compounds (shall not, should not, must not) come first
 * so the leftmost-eager JS regex engine picks them before the bare verb. */
const MODAL_RE =
  /\b(shall not|should not|must not|shall|should|may|must|will)\b/gi;

/** EARS pattern triggers — capital-initial, whole word, case-sensitive. */
const EARS_RE = /\b(When|While|If|Where|Then)\b/g;

/** `$Identifier` entity reference (spec §2.5.2). */
const ENTITY_REF_RE = /\$([A-Za-z][A-Za-z0-9_]*)/g;

/**
 * Collect body-relative 1-based line numbers that fall inside verbatim
 * blocks: fenced code, fenced feature, math. Lines in this set are
 * skipped by the modal / EARS / entity-ref scanner.
 *
 * Recurses through list items so nested verbatim blocks (e.g., a code
 * fence inside a list item) are also captured.
 */
function collectVerbatimLines(blocks: readonly BodyBlock[]): Set<number> {
  const lines = new Set<number>();
  for (const block of blocks) {
    if (
      block.kind === "code" || block.kind === "feature" ||
      block.kind === "math"
    ) {
      for (
        let ln = block.range.start.line;
        ln <= block.range.end.line;
        ln++
      ) {
        lines.add(ln);
      }
    } else if (block.kind === "list") {
      for (const item of block.items) {
        for (const ln of collectVerbatimLines(item.blocks)) lines.add(ln);
      }
    }
  }
  return lines;
}

/**
 * Walk `bodyAst` for `feature` nodes and emit one token per Gherkin
 * structural keyword and per step keyword, taken from the normalized AST
 * (ADR-016). Token text is the keyword as authored, so a block written in
 * another language (`# language: fr`) yields `Scénario` and `Soit`. A
 * keyword inside step text, a description, or a doc string is not a
 * keyword in the AST and gives no token.
 *
 * Determinism rule: a node emits Gherkin tokens only when it carries a
 * `feature` AST. A node with a `parseError`, or with neither field (the
 * parser was not loaded when the node was built), emits none. Only the
 * Gherkin tokens depend on the parser; modal, EARS, entity-ref and
 * inline-code tokens never do. Gherkin tokens are read only by LSP
 * semantic tokens, which receive entries from `parseFile`; that path loads
 * the parser before it builds any entry that holds a gherkin or feature
 * fence.
 *
 * Positions are file-relative like the other tokens: the line is the
 * node's body-relative start plus the AST line, and the column adds
 * `columnOffset` (list-item indent or doc-comment prefix width).
 * Background steps come from `FeatureAst.backgrounds`, so each is emitted
 * once at its own position, also when the block has no scenario.
 */
function emitGherkin(
  blocks: readonly BodyBlock[],
  out: BodyToken[],
  baseLocation: SourceLocation,
  columnOffset: number,
): void {
  for (const block of blocks) {
    if (block.kind === "feature") {
      const feature = block.feature;
      if (!feature) continue;
      const startLine = block.range.start.line;
      const at = (range: SourceRange): SourceLocation => ({
        file: baseLocation.file,
        line: baseLocation.line + (startLine - 1) + range.start.line,
        column: range.start.column + columnOffset,
      });
      for (const section of feature.sections) {
        out.push({
          kind: "gherkin-section",
          text: section.keyword,
          location: at(section.range),
        });
      }
      for (const step of feature.backgrounds) {
        out.push({
          kind: "gherkin-step",
          text: step.keyword,
          location: at(step.range),
        });
      }
      for (const scenario of feature.scenarios) {
        for (const step of scenario.steps) {
          out.push({
            kind: "gherkin-step",
            text: step.keyword,
            location: at(step.range),
          });
        }
      }
    } else if (block.kind === "list") {
      for (const item of block.items) {
        emitGherkin(item.blocks, out, baseLocation, columnOffset);
      }
    }
  }
}

/**
 * Walk the mdast for the body and emit one `inline-code` token per
 * `inlineCode` node. Markdown line/column positions translate directly
 * to body-relative line/column.
 */
function emitInlineCode(
  tree: Root,
  out: BodyToken[],
  baseLocation: SourceLocation,
  columnOffset: number,
): void {
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
          column: node.position.start.column + columnOffset,
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
 * @param columnOffset - Number of source characters stripped from the
 *   start of each body line before the body string was built. Added to
 *   every emitted column value so columns are relative to the containing
 *   buffer line, not the stripped body text. Defaults to 0. Source-file
 *   callers (via parseMarkdown's lineMap path) supply the list-item
 *   indent width so the LineMap receives buffer-relative columns.
 * @returns tokens sorted by `(line, column)`. Empty when no constructs
 *   are recognised.
 */
export function extractBodyTokens(
  body: string,
  bodyAst: readonly BodyBlock[],
  baseLocation: SourceLocation,
  columnOffset = 0,
  mdastTree?: Root,
): readonly BodyToken[] {
  const tokens: BodyToken[] = [];
  const verbatimLines = collectVerbatimLines(bodyAst);
  const lines = body.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineNo = baseLocation.line + li;
    if (verbatimLines.has(li + 1)) continue;
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
          column: m.index + 1 + columnOffset,
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
          column: m.index + 1 + columnOffset,
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
          column: m.index + 1 + columnOffset,
        },
      });
    }
  }

  emitGherkin(bodyAst, tokens, baseLocation, columnOffset);
  const tree = mdastTree ?? processor.parse(body) as Root;
  emitInlineCode(tree, tokens, baseLocation, columnOffset);

  tokens.sort((a, b) =>
    a.location.line !== b.location.line
      ? a.location.line - b.location.line
      : a.location.column - b.location.column
  );
  return tokens;
}
