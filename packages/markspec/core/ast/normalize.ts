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
 * The shared `RFC2119_MODAL_RE`, `EARS_KEYWORD_RE`, and `isSentenceInitial`
 * helpers are imported from `core/util/modals.ts` (D11 consolidation).
 * They cannot be imported from `formatter/mod.ts` because `formatter/`
 * depends on `ast/`, making an `ast → formatter` import a dependency cycle.
 * `core/util/` is the base level that both modules can import from.
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

import { walkProseLines } from "../util/fence.ts";
import {
  EARS_KEYWORD_RE,
  isSentenceInitial,
  RFC2119_MODAL_RE,
} from "../util/modals.ts";
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

// ---------------------------------------------------------------------------
// §3.4.1 string helper — uses shared RFC2119_MODAL_RE, EARS_KEYWORD_RE,
// and isSentenceInitial from core/util/modals.ts (D11 consolidation).
// ---------------------------------------------------------------------------

/**
 * Apply the §3.4.1 modal-keyword case rule to a prose string.
 *
 * Faithful port of `normalizeModalKeywords` (`core/formatter/mod.ts`):
 * fenced-code lines are skipped (verbatim, §5.1), and lines indented by
 * four or more spaces (or a tab) are skipped (conservatively captures
 * indented code blocks / attribute trailers — not prose). On every other
 * line, RFC 2119 keywords are lowercased unconditionally and EARS
 * keywords are lowercased unless sentence-initial.
 *
 * Pure and total: never throws; a string with no modal keyword is
 * returned unchanged.
 */
function normalizeModalsInText(text: string): string {
  const lines = text.split("\n");
  walkProseLines(text, (line, i) => {
    // Indented-code / attribute-trailer lines aren't prose either.
    if (/^( {4}|\t)/.test(line)) return;
    let normalized = line.replace(RFC2119_MODAL_RE, (m) => m.toLowerCase());
    normalized = normalized.replace(
      EARS_KEYWORD_RE,
      (m, _g1: string, offset: number) =>
        isSentenceInitial(normalized, offset) ? m : m.toLowerCase(),
    );
    lines[i] = normalized;
  });
  return lines.join("\n");
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
  const normalizedText = normalizeModalsInText(content.text);
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
      // TableNode renders via `raw` (byte-exact round-trip preserved).
      // Cell InlineContent is still normalised for validator-view
      // consistency — it does NOT affect render output.
      const header = block.header.map(normalizeInline);
      const rows = block.rows.map((row) => row.map(normalizeInline));
      const headerChanged = header.some((c, i) => c !== block.header[i]);
      const rowsChanged = rows.some((row, i) =>
        row.some((c, j) => c !== block.rows[i][j])
      );
      if (!headerChanged && !rowsChanged) return block;
      return { ...block, header, rows } satisfies TableNode;
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
  return [...normalizeBlocks(blocks)];
}
