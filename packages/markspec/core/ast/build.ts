/**
 * @module core/ast/build
 *
 * Body-string → BodyBlock[] builder. Parses the entry body string
 * (post-`splitBodyAndAttributes`) with the shared remark processor and
 * maps each mdast block child to the §2.4-2.6 node taxonomy.
 *
 * This module is pure library code: no `Deno.*` APIs.
 */

import type {
  Blockquote,
  List,
  ListItem,
  Nodes,
  Root,
  RootContent,
  Table,
  TableCell,
  TableRow,
} from "mdast";
import { processor } from "../parser/remark.ts";
import { normalizeLineEndings } from "../util/line_endings.ts";
import { loadedGherkin } from "../gherkin/load.ts";
import { parseFeature } from "../gherkin/parse.ts";
import type {
  AdmonitionKind,
  BlockquoteNode,
  BodyBlock,
  CaptionNode,
  CodeNode,
  DefinitionListNode,
  FeatureNode,
  FigureNode,
  InlineContent,
  ListItemNode,
  ListNode,
  MathNode,
  NoteNode,
  ParagraphNode,
  SourceRange,
  TableNode,
  UnknownNode,
} from "./nodes.ts";

/**
 * Build an InlineContent from verbatim source prose.
 * `storedText` is the verbatim source prose that `render` emits (§5.1
 * faithful). The `_recognitionText` and `_range` parameters are kept for
 * call-site compatibility but are intentionally unused — inline-construct
 * extraction has moved to `Entry.bodyTokens` (ADR-016).
 */
function inlineContent(
  storedText: string,
  _recognitionText: string,
  _range: SourceRange,
): InlineContent {
  return { text: storedText };
}

// ---------------------------------------------------------------------------
// mdast position → SourceRange
// ---------------------------------------------------------------------------

function positionToRange(
  pos: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  } | undefined,
): SourceRange {
  if (!pos) {
    return { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } };
  }
  return {
    start: { line: pos.start.line, column: pos.start.column },
    end: { line: pos.end.line, column: pos.end.column },
  };
}

// ---------------------------------------------------------------------------
// verbatimSlice — faithful capture helper (§5.1)
// ---------------------------------------------------------------------------

/**
 * Return the exact source substring for an mdast node `position`, with
 * list-continuation indentation normalised to column 0 so the slice is a
 * self-contained, column-0-anchored string. This is the load-bearing
 * mechanism for §5.1 faithful capture (ADR-014; spec §5.1): remark
 * populates byte `offset` when a string is passed to `.parse()`; a
 * line/column reconstruction is the defensive fallback. Extracted from
 * the original inline `TableNode` logic — behaviour is identical.
 */
export function verbatimSlice(
  body: string,
  pos: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  } | undefined,
): string {
  if (!pos) return "";
  let raw: string;
  if (pos.start.offset !== undefined && pos.end.offset !== undefined) {
    raw = body.slice(pos.start.offset, pos.end.offset);
  } else {
    const bodyLines = body.split("\n");
    const startLine = pos.start.line - 1;
    const endLine = pos.end.line - 1;
    const startCol = pos.start.column - 1;
    const endCol = pos.end.column - 1;
    if (startLine === endLine) {
      raw = bodyLines[startLine]?.slice(startCol, endCol) ?? "";
    } else {
      const firstPart = bodyLines[startLine]?.slice(startCol) ?? "";
      const middleParts = bodyLines.slice(startLine + 1, endLine);
      const lastPart = bodyLines[endLine]?.slice(0, endCol) ?? "";
      raw = [firstPart, ...middleParts, lastPart].join("\n");
    }
  }
  const listIndent = pos.start.column - 1; // 0 for top-level nodes
  if (listIndent > 0) {
    const prefix = " ".repeat(listIndent);
    const rawLines = raw.split("\n");
    raw = [
      rawLines[0],
      ...rawLines.slice(1).map((line) =>
        line.startsWith(prefix) ? line.slice(listIndent) : line
      ),
    ].join("\n");
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Caption detection
// ---------------------------------------------------------------------------

/** Caption keywords from spec §2.6. */
const CAPTION_KEYWORDS = [
  "Figure",
  "Table",
  "Listing",
  "Feature",
  "Equation",
  "List",
] as const;

type CaptionKeyword = (typeof CAPTION_KEYWORDS)[number];

const CAPTION_RE = /^(Figure|Table|Listing|Feature|Equation|List):\s+(\S.*)/;

function tryCaptionParagraph(text: string): {
  keyword: CaptionKeyword;
  text: string;
} | undefined {
  const m = CAPTION_RE.exec(text.trim());
  if (!m) return undefined;
  return { keyword: m[1] as CaptionKeyword, text: m[2].trim() };
}

// ---------------------------------------------------------------------------
// Math detection — `$$` delimited paragraphs
// ---------------------------------------------------------------------------

const MATH_BLOCK_RE = /^\$\$([\s\S]*?)\$\$$/;

function tryMathParagraph(
  text: string,
): string | undefined {
  // Plain text that is exactly `$$ ... $$` → math block
  const m = MATH_BLOCK_RE.exec(text.trim());
  if (m) return m[1];
  return undefined;
}

// ---------------------------------------------------------------------------
// Fence info string — verbatim text after the language tag
// ---------------------------------------------------------------------------

/**
 * The opening line of a fenced code block: optional indentation, the fence
 * markers, optional spaces, the language tag (the first word of the info
 * string), and the rest of the line.
 */
const FENCE_OPEN_RE = /^[ \t]*(?:`{3,}|~{3,})[ \t]*\S+(.*)$/;

/**
 * The info-string text after the language tag of a fenced code block, read
 * from the verbatim source of the block (`verbatim`, whose first line is the
 * opening fence). mdast `meta` cannot be used: it decodes escapes and
 * character references and trims the spaces between the language and the
 * text. The returned text keeps those spaces (`"   title=x"` for
 * `` ```js   title=x ``) and its escapes and character references. Trailing
 * spaces and tabs on the fence line are removed, as `fmt` removes trailing
 * whitespace elsewhere. Returns `undefined` when there is no text after the
 * language tag.
 *
 * The caller must call it for a fenced code block with a language tag only:
 * an indented code block can start with a line that looks like a fence
 * opening, and that line is content, not an info string.
 */
export function verbatimFenceMeta(verbatim: string): string | undefined {
  const firstLine = verbatim.split("\n", 1)[0].replace(/\r$/, "");
  const rest = FENCE_OPEN_RE.exec(firstLine)?.[1].replace(/[ \t]+$/, "");
  return rest ? rest : undefined;
}

// ---------------------------------------------------------------------------
// Admonition detection
// ---------------------------------------------------------------------------

const ADMONITION_FIRST_LINE_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/;

// ---------------------------------------------------------------------------
// Definition-list detection (GLFM `Term\n: def` pattern)
//
// remark-gfm does NOT parse GLFM definition lists; they come through as
// Paragraph nodes. We detect the pattern in the body string before parsing
// and handle them via our pre-pass.
//
// DONE_WITH_CONCERNS: single-item best-effort as documented in the PR brief.
// ---------------------------------------------------------------------------

const DEFLIST_RE = /^([^\n:][^\n]*)\n:\s+(.+)$/m;

function tryDefinitionList(
  text: string,
): { term: string; definition: string } | undefined {
  const m = DEFLIST_RE.exec(text.trim());
  if (!m) return undefined;
  return { term: m[1].trim(), definition: m[2].trim() };
}

/**
 * The definition-list marker in the verbatim source: a line that starts
 * with a literal `:` followed by whitespace, after a term line that does
 * not start with `:`. Same shape as {@linkcode DEFLIST_RE}, but applied to
 * the source text, where an encoded (`&#58;`) or escaped (`\:`) colon is
 * still written as such. Such a colon is prose, so it is never a marker
 * (#989).
 */
const VERBATIM_DEFLIST_MARKER_RE = /^[^\n:][^\n]*\n:\s+\S/m;

/**
 * Split a verbatim paragraph slice into its definition-list term and
 * definition substrings, or return `undefined` when the verbatim source
 * holds no definition-list marker (see
 * {@linkcode VERBATIM_DEFLIST_MARKER_RE}).
 *
 * The caller runs {@linkcode tryDefinitionList} on the flattened text
 * first, so this function never accepts a paragraph the flattened check
 * rejects. It only decides on the verbatim source, where an encoded or
 * escaped colon is not decoded, and it governs what is *stored*: the
 * byte-exact verbatim term and definition, so inline markup on either side
 * survives.
 *
 * The split mirrors `renderDefinitionList` in `render.ts`. That renderer
 * emits `${term.text}\n: ${definition.text}`: one newline, then `: `
 * (colon and one space). The inverse splits at the first marker newline,
 * takes everything before it as the term, then skips the whitespace after
 * the colon. The remainder, which can span several source lines, is the
 * definition. Every character of the slice except that separator is kept,
 * so no text is lost.
 */
function splitVerbatimDeflist(
  verbatim: string,
): { term: string; definition: string } | undefined {
  const m = VERBATIM_DEFLIST_MARKER_RE.exec(verbatim);
  if (!m) return undefined;
  const sepIndex = m.index + m[0].indexOf("\n:");
  const term = verbatim.slice(0, sepIndex);
  // Skip the `\n:` then the leading whitespace the renderer re-emits
  // as the single space in `: `.
  let defStart = sepIndex + 2;
  while (defStart < verbatim.length && /\s/.test(verbatim[defStart])) {
    defStart++;
  }
  const definition = verbatim.slice(defStart);
  return { term, definition };
}

// ---------------------------------------------------------------------------
// mdast text extraction helper
// ---------------------------------------------------------------------------

function extractMdastText(node: Nodes | undefined): string {
  if (!node) return "";
  // Inline code nodes carry their value without delimiters in mdast;
  // re-add the backtick delimiters so the round-trip is byte-identical.
  if (node.type === "inlineCode") return `\`${node.value}\``;
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) {
    return node.children.map((c) => extractMdastText(c as Nodes)).join("");
  }
  return "";
}

// ---------------------------------------------------------------------------
// Caption position computation
// ---------------------------------------------------------------------------

/**
 * Compute caption positions: "above" or "below" relative to adjacent blocks.
 * This is a post-processing pass that examines caption nodes relative to their
 * neighbours.
 *
 * DONE_WITH_CONCERNS: position is determined by source order heuristic —
 * if the block *after* the caption is a non-caption, non-paragraph block,
 * caption is "above"; if the block *before* is such a block, it's "below".
 * For PR 2, defaults to "below" when adjacent block type is unclear.
 */
function assignCaptionPositions(blocks: BodyBlock[]): BodyBlock[] {
  const result: BodyBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind !== "caption") {
      result.push(blocks[i]);
      continue;
    }
    const cap = blocks[i] as CaptionNode;

    // Look ahead for a non-caption, non-paragraph block
    const nextBlock = blocks[i + 1];
    const prevBlock = result[result.length - 1];

    const isCaptionable = (b: BodyBlock | undefined): boolean => {
      if (!b) return false;
      return (
        b.kind === "figure" ||
        b.kind === "table" ||
        b.kind === "code" ||
        b.kind === "feature" ||
        b.kind === "math" ||
        b.kind === "list"
      );
    };

    let position: "above" | "below";
    if (isCaptionable(nextBlock)) {
      position = "above";
    } else if (isCaptionable(prevBlock)) {
      position = "below";
    } else {
      // Default: below (conservative)
      position = "below";
    }

    result.push({ ...cap, position } satisfies CaptionNode);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Blockquote de-quote (§5.1 faithful)
// ---------------------------------------------------------------------------

/**
 * De-quote a verbatim blockquote slice: strip the per-line `> ` (or bare
 * `>` for blank quoted lines) marker, preserving inline markup and the
 * interior-blank-line convention. CommonMark canonical quoting is `> `
 * on content lines and `>` alone on blank lines; a defensive `>`-without
 * -space strip handles non-canonical input.
 */
function deQuote(rawBlockquote: string): string {
  return rawBlockquote
    .split("\n")
    .map((line) => {
      if (line.startsWith("> ")) return line.slice(2);
      if (line === ">") return "";
      if (line.startsWith(">")) return line.slice(1);
      return line;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Main builder — mdast node → BodyBlock
// ---------------------------------------------------------------------------

function mapMdastNode(node: RootContent, body: string): BodyBlock {
  const range = positionToRange(node.position);

  switch (node.type) {
    case "paragraph": {
      const text = extractMdastText(node); // flattened — detection + recognition
      const verbatim = verbatimSlice(body, node.position);

      // Check for lone image → FigureNode
      if (
        node.children.length === 1 &&
        node.children[0].type === "image"
      ) {
        const img = node.children[0];
        return {
          kind: "figure",
          alt: img.alt ?? "",
          path: img.url ?? "",
          raw: verbatim,
          range,
        } satisfies FigureNode;
      }

      // Check for math `$$ ... $$` paragraph. Detection runs on the
      // flattened text; the stored TeX is the verbatim source between the
      // delimiters, because flattening decodes escapes (`\\` becomes `\`)
      // and character references (#1008). A paragraph whose source has no
      // literal `$$` delimiters (`\$\$x\$\$`) is not math.
      const mathTex = tryMathParagraph(text) !== undefined
        ? tryMathParagraph(verbatim)
        : undefined;
      if (mathTex !== undefined) {
        return { kind: "math", tex: mathTex, range } satisfies MathNode;
      }

      // Check for definition-list pattern `Term\n: def`. The flattened
      // check alone is not enough: flattening decodes `&#58;` and `\:` to
      // `:`, but an encoded or escaped colon is prose, not a marker. The
      // verbatim source must hold a literal marker too; otherwise the
      // paragraph stays a paragraph (#989). There is no fallback to the
      // flattened match, whose `(.+)$` keeps only the first line of the
      // definition.
      const defList = tryDefinitionList(text);
      const split = defList ? splitVerbatimDeflist(verbatim) : undefined;
      if (defList && split) {
        // The stored term and definition are the byte-exact verbatim
        // substrings, so inline markup on either side survives.
        const vTerm = split.term;
        const vDef = split.definition;
        const termRange: SourceRange = {
          start: range.start,
          end: range.start,
        };
        const defRange: SourceRange = {
          start: range.start,
          end: range.end,
        };
        return {
          kind: "definition-list",
          items: [
            {
              term: inlineContent(vTerm, defList.term, termRange),
              definition: inlineContent(vDef, defList.definition, defRange),
            },
          ],
          range,
        } satisfies DefinitionListNode;
      }

      // Check for caption `Figure: text` etc.
      const caption = tryCaptionParagraph(text);
      if (caption) {
        // Position is resolved in a post-pass; default "below" for now.
        // `text` is the flattened first line, read by validators. `raw`
        // is the verbatim paragraph, which the renderer writes back, so
        // later lines, link URLs and inline markup are kept (#1008).
        return {
          kind: "caption",
          keyword: caption.keyword,
          text: caption.text,
          raw: verbatim,
          position: "below",
          range,
        } satisfies CaptionNode;
      }

      // Plain paragraph: store verbatim source, recognise on flattened text.
      return {
        kind: "paragraph",
        content: inlineContent(verbatim, text, range),
        range,
      } satisfies ParagraphNode;
    }

    case "list": {
      const listNode = node as List;
      // Detect GFM task-list items (remark-gfm sets `checked` to true/false).
      const hasTaskItems = listNode.children.some((item: ListItem) =>
        item.checked != null
      );
      const items: ListItemNode[] = listNode.children.map(
        (item: ListItem): ListItemNode => {
          const itemRange = positionToRange(item.position);
          const subBlocks: BodyBlock[] = (item.children ?? []).map(
            (child) => mapMdastNode(child as RootContent, body),
          );
          return {
            blocks: subBlocks,
            ...(item.checked != null ? { checked: item.checked } : {}),
            ...(item.spread != null ? { spread: item.spread } : {}),
            range: itemRange,
          };
        },
      );
      return {
        kind: "list",
        ordered: listNode.ordered ?? false,
        spread: listNode.spread ?? false,
        items,
        ...(hasTaskItems ? { hasTaskItems: true } : {}),
        range,
      } satisfies ListNode;
    }

    case "table": {
      const tableNode = node as Table;
      const rows: (readonly InlineContent[])[] = tableNode.children.map(
        (row: TableRow) =>
          row.children.map((cell: TableCell) => {
            // TableCell children are PhrasingContent ⊂ RootContent ⊂ Nodes.
            const cellText = cell.children
              .map((c) => extractMdastText(c as unknown as Nodes))
              .join("");
            const cellRange = positionToRange(cell.position);
            // stored == recognition (table cells render via TableNode.raw; Task 5 confirms)
            return inlineContent(cellText, cellText, cellRange);
          }),
      );
      const [header = [], ...dataRows] = rows;
      const raw = verbatimSlice(body, node.position);
      return {
        kind: "table",
        header,
        rows: dataRows,
        raw,
        range,
      } satisfies TableNode;
    }

    case "code": {
      const lang = node.lang ?? undefined; // empty string → undefined
      // The info string after the language tag, read from the verbatim
      // fence line (#1008). Stored only when present, so a node without
      // one has no `meta` key.
      // An indented code block, or a fence with no info string, has no
      // `lang`; its first line is content even when it looks like a fence.
      const metaText = lang
        ? verbatimFenceMeta(verbatimSlice(body, node.position))
        : undefined;
      const meta = metaText !== undefined ? { meta: metaText } : {};
      if (lang === "gherkin" || lang === "feature") {
        const source = node.value ?? "";
        const api = loadedGherkin();
        if (!api) return { kind: "feature", source, ...meta, range };
        const parsed = parseFeature(api, source);
        return parsed.ok
          ? { kind: "feature", source, ...meta, feature: parsed.feature, range }
          : {
            kind: "feature",
            source,
            ...meta,
            parseError: {
              line: parsed.line,
              column: parsed.column,
              message: parsed.message,
            },
            range,
          } satisfies FeatureNode;
      }
      return {
        kind: "code",
        lang: lang || undefined,
        ...meta,
        text: node.value ?? "",
        range,
      } satisfies CodeNode;
    }

    case "blockquote": {
      const bqNode = node as Blockquote;
      const verbatim = deQuote(verbatimSlice(body, bqNode.position));
      const firstChild = bqNode.children?.[0];

      if (firstChild?.type === "paragraph") {
        const paraText = extractMdastText(firstChild as unknown as Nodes);
        const admonMatch = ADMONITION_FIRST_LINE_RE.exec(paraText.trim());
        if (admonMatch) {
          const kind = admonMatch[1] as AdmonitionKind;

          // Flattened recognition text (unchanged from prior behaviour):
          // marker-stripped first paragraph + remaining paragraphs.
          const rest = paraText.replace(ADMONITION_FIRST_LINE_RE, "").trim();
          const otherText = bqNode.children
            .slice(1)
            .map((c) => extractMdastText(c as unknown as Nodes))
            .join("\n\n");
          const flattened = [rest, otherText].filter(Boolean).join("\n\n");

          // Verbatim stored text: de-quoted slice with the `[!KIND]`
          // token removed from the first line. Anything the author put
          // after the marker on the same line is kept verbatim.
          const vLines = verbatim.split("\n");
          // `kind` is enum-constrained (NOTE|TIP|IMPORTANT|WARNING|CAUTION,
          // captured by ADMONITION_FIRST_LINE_RE) — no regex metacharacters,
          // so this dynamic RegExp is injection-safe (no escaping needed).
          const markerRe = new RegExp(`^\\[!${kind}\\]`);
          const afterMarker = (vLines[0] ?? "").replace(markerRe, "");
          const bodyLines = vLines.slice(1);
          // A non-empty `afterMarker` means the body began on the marker
          // line (`> [!KIND] text`). Record it so the renderer reproduces
          // the same-line form rather than rewriting to the own-line form.
          const markerInline = afterMarker.trim().length > 0;
          const storedText = markerInline
            ? [afterMarker.trimStart(), ...bodyLines].join("\n")
            : bodyLines.join("\n");

          return {
            kind: "note",
            admonition: kind,
            content: inlineContent(storedText, flattened, range),
            ...(markerInline ? { markerInline: true } : {}),
            range,
          } satisfies NoteNode;
        }
      }

      const bqFlattened = bqNode.children
        .map((c) => extractMdastText(c as unknown as Nodes))
        .join("\n\n");
      return {
        kind: "blockquote",
        content: inlineContent(verbatim, bqFlattened, range),
        range,
      } satisfies BlockquoteNode;
    }

    default: {
      // Headings, thematic breaks, raw HTML, and anything else → UnknownNode
      // so content is never lost. We annotate the sub-kind for the body-block
      // exclusion validator (MSL-B040–B043) so it can distinguish constructs
      // without re-scanning the body string.
      type SubKind = "heading" | "thematic-break" | "html" | undefined;
      let subkind: SubKind;
      if (node.type === "heading") {
        subkind = "heading";
      } else if (node.type === "thematicBreak") {
        subkind = "thematic-break";
      } else if (node.type === "html") {
        subkind = "html";
      }
      return {
        kind: "unknown",
        raw: verbatimSlice(body, node.position),
        ...(subkind !== undefined ? { subkind } : {}),
        range,
      } satisfies UnknownNode;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the canonical body AST from an entry body string.
 *
 * Re-parses `body` via the shared remark processor (CommonMark+GFM) and
 * maps each block-level mdast node to a `BodyBlock`. SourceRange positions
 * are body-relative (1-based line/column) matching the mdast output directly.
 *
 * DONE_WITH_CONCERNS notes:
 * - DefinitionList: single-item best-effort. `Term\n: def` patterns in
 *   multi-item lists are parsed as one DefinitionListNode per paragraph
 *   block; the validator would need to coalesce them (deferred).
 * - Caption position: assigned by adjacent-block heuristic (post-pass).
 *   `block` (resolved owner) is `undefined` for PR 2 per spec.
 * - Multi-line paragraph marker ranges: SourceRange is approximated to
 *   the paragraph start line; intra-paragraph column tracking is correct
 *   only for single-line paragraphs.
 */
export function buildBodyAst(body: string): BodyBlock[] {
  return buildBodyAstWithTree(body).blocks;
}

/**
 * Like {@linkcode buildBodyAst} but also returns the intermediate mdast
 * `Root` so callers that need it (e.g. body-token extraction) avoid
 * re-parsing.
 */
export function buildBodyAstWithTree(
  body: string,
): { blocks: BodyBlock[]; tree: Root } {
  // Line-ending normalisation is a §3.4 spec-permitted transformation:
  // every AST is built from LF-canonical text so `\r` never reaches a
  // node's text or markers. Without this, `buildBodyAst("a\r\nb")` and
  // `buildBodyAst("a\nb")` would produce different ASTs, breaking the
  // build/render/format contract for CRLF-bearing inputs.
  const normalised = normalizeLineEndings(body);
  if (!normalised.trim()) {
    return { blocks: [], tree: { type: "root", children: [] } };
  }

  const tree = processor.parse(normalised) as Root;
  const blocks: BodyBlock[] = tree.children.map((node) =>
    mapMdastNode(node, normalised)
  );

  // Post-pass: assign caption positions
  return { blocks: assignCaptionPositions(blocks), tree };
}
