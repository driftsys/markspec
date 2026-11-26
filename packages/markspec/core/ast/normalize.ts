/**
 * @module core/ast/normalize
 *
 * The AST-native §3.4.1 modal-keyword case pass (ADR-015 / SP3 Task 2).
 *
 * `normalizeBodyAst` is a deterministic, total, pure AST→AST transform
 * that applies the §3.4.1 modal-keyword case rule to every prose-bearing
 * node's `InlineContent.text`.
 *
 * §3.4.1 rule (`docs/specs/markspec-core-data-model.md` §3.4.1):
 *
 *   - RFC 2119 (`SHALL`, `SHOULD`, `MAY`, `MUST`, optionally `… NOT`) —
 *     always lowercased.
 *   - EARS (`When`, `While`, `Where`, `Unless`) — lowercased
 *     mid-sentence, capitalisation preserved when sentence-initial.
 *
 * The shared `normalizeProseModals` helper is imported from
 * `core/util/modals.ts`. Importing it from `formatter/mod.ts` would create
 * a cycle because `formatter/` already depends on `ast/`.
 * The helper uses only the standalone remark code-region parser.
 *
 * Invariants (HARD — never weaken):
 *   - Pure: no `Deno.*`, no I/O.
 *   - Deterministic.
 *   - Total: never throws; unknown / unexpected shapes pass through.
 *   - Idempotent: `normalizeBodyAst(normalizeBodyAst(x))` ≡
 *     `normalizeBodyAst(x)`.
 *   - Non-mutating: returns new arrays / nodes; the input is never
 *     written to.
 *   - Verbatim nodes (Code / Feature / Math) get NO modal recognition
 *     (spec §2.5); Figure / Caption / Unknown pass through unchanged.
 *
 * This module is pure library code: no `Deno.*` APIs.
 */

import { normalizeProseModals } from "../util/modals.ts";
import type {
  BlockquoteNode,
  BodyBlock,
  DefinitionListNode,
  DefinitionPair,
  InlineContent,
  ListItemNode,
  ListNode,
  NoteNode,
  ParagraphNode,
  TableNode,
} from "./nodes.ts";

/**
 * The link reference and footnote definitions of the body that
 * {@linkcode normalizeBodyAst} is normalising, joined by newlines. A
 * definition is a separate block, so the casing pass of one paragraph would
 * not see it and would lowercase a label it defines (#1014). Set for the
 * duration of one synchronous `normalizeBodyAst` call only.
 */
let bodyDefinitions = "";

/** A link reference definition (`[label]: dest`) or a footnote definition
 * (`[^label]: text`), as an `unknown` block's raw text starts. */
const DEFINITION_RE = /^ {0,3}\[[^\]\n]+\]:/;

/** The raw text of every top-level definition block of `blocks`. */
function collectDefinitions(blocks: readonly BodyBlock[]): string {
  return blocks
    .filter((b) => b.kind === "unknown" && DEFINITION_RE.test(b.raw))
    .map((b) => (b as { raw: string }).raw)
    .join("\n");
}

/**
 * Apply the casing pass to each cell of the raw table text separately, as
 * {@linkcode normalizeInline} does for the parsed cells. A whole-line pass
 * would not see the start of a cell as a sentence start, and would lowercase
 * an EARS keyword (`When`) that the cell pass keeps. Cells are split on `|`
 * outside code spans and not escaped with `\`.
 */
function normalizeTableRaw(raw: string): string {
  return raw.split("\n").map((line) => {
    let out = "";
    let cell = "";
    let codeTicks = 0;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "\\" && i + 1 < line.length) {
        cell += ch + line[++i];
        continue;
      }
      if (ch === "`") {
        let run = 1;
        while (line[i + run] === "`") run++;
        if (codeTicks === 0) codeTicks = run;
        else if (codeTicks === run) codeTicks = 0;
        cell += line.slice(i, i + run);
        i += run - 1;
        continue;
      }
      if (ch === "|" && codeTicks === 0) {
        out += normalizeCell(cell) + ch;
        cell = "";
        continue;
      }
      cell += ch;
    }
    return out + normalizeCell(cell);
  }).join("\n");
}

/** Case one raw cell, keeping its surrounding whitespace. */
function normalizeCell(cell: string): string {
  const lead = cell.length - cell.trimStart().length;
  const body = cell.trim();
  if (body === "") return cell;
  return cell.slice(0, lead) + normalizeProseModals(body, bodyDefinitions) +
    cell.slice(lead + body.length);
}

// ---------------------------------------------------------------------------
// InlineContent normalisation
// ---------------------------------------------------------------------------

/**
 * Return a NEW `InlineContent` whose `text` has every modal keyword
 * normalised per §3.4.1.
 *
 * If the normalised text equals the original, the original node is
 * returned UNCHANGED (makes the no-op case allocation-free).
 */
function normalizeInline(content: InlineContent): InlineContent {
  const normalizedText = normalizeProseModals(content.text, bodyDefinitions);
  if (normalizedText === content.text) return content;
  return { text: normalizedText };
}

// ---------------------------------------------------------------------------
// Per-node normalisation — recurse structurally; verbatim nodes untouched
// ---------------------------------------------------------------------------

function normalizeListItem(item: ListItemNode): ListItemNode {
  const blocks = normalizeBlocks(item.blocks);
  if (blocks === item.blocks) return item;
  return { ...item, blocks };
}

function normalizeBlock(block: BodyBlock): BodyBlock {
  switch (block.kind) {
    case "paragraph": {
      const content = normalizeInline(block.content);
      if (content === block.content) return block;
      return { ...block, content } satisfies ParagraphNode;
    }
    case "note": {
      const content = normalizeInline(block.content);
      if (content === block.content) return block;
      return { ...block, content } satisfies NoteNode;
    }
    case "blockquote": {
      const content = normalizeInline(block.content);
      if (content === block.content) return block;
      return { ...block, content } satisfies BlockquoteNode;
    }
    case "list": {
      const items = block.items.map(normalizeListItem);
      const changed = items.some((it, i) => it !== block.items[i]);
      if (!changed) return block;
      return { ...block, items } satisfies ListNode;
    }
    case "definition-list": {
      const items = block.items.map((pair): DefinitionPair => {
        const term = normalizeInline(pair.term);
        const definition = normalizeInline(pair.definition);
        if (term === pair.term && definition === pair.definition) return pair;
        return { term, definition };
      });
      const changed = items.some((it, i) => it !== block.items[i]);
      if (!changed) return block;
      return { ...block, items } satisfies DefinitionListNode;
    }
    case "table": {
      // TableNode renders via `raw`, so the casing pass changes the raw
      // text as well as the cells; otherwise the rendered table keeps the
      // old casing and no longer builds to the normalised cells (#1015).
      const header = block.header.map(normalizeInline);
      const rows = block.rows.map((row) => row.map(normalizeInline));
      const raw = normalizeTableRaw(block.raw);
      const headerChanged = header.some((c, i) => c !== block.header[i]);
      const rowsChanged = rows.some((row, i) =>
        row.some((c, j) => c !== block.rows[i][j])
      );
      if (!headerChanged && !rowsChanged && raw === block.raw) return block;
      return { ...block, header, rows, raw } satisfies TableNode;
    }
    // Verbatim content (§2.5: no modal recognition) and structurally
    // modal-free nodes pass through UNCHANGED — same reference.
    case "code":
    case "feature":
    case "math":
    case "figure":
    case "caption":
    case "unknown":
      return block;
  }
  // Total: any future / unexpected shape passes through unchanged.
  return block;
}

/**
 * Normalise every block, returning the SAME array reference when nothing
 * changed (so callers can cheaply detect a structural no-op and avoid
 * re-allocating ancestor nodes).
 */
function normalizeBlocks(
  blocks: readonly BodyBlock[],
): readonly BodyBlock[] {
  let changed = false;
  const out: BodyBlock[] = blocks.map((b) => {
    const nb = normalizeBlock(b);
    if (nb !== b) changed = true;
    return nb;
  });
  return changed ? out : blocks;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply the §3.4.1 modal-keyword case rule to every prose-bearing node
 * in a body AST.
 *
 * Pure, deterministic, total (never throws; unknown shapes pass
 * through), idempotent, and non-mutating: a fresh top-level array is
 * always returned and the input is never written to. Verbatim nodes
 * (Code / Feature / Math) and Figure / Caption / Unknown are returned
 * unchanged (spec §2.5 — no modal recognition inside verbatim content).
 *
 * Called exclusively from the formatter path (`core/formatter/mod.ts`);
 * never called from the parser or validator. The §3.4.1 case rule must
 * NOT be applied during parse/validate — `MSL-M060` still fires on
 * uppercase modals seen by the validator.
 *
 * @param blocks - The `BodyBlock[]` produced by `buildBodyAst` (or any
 *   prior `normalizeBodyAst` output — idempotence holds).
 * @returns A new `BodyBlock[]`; unchanged sub-trees share references with
 *   the input but the input array itself is never mutated.
 */
export function normalizeBodyAst(
  blocks: readonly BodyBlock[],
): BodyBlock[] {
  const previous = bodyDefinitions;
  bodyDefinitions = collectDefinitions(blocks);
  try {
    return [...normalizeBlocks(blocks)];
  } finally {
    bodyDefinitions = previous;
  }
}
