/**
 * @module core/ast/build
 *
 * Body-string → BodyBlock[] builder. Parses the entry body string
 * (post-`splitBodyAndAttributes`) with the shared remark processor and
 * maps each mdast block child to the §2.4-2.6 node taxonomy.
 *
 * Inline markers (modal + $Identifier) are extracted for prose-bearing
 * nodes: Paragraph, List items, Table cells, Note bodies, Blockquotes,
 * and DefinitionList term/definitions. They are NOT extracted inside
 * Code, Feature, or Math blocks (spec §2.5).
 *
 * This module is pure library code: no `Deno.*` APIs.
 */

import type { Root } from "mdast";
import { processor } from "../parser/remark.ts";
import { classifyConvention } from "../parser/entity_refs.ts";
import type {
  AdmonitionKind,
  BlockquoteNode,
  BodyBlock,
  CaptionNode,
  CodeNode,
  DefinitionListNode,
  EntityRefMarker,
  FeatureNode,
  FigureNode,
  InlineContent,
  InlineMarker,
  ListItemNode,
  ListNode,
  MathNode,
  ModalMarker,
  ModalMarkerClass,
  NoteNode,
  ParagraphNode,
  SourceRange,
  TableNode,
  UnknownNode,
} from "./nodes.ts";

// ---------------------------------------------------------------------------
// Inline marker recognition — modal keywords
// ---------------------------------------------------------------------------

/**
 * RFC 2119 tokens (lowercase canonical; matched case-insensitively in prose).
 * Multi-word forms listed first so the alternation greedily matches them.
 */
const RFC2119_RE =
  /\b(shall not|should not|must not|shall|should|must|may)\b/gi;

// EARS keywords recognised: When, While, Where, Unless.
const EARS_RE = /\b(When|While|Where|Unless)\b/g;

/** `$Identifier` entity reference — must not be preceded by another `$`. */
const ENTITY_REF_RE = /\$([A-Za-z][A-Za-z0-9_]*)/g;

/**
 * Extract all inline markers from a prose text string.
 * `lineOffset` is the 0-based line index of the text within the body
 * (used for SourceRange line numbers).
 *
 * For multi-line text the SourceRange carries the first line's 1-based
 * column; this is best-effort for PR 2 (noted as DONE_WITH_CONCERNS:
 * multi-line paragraph ranges are approximated to the starting line).
 *
 * Exported so the AST-native §3.4.1 normalisation pass
 * (`core/ast/normalize.ts`) re-derives `InlineContent.markers` from the
 * normalised text with the SAME extraction the builder uses — no regex
 * duplication.
 */
export function extractMarkersFromText(
  text: string,
  startRange: SourceRange,
): readonly InlineMarker[] {
  const markers: InlineMarker[] = [];
  const lines = text.split("\n");

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineNo = startRange.start.line + li;

    // ---- RFC 2119 ---------------------------------------------------
    RFC2119_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RFC2119_RE.exec(line)) !== null) {
      const raw = m[1];
      const canonical = raw.toLowerCase() as string;
      const col = m.index + 1;
      markers.push(
        {
          kind: "modal",
          cls: "rfc2119" as ModalMarkerClass,
          canonical,
          raw, // preserve source form for uppercase-keyword detection (MSL-M060)
          range: {
            start: { line: lineNo, column: col },
            end: { line: lineNo, column: col + raw.length },
          },
        } satisfies ModalMarker,
      );
    }

    // ---- EARS -------------------------------------------------------
    EARS_RE.lastIndex = 0;
    while ((m = EARS_RE.exec(line)) !== null) {
      const raw = m[1];
      const col = m.index + 1;
      markers.push(
        {
          kind: "modal",
          cls: "ears" as ModalMarkerClass,
          canonical: raw, // EARS: source form is canonical
          raw, // same as canonical for EARS
          range: {
            start: { line: lineNo, column: col },
            end: { line: lineNo, column: col + raw.length },
          },
        } satisfies ModalMarker,
      );
    }

    // ---- $Identifier ------------------------------------------------
    ENTITY_REF_RE.lastIndex = 0;
    while ((m = ENTITY_REF_RE.exec(line)) !== null) {
      // Discard if preceded by another `$` (math fence `$$…$$`)
      if (m.index > 0 && line[m.index - 1] === "$") continue;
      // Discard if preceded by `\` (escaped)
      if (m.index > 0 && line[m.index - 1] === "\\") continue;
      const ident = m[0]; // includes leading `$`
      const bare = m[1];
      const col = m.index + 1;
      markers.push(
        {
          kind: "entity",
          ident,
          convention: classifyConvention(bare),
          range: {
            start: { line: lineNo, column: col },
            end: { line: lineNo, column: col + ident.length },
          },
        } satisfies EntityRefMarker,
      );
    }
  }

  return markers;
}

/**
 * Build an InlineContent. `storedText` is the verbatim source prose that
 * `render` emits (§5.1 faithful); `recognitionText` is the flattened
 * projection that modal / $Identifier recognition runs on (so `\bshall\b`
 * still matches inside `_shall_`). For nodes whose text carries no inline
 * markup the two are identical and behaviour is unchanged.
 */
function inlineContent(
  storedText: string,
  recognitionText: string,
  range: SourceRange,
): InlineContent {
  const markers = extractMarkersFromText(recognitionText, range);
  return { text: storedText, markers };
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
 * Deterministically split a verbatim definition-list slice into its
 * term and definition substrings.
 *
 * Detection still runs on the flattened text via {@linkcode
 * tryDefinitionList} (markup-stripped recognition, mirroring caption /
 * math detection). This function only governs what is *stored*: it
 * returns the byte-exact verbatim term and definition so inline markup
 * on either side survives.
 *
 * The split mirrors `renderDefinitionList` in `render.ts` exactly. That
 * renderer emits `${term.text}\n: ${definition.text}` — one newline,
 * then `: ` (colon + single space). The inverse is therefore: split on
 * the first `\n:`, take everything before as the term, then consume the
 * leading whitespace after the colon (the `\s+` that `DEFLIST_RE` and
 * the canonical `: ` collapse). The remainder is the definition.
 *
 * Why this replaces `DEFLIST_RE.exec(verbatim.trim())`: that regex's
 * `(.+)$` under the `/m` flag stops at the first newline, so a verbatim
 * slice spanning multiple source lines silently lost everything after
 * the first definition line and fell back to the flattened (markup-
 * stripped) form. A deterministic first-`\n:` split never misses.
 *
 * Returns `undefined` only when the verbatim slice contains no `\n:`
 * separator (cannot happen for a canonical single-item deflist that
 * flattened-detection accepted, but kept total for safety).
 */
function splitVerbatimDeflist(
  verbatim: string,
): { term: string; definition: string } | undefined {
  const sepIndex = verbatim.indexOf("\n:");
  if (sepIndex < 0) return undefined;
  const term = verbatim.slice(0, sepIndex);
  // Skip the `\n:` then the leading whitespace the renderer re-emits
  // as the single space in `: ` (same whitespace `DEFLIST_RE`'s `\s+`
  // would have consumed).
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

// deno-lint-ignore no-explicit-any
function extractMdastText(node: any): string {
  if (!node) return "";
  // Inline code nodes carry their value without delimiters in mdast;
  // re-add the backtick delimiters so the round-trip is byte-identical.
  if (node.type === "inlineCode") return `\`${node.value}\``;
  if (typeof node.value === "string") return node.value;
  if (Array.isArray(node.children)) {
    return node.children.map(extractMdastText).join("");
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

// deno-lint-ignore no-explicit-any
function mapMdastNode(node: any, body: string): BodyBlock {
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
          range,
        } satisfies FigureNode;
      }

      // Check for math `$$ ... $$` paragraph
      const mathTex = tryMathParagraph(text);
      if (mathTex !== undefined) {
        return { kind: "math", tex: mathTex, range } satisfies MathNode;
      }

      // Check for definition-list pattern `Term\n: def`
      const defList = tryDefinitionList(text);
      if (defList) {
        // Detection ran on the flattened text (markup-stripped, like
        // caption / math detection). The *stored* term and definition
        // are the byte-exact verbatim substrings so inline markup on
        // either side survives. The split is deterministic (first
        // `\n:`) and mirrors `renderDefinitionList` exactly — it can
        // never miss a multi-line verbatim slice the way the old
        // `DEFLIST_RE.exec(verbatim.trim())` could, so there is no
        // flattened fallback. `splitVerbatimDeflist` only returns
        // `undefined` when there is no `\n:` at all (impossible here,
        // since flattened detection already matched `\n:`); the
        // `?? defList` keeps the expression total.
        const split = splitVerbatimDeflist(verbatim) ?? defList;
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
        // Position is resolved in a post-pass; default "below" for now
        return {
          kind: "caption",
          keyword: caption.keyword,
          text: caption.text,
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
      // Detect GFM task-list items (remark-gfm sets `checked` to true/false).
      // deno-lint-ignore no-explicit-any
      const hasTaskItems = node.children.some((item: any) =>
        item.checked != null
      );
      const items: ListItemNode[] = node.children.map(
        // deno-lint-ignore no-explicit-any
        (item: any): ListItemNode => {
          const itemRange = positionToRange(item.position);
          const subBlocks: BodyBlock[] = (item.children ?? []).map(
            // deno-lint-ignore no-explicit-any
            (child: any) => mapMdastNode(child, body),
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
        ordered: node.ordered ?? false,
        spread: node.spread ?? false,
        items,
        ...(hasTaskItems ? { hasTaskItems: true } : {}),
        range,
      } satisfies ListNode;
    }

    case "table": {
      // deno-lint-ignore no-explicit-any
      const rows: (readonly InlineContent[])[] = node.children.map((row: any) =>
        // deno-lint-ignore no-explicit-any
        (row.children ?? []).map((cell: any) => {
          const cellText = extractMdastText(cell);
          const cellRange = positionToRange(cell.position);
          // stored == recognition (table cells render via TableNode.raw; Task 5 confirms)
          return inlineContent(cellText, cellText, cellRange);
        })
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
      if (lang === "gherkin") {
        return {
          kind: "feature",
          source: node.value ?? "",
          range,
        } satisfies FeatureNode;
      }
      return {
        kind: "code",
        lang: lang || undefined,
        text: node.value ?? "",
        range,
      } satisfies CodeNode;
    }

    case "blockquote": {
      const verbatim = deQuote(verbatimSlice(body, node.position));
      const firstChild = node.children?.[0];

      if (firstChild?.type === "paragraph") {
        const paraText = extractMdastText(firstChild);
        const admonMatch = ADMONITION_FIRST_LINE_RE.exec(paraText.trim());
        if (admonMatch) {
          const kind = admonMatch[1] as AdmonitionKind;

          // Flattened recognition text (unchanged from prior behaviour):
          // marker-stripped first paragraph + remaining paragraphs.
          const rest = paraText.replace(ADMONITION_FIRST_LINE_RE, "").trim();
          const otherText = node.children
            .slice(1)
            // deno-lint-ignore no-explicit-any
            .map((c: any) => extractMdastText(c))
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

      const bqFlattened = node.children
        // deno-lint-ignore no-explicit-any
        .map((c: any) => extractMdastText(c))
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
      if (
        node.type === "heading" ||
        node.type === "setextHeading"
      ) {
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
  if (!body.trim()) return [];

  const tree = processor.parse(body) as Root;
  const blocks: BodyBlock[] = tree.children.map((node) =>
    mapMdastNode(node, body)
  );

  // Post-pass: assign caption positions
  return assignCaptionPositions(blocks);
}
