/**
 * @module book
 *
 * Book builder — multi-file HTML output. Parses SUMMARY.md for
 * structure and generates rendered chapter HTML using the MarkSpec-aware
 * rendering pipeline.
 */

export { parseSummary } from "./summary/mod.ts";
export type {
  BookStructure,
  Chapter,
  ChapterKind,
  Part,
} from "./summary/mod.ts";

export { renderChapterHtml } from "./site/mod.ts";
export type { RenderChapterOptions, RenderChapterResult } from "./site/mod.ts";

import type { CompileResult, Diagnostic, ProjectConfig } from "../core/mod.ts";
import { renderChapterHtml } from "./site/mod.ts";
import type { BookStructure, Chapter } from "./summary/mod.ts";

// ── Build API ─────────────────────────────────────────────────────────────

/** Options for building a complete book. */
export interface BuildBookOptions {
  /** Resolved chapter file contents keyed by path. */
  readonly files: ReadonlyMap<string, string>;
  /** Compiled project model (for traceability context). */
  readonly compiled: CompileResult;
  /** Project configuration from `project.yaml`. */
  readonly config: ProjectConfig;
}

/** A rendered chapter ready for site assembly. */
export interface BuiltChapter {
  readonly kind: "prefix" | "numbered" | "suffix" | "draft";
  readonly title: string;
  /** Path key matching the key in {@linkcode BuildBookOptions.files}. */
  readonly path: string;
  /** Rendered HTML body for this chapter. */
  readonly html: string;
}

/** Result of a book build. */
export interface BuildBookResult {
  /** Rendered chapters in document order. */
  readonly chapters: readonly BuiltChapter[];
  /** Diagnostics collected during rendering. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Build a book from a parsed structure and resolved file contents.
 *
 * Renders each chapter (prefix, numbered, suffix) to HTML using the
 * MarkSpec-aware pipeline. Draft chapters and chapters whose paths are
 * not present in `options.files` are skipped.
 *
 * @param structure - Parsed book structure from `parseSummary()`
 * @param options - Build options: file map, compiled model, project config
 * @returns Rendered chapters in document order and any diagnostics
 */
export function buildBook(
  structure: BookStructure,
  options: BuildBookOptions,
): BuildBookResult {
  const chapters: BuiltChapter[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const chapter of _allChapters(structure)) {
    if (!chapter.path) continue; // skip drafts
    const markdown = options.files.get(chapter.path);
    if (!markdown) continue; // skip missing files

    const { html } = renderChapterHtml(markdown, { file: chapter.path });
    chapters.push({
      kind: chapter.kind,
      title: chapter.title,
      path: chapter.path,
      html,
    });
  }

  return { chapters, diagnostics };
}

/** Flatten all chapters from a structure into document order. */
function _allChapters(structure: BookStructure): Chapter[] {
  return [
    ...structure.prefixChapters,
    ...structure.parts.flatMap((p) => _flattenChapters(p.chapters)),
    ...structure.suffixChapters,
  ];
}

function _flattenChapters(chapters: readonly Chapter[]): Chapter[] {
  return chapters.flatMap((c) => [c, ..._flattenChapters(c.subChapters)]);
}
