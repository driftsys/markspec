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

import { normalize } from "@std/path/posix";
import type {
  CompileResult,
  Diagnostic,
  EffectiveProfile,
  ProjectConfig,
} from "../core/mod.ts";
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
  /** Active profile chain's merged view, if any. Drives entry coloring. */
  readonly profile?: EffectiveProfile;
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

  const allChapters = _allChapters(structure);
  // Only chapters with a resolved file get a slug: a chapter declared in
  // SUMMARY.md but missing on disk (a common in-progress-book state, already
  // tolerated below with a "chapter file not found" warning) must not have
  // links to it confidently rewritten to a page that will never be written.
  // Keys are normalized so a SUMMARY.md path written with a redundant form
  // (e.g. "./index.md") still matches hrefs resolved to the plain form —
  // see RenderChapterOptions.chapterSlugs's doc comment for the contract.
  const chapterSlugs = new Map(
    allChapters
      .filter(
        (c): c is Chapter & { path: string } =>
          Boolean(c.path) && options.files.has(c.path!),
      )
      .map((c) => [normalize(c.path), slugForChapterPath(c.path)] as const),
  );

  for (const chapter of allChapters) {
    if (!chapter.path) continue; // skip drafts
    const markdown = options.files.get(chapter.path);
    if (!markdown) continue; // skip missing files

    const { html } = renderChapterHtml(markdown, {
      file: chapter.path,
      profile: options.profile,
      chapterSlugs,
    });
    chapters.push({
      kind: chapter.kind,
      title: chapter.title,
      path: chapter.path,
      html,
    });
  }

  return { chapters, diagnostics };
}

/**
 * Output slug for a chapter's rendered filename, derived from its source
 * path (e.g. `"recipes/deploy.md"` → `"recipes-deploy"`, written as
 * `recipes-deploy.html`). The single source of truth for this mapping —
 * both the CLI's write step and in-content cross-chapter link rewriting
 * (`RenderChapterOptions.chapterSlugs`) must agree on it, or a rewritten
 * link would point at a filename the write step never produces.
 *
 * Normalizes `path` first so a redundant SUMMARY.md-declared form (e.g.
 * `"./index.md"`) still produces the same slug as its canonical form
 * (`"index.md"` → `"index"`), rather than a mangled one (`"./index.md"`
 * would otherwise slugify to `".-index"`).
 */
export function slugForChapterPath(path: string): string {
  return normalize(path).replace(/\.md$/, "").replace(/\//g, "-");
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
