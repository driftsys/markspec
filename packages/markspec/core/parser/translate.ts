/**
 * @module parser/translate
 *
 * Post-pass that walks parsed `Entry[]` and applies a `LineMap` to every
 * coordinate field — entry locations, body-AST node ranges (which carry
 * `{line, column}` points without `file`), body tokens. Returns a fresh
 * entries array; originals are not mutated.
 *
 * This is the **one translation point** required by ADR-016 §6. The
 * upstream parser produces buffer-relative locations; this pass converts
 * them to file-relative coordinates. When `LineMap.translate` returns
 * `undefined` (over-run past the block's last line), the affected
 * location safe-falls to the entry's own translated `location` with
 * column reset to 1, and a single `console.warn` per entries-batch
 * flags the drift.
 */

import type { Entry, SourceLocation } from "../model/mod.ts";
import type { BodyBlock, ListNode, SourceRange } from "../ast/nodes.ts";
import type { LineMap } from "./line_map.ts";

type Point = SourceRange["start"]; // { line: number; column: number }

/**
 * Translate every coordinate inside `entries` through `lineMap`.
 * Returns a new array of new entries; input is not mutated.
 */
export function translateEntryLocations(
  entries: readonly Entry[],
  lineMap: LineMap,
): Entry[] {
  let warned = false;
  const warn = (): void => {
    if (warned) return;
    warned = true;
    console.warn(
      "translateEntryLocations: LineMap.translate returned undefined " +
        "for at least one location; falling back to entry start. " +
        "This indicates a coordinate-translation drift.",
    );
  };

  return entries.map((entry) => {
    const translatedEntryLoc = translateLocation(
      entry.location,
      lineMap,
      entry.location,
      warn,
    );
    const fallbackPoint: Point = {
      line: translatedEntryLoc.line,
      column: 1,
    };
    return {
      ...entry,
      location: translatedEntryLoc,
      bodyAst: entry.bodyAst
        ? entry.bodyAst.map((block) =>
          translateBlock(block, lineMap, fallbackPoint, warn)
        )
        : entry.bodyAst,
      bodyTokens: entry.bodyTokens.map((token) => ({
        ...token,
        location: translateLocation(
          token.location,
          lineMap,
          translatedEntryLoc,
          warn,
        ),
      })) as Entry["bodyTokens"],
      properties: entry.properties?.file
        ? {
          ...entry.properties,
          file: {
            ...entry.properties.file,
            line: translatedEntryLoc.line,
            column: translatedEntryLoc.column,
          },
        }
        : entry.properties,
    };
  });
}

/** Translate a SourceLocation (preserves `file` field). */
function translateLocation(
  loc: SourceLocation,
  lineMap: LineMap,
  fallback: SourceLocation,
  warn: () => void,
): SourceLocation {
  const t = lineMap.translate(loc.line, loc.column);
  if (!t) {
    warn();
    return { file: loc.file, line: fallback.line, column: 1 };
  }
  return { file: loc.file, line: t.line, column: t.column };
}

/** Translate a SourceRange point (no `file` field). */
function translatePoint(
  pt: Point,
  lineMap: LineMap,
  fallback: Point,
  warn: () => void,
): Point {
  const t = lineMap.translate(pt.line, pt.column);
  if (!t) {
    warn();
    return { line: fallback.line, column: fallback.column };
  }
  return { line: t.line, column: t.column };
}

function translateBlock(
  block: BodyBlock,
  lineMap: LineMap,
  fallbackPoint: Point,
  warn: () => void,
): BodyBlock {
  const range: SourceRange = {
    start: translatePoint(block.range.start, lineMap, fallbackPoint, warn),
    end: translatePoint(block.range.end, lineMap, fallbackPoint, warn),
  };
  if (block.kind === "list") {
    const list = block as ListNode;
    return {
      ...list,
      range,
      items: list.items.map((item) => ({
        ...item,
        range: {
          start: translatePoint(item.range.start, lineMap, fallbackPoint, warn),
          end: translatePoint(item.range.end, lineMap, fallbackPoint, warn),
        },
        blocks: item.blocks.map((b) =>
          translateBlock(b, lineMap, fallbackPoint, warn)
        ),
      })),
    } satisfies ListNode;
  }
  return { ...block, range } as BodyBlock;
}
