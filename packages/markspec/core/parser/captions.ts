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

import type {
  Emphasis,
  Image,
  ImageReference,
  Paragraph,
  RootContent,
  Text,
} from "mdast";
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
 * Find a standalone inline or reference-style image in a paragraph.
 */
function getImage(node: RootContent): Image | ImageReference | undefined {
  if (node.type !== "paragraph" || node.children.length !== 1) return undefined;
  const [image] = node.children;
  return image.type === "image" || image.type === "imageReference"
    ? image
    : undefined;
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
          explicitTextLines: node.position && {
            start: node.position.start.line,
            end: node.position.end.line,
          },
        });
        continue;
      }
    }

    // Figure caption: image (or paragraph containing image) followed by
    // paragraph with _Figure: text_.
    const image = getImage(node);
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
            explicitTextLines: next.position && {
              start: next.position.start.line,
              end: next.position.end.line,
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

    const image = getImage(children[i]);
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
