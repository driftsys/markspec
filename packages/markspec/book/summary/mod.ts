/**
 * @module book/summary
 *
 * SUMMARY.md parser and book structure resolver. Reads the table of
 * contents file and produces an ordered chapter tree following the
 * ADR-004 format: prefix chapters, parts with numbered chapters,
 * and suffix chapters.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import type {
  Heading,
  Link,
  List,
  ListItem,
  Paragraph,
  Root,
  Text,
} from "mdast";

// ── Types ─────────────────────────────────────────────────────────────────

/** The role of a chapter in the book structure. */
export type ChapterKind = "prefix" | "numbered" | "suffix" | "draft";

/** A single chapter or sub-chapter entry in the book. */
export interface Chapter {
  /** Role of this chapter in the book layout. */
  readonly kind: ChapterKind;
  /** Display title from the SUMMARY.md link text. */
  readonly title: string;
  /**
   * File path relative to the book root.
   * `undefined` for draft chapters (links with empty `href`).
   */
  readonly path: string | undefined;
  /** Nested sub-chapters from indented list items. */
  readonly subChapters: readonly Chapter[];
}

/**
 * A named part (section group) in the book.
 *
 * Parts are created by `# Heading` lines in SUMMARY.md. Chapters that
 * appear before any part heading are grouped into an implicit part with
 * `title: undefined`.
 */
export interface Part {
  /**
   * Part heading text, or `undefined` for the implicit root section
   * (numbered chapters before the first `# Heading`).
   */
  readonly title: string | undefined;
  /** Numbered chapters belonging to this part. */
  readonly chapters: readonly Chapter[];
}

/** Parsed book structure produced by {@linkcode parseSummary}. */
export interface BookStructure {
  /**
   * Unnested link paragraphs before any part or numbered chapter.
   * Rendered without chapter numbers in the sidebar.
   */
  readonly prefixChapters: readonly Chapter[];
  /**
   * Parts of the book in document order.
   * An implicit part (title: undefined) is included when numbered
   * chapters appear before the first `# Heading`.
   */
  readonly parts: readonly Part[];
  /**
   * Unnested link paragraphs after all numbered content.
   * Rendered without chapter numbers (back matter).
   */
  readonly suffixChapters: readonly Chapter[];
}

// ── Parser ────────────────────────────────────────────────────────────────

const _parser = unified().use(remarkParse);

/**
 * Parse a SUMMARY.md string and return the book structure.
 *
 * Follows the ADR-004 SUMMARY.md format:
 * - `# Summary` — conventional title heading, skipped
 * - Unnested link paragraphs before any list → prefix chapters
 * - `# Heading` → Part divider, starts a new part
 * - List items with links → numbered chapters (nested → sub-chapters)
 * - List items with empty `href` → draft chapters
 * - Unnested link paragraphs after lists → suffix chapters
 * - `---` → separator, ignored
 *
 * @param markdown - SUMMARY.md source text
 * @returns Structured book layout
 */
export function parseSummary(markdown: string): BookStructure {
  const tree = _parser.parse(markdown) as Root;

  const prefixChapters: Chapter[] = [];
  const suffixChapters: Chapter[] = [];
  const parts: Part[] = [];

  let currentPart:
    | { title: string | undefined; chapters: Chapter[] }
    | undefined;
  let hasNumbered = false;

  for (const node of tree.children) {
    if (node.type === "thematicBreak") continue;

    if (node.type === "heading" && (node as Heading).depth === 1) {
      const text = headingText(node as Heading);
      if (text.toLowerCase() === "summary") continue;
      if (currentPart) parts.push({ ...currentPart });
      currentPart = { title: text, chapters: [] };
      hasNumbered = true;
      continue;
    }

    if (node.type === "list") {
      if (!currentPart) currentPart = { title: undefined, chapters: [] };
      currentPart.chapters.push(...listToChapters(node as List));
      hasNumbered = true;
      continue;
    }

    if (node.type === "paragraph") {
      for (const chapter of paragraphChapters(node as Paragraph)) {
        if (hasNumbered) {
          suffixChapters.push({ ...chapter, kind: "suffix" });
        } else {
          prefixChapters.push({ ...chapter, kind: "prefix" });
        }
      }
    }
  }

  if (currentPart) parts.push({ ...currentPart });

  return { prefixChapters, parts, suffixChapters };
}

// ── Internals ─────────────────────────────────────────────────────────────

/** Extract plain text from a heading node. */
function headingText(node: Heading): string {
  return node.children
    .map((c) => (c.type === "text" ? (c as Text).value : ""))
    .join("")
    .trim();
}

/**
 * Extract chapters from a root-level paragraph.
 *
 * Each link in the paragraph becomes its own chapter. This handles both
 * single-link paragraphs (blank lines between entries) and multi-link
 * paragraphs (consecutive lines without separating blank lines).
 */
function paragraphChapters(node: Paragraph): Omit<Chapter, "kind">[] {
  const results: Omit<Chapter, "kind">[] = [];
  for (const child of node.children) {
    if (child.type !== "link") continue;
    const link = child as Link;
    const title = link.children
      .map((c) => (c.type === "text" ? (c as Text).value : ""))
      .join("")
      .trim();
    if (!title) continue;
    results.push({ title, path: link.url || undefined, subChapters: [] });
  }
  return results;
}

/** Parse a list node into an array of chapters. */
function listToChapters(list: List): Chapter[] {
  return list.children.map((item) => listItemToChapter(item as ListItem));
}

/** Parse a single list item into a Chapter. */
function listItemToChapter(item: ListItem): Chapter {
  const para = item.children.find((c): c is Paragraph =>
    c.type === "paragraph"
  );
  const link = para?.children.find((c): c is Link => c.type === "link");

  const title = link
    ? link.children
      .map((c) => (c.type === "text" ? (c as Text).value : ""))
      .join("")
      .trim()
    : para?.children
      .map((c) => (c.type === "text" ? (c as Text).value : ""))
      .join("")
      .trim() ?? "(untitled)";

  const isDraft = !link || !link.url;
  const subList = item.children.find((c): c is List => c.type === "list");

  return {
    kind: isDraft ? "draft" : "numbered",
    title,
    path: isDraft ? undefined : link!.url,
    subChapters: subList ? listToChapters(subList) : [],
  };
}
