/**
 * @module parser/captions
 *
 * Detects table and figure captions in Markdown documents.
 *
 * Caption patterns:
 * - **Table**: `_Table: text_` paragraph immediately followed by a `table` sibling.
 * - **Figure**: `image` node followed by `_Figure: text_` paragraph.
 * - **Figure fallback**: `image` with non-empty alt text and no explicit caption.
 */

import type { Emphasis, Image, Paragraph, Text } from "mdast";
import type { Caption } from "../model/mod.ts";
import { processor } from "./remark.ts";

/** Options for {@linkcode detectCaptions}. */
export interface DetectCaptionsOptions {
  /** File path used in source locations. */
  readonly file?: string;
}

/**
 * Convert caption text to a GFM-style anchor slug.
 *
 * Lowercase, spaces to hyphens, strip non-alphanumeric except hyphens.
 */
function toSlug(prefix: string, text: string): string {
  const anchor = text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return `${prefix}.${anchor}`;
}

/**
 * Extract plain text from an emphasis node (single emphasis child
 * containing text children).
 */
function getEmphasisText(node: Emphasis): string | undefined {
  if (node.children.length === 0) return undefined;
  return node.children
    .filter((c): c is Text => c.type === "text")
    .map((c) => c.value)
    .join("");
}

/**
 * Check if a paragraph contains a single emphasis child whose text
 * starts with the given prefix (e.g., "Table:" or "Figure:").
 * Returns the text after the prefix, or undefined.
 */
function getCaptionText(
  paragraph: Paragraph,
  prefix: string,
): string | undefined {
  // A caption paragraph has exactly one child: an emphasis node.
  if (paragraph.children.length !== 1) return undefined;
  const child = paragraph.children[0];
  if (child.type !== "emphasis") return undefined;

  const text = getEmphasisText(child as Emphasis);
  if (!text) return undefined;
  if (!text.startsWith(prefix)) return undefined;

  return text.slice(prefix.length).trim();
}

/**
 * Check if a node is an image or a paragraph containing only an image.
 * Returns the image node if found.
 */
function getImage(
  node: { type: string; children?: unknown[] },
): Image | undefined {
  if (node.type === "image") return node as Image;
  if (node.type === "paragraph") {
    const para = node as Paragraph;
    if (para.children.length === 1 && para.children[0].type === "image") {
      return para.children[0] as Image;
    }
  }
  return undefined;
}

/**
 * Detect table and figure captions in a Markdown string.
 *
 * @param markdown - Markdown source text
 * @param options - Detection options (file path for source locations)
 * @returns Array of detected captions
 */
export function detectCaptions(
  markdown: string,
  options?: DetectCaptionsOptions,
): Caption[] {
  const file = options?.file ?? "<unknown>";
  const tree = processor.parse(markdown);
  const captions: Caption[] = [];
  const children = tree.children;

  // Track which image nodes have explicit figure captions so we can
  // apply the alt-text fallback only to uncaptioned images.
  const captionedImageIndices = new Set<number>();

  // First pass: detect explicit captions.
  for (let i = 0; i < children.length; i++) {
    const node = children[i];

    // Table caption: paragraph with _Table: text_ followed by a table.
    if (node.type === "paragraph") {
      const text = getCaptionText(node as Paragraph, "Table:");
      if (text && i + 1 < children.length && children[i + 1].type === "table") {
        captions.push({
          kind: "table",
          slug: toSlug("tbl", text),
          text,
          location: {
            file,
            line: node.position?.start.line ?? 1,
            column: node.position?.start.column ?? 1,
          },
        });
        continue;
      }
    }

    // Figure caption: image (or paragraph containing image) followed by
    // paragraph with _Figure: text_.
    const image = getImage(
      node as { type: string; children?: unknown[] },
    );
    if (image && i + 1 < children.length) {
      const next = children[i + 1];
      if (next.type === "paragraph") {
        const text = getCaptionText(next as Paragraph, "Figure:");
        if (text) {
          captionedImageIndices.add(i);
          captions.push({
            kind: "figure",
            slug: toSlug("fig", text),
            text,
            location: {
              file,
              line: image.position?.start.line ?? 1,
              column: image.position?.start.column ?? 1,
            },
          });
          continue;
        }
      }
    }
  }

  // Second pass: alt-text fallback for uncaptioned images.
  for (let i = 0; i < children.length; i++) {
    if (captionedImageIndices.has(i)) continue;

    const image = getImage(
      children[i] as { type: string; children?: unknown[] },
    );
    if (image && image.alt && image.alt.trim() !== "") {
      captions.push({
        kind: "figure",
        slug: toSlug("fig", image.alt),
        text: image.alt,
        location: {
          file,
          line: image.position?.start.line ?? 1,
          column: image.position?.start.column ?? 1,
        },
      });
    }
  }

  return captions;
}
