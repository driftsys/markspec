/**
 * @module render/captions
 *
 * Table and figure caption extraction and numbering.
 *
 * Assigns chapter-relative numbers to figures and tables detected by
 * the core parser's {@linkcode detectCaptions}. H1 headings (`# …`)
 * define chapter boundaries; each chapter has independent figure and
 * table counters.
 */

import type { Caption } from "../../core/mod.ts";
import { detectCaptions } from "../../core/mod.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A numbered caption with chapter-relative numbering. */
export interface NumberedCaption {
  /** The original caption. */
  readonly caption: Caption;
  /** Chapter number (1-based, from H1 headings). */
  readonly chapter: number;
  /** Sequential number within the chapter (1-based). */
  readonly sequence: number;
  /** Formatted label: "Figure 3.2" or "Table 3.1". */
  readonly label: string;
}

/** Caption registry for a document. */
export interface CaptionRegistry {
  /** All numbered captions, keyed by slug. */
  readonly captions: ReadonlyMap<string, NumberedCaption>;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** ATX heading pattern — `# Title` at the start of a line. */
const H1_PATTERN = /^# /;

/**
 * Collect 1-based line numbers of every H1 heading in the source.
 * Only ATX-style headings (`# …`) are considered — setext headings
 * (underlined with `===`) are intentionally excluded because they are
 * uncommon in MarkSpec documents.
 */
function findH1Lines(markdown: string): number[] {
  const lines = markdown.split("\n");
  const h1Lines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (H1_PATTERN.test(lines[i])) {
      h1Lines.push(i + 1); // 1-based
    }
  }
  return h1Lines;
}

/**
 * Determine the chapter number for a given 1-based line.
 *
 * The chapter is the count of H1 headings at or before the line.
 * If no H1 precedes the line, the caption belongs to chapter 1
 * (implicit first chapter).
 */
function chapterForLine(h1Lines: number[], line: number): number {
  let chapter = 0;
  for (const h1Line of h1Lines) {
    if (h1Line <= line) {
      chapter++;
    } else {
      break;
    }
  }
  // If no H1 before this line, treat as chapter 1.
  return Math.max(chapter, 1);
}

/** Capitalize first letter of a kind ("figure" → "Figure"). */
function kindLabel(kind: "figure" | "table"): string {
  return kind === "figure" ? "Figure" : "Table";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a caption registry from a Markdown document.
 * Assigns chapter-relative numbers to all figures and tables.
 */
export function buildCaptionRegistry(
  markdown: string,
  options?: { file?: string },
): CaptionRegistry {
  const captions = detectCaptions(markdown, options);
  const h1Lines = findH1Lines(markdown);

  // Per-chapter, per-kind counters.
  const counters = new Map<string, number>();
  const registry = new Map<string, NumberedCaption>();

  // Sort captions by line number to ensure stable ordering regardless
  // of the order detectCaptions returns them (it may do two passes).
  const sorted = [...captions].sort(
    (a, b) => a.location.line - b.location.line,
  );

  for (const caption of sorted) {
    const chapter = chapterForLine(h1Lines, caption.location.line);
    const counterKey = `${chapter}:${caption.kind}`;
    const seq = (counters.get(counterKey) ?? 0) + 1;
    counters.set(counterKey, seq);

    const label = `${kindLabel(caption.kind)} ${chapter}.${seq}`;

    registry.set(caption.slug, {
      caption,
      chapter,
      sequence: seq,
      label,
    });
  }

  return { captions: registry };
}

/**
 * Replace caption text in Markdown with numbered labels.
 *
 * Transforms emphasis captions in-place:
 * - `_Figure: Sensor layout_` → `_Figure 3.2: Sensor layout_`
 * - `_Table: Thresholds_`     → `_Table 1.1: Thresholds_`
 */
export function numberCaptions(
  markdown: string,
  registry: CaptionRegistry,
): string {
  let result = markdown;

  for (const numbered of registry.captions.values()) {
    const { caption, label } = numbered;
    const prefix = kindLabel(caption.kind);

    // The source pattern is `_Figure: text_` or `_Table: text_`.
    // Replace with `_Figure N.M: text_` or `_Table N.M: text_`.
    const original = `_${prefix}: ${caption.text}_`;
    const replacement = `_${label}: ${caption.text}_`;

    result = result.replace(original, replacement);
  }

  return result;
}
