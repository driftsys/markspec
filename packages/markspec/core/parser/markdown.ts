/**
 * @module parser/markdown
 *
 * CommonMark + MarkSpec extension parser. Walks the mdast AST to detect
 * `- [TYPE_XYZ_NNN[N]]` entry blocks and extract structured attributes.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { List, ListItem, Paragraph, Text } from "mdast";
import type { Entry, EntryType } from "../model/mod.ts";
import { parseAttributes, splitBodyAndAttributes } from "./attributes.ts";

/** Options for {@linkcode parseMarkdown}. */
export interface ParseMarkdownOptions {
  /** File path used in source locations. */
  readonly file?: string;
}

/**
 * Typed entry display ID pattern: `TYPE_XYZ_NNNN`.
 * TYPE = 2-4 uppercase letters, XYZ = 2-6 uppercase letters, NNNN = zero-padded digits.
 */
const TYPED_ID_RE = /^([A-Z]{2,4})_[A-Z]{2,6}_\d{4}$/;

/**
 * Reference entry display ID pattern: letters, digits, hyphens.
 */
const REF_ID_RE = /^[A-Za-z0-9-]+$/;

/**
 * Match a display ID in `[...]` at the start of a list item paragraph.
 * Captures: [1] = full display ID, [2] = title (rest of line).
 */
const ENTRY_START_RE = /^\[([^\]]+)\]\s*(.*)$/;

/** Build the remark processor once. */
const processor = unified().use(remarkParse).use(remarkGfm);

/**
 * Parse a Markdown string and return all MarkSpec entries found.
 *
 * Walks the mdast AST to detect `- [DISPLAY_ID] Title` list items
 * with indented body content. Extracts display ID, title, body,
 * and trailing attribute blocks.
 *
 * @param markdown - Markdown source text
 * @param options - Parse options (file path for source locations)
 * @returns Array of parsed entries
 */
export function parseMarkdown(
  markdown: string,
  options?: ParseMarkdownOptions,
): Entry[] {
  const file = options?.file ?? "<unknown>";
  const tree = processor.parse(markdown);
  const entries: Entry[] = [];

  for (const node of tree.children) {
    if (node.type !== "list") continue;
    const list = node as List;

    for (const item of list.children) {
      const entry = extractEntry(item, markdown, file);
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

/**
 * Attempt to extract a MarkSpec entry from a list item.
 * Returns undefined if the list item is not an entry block.
 */
function extractEntry(
  item: ListItem,
  markdown: string,
  file: string,
): Entry | undefined {
  // An entry block must have children (body content).
  // The first child must be a paragraph starting with `[DISPLAY_ID]`.
  if (!item.children.length) return undefined;

  const firstChild = item.children[0];
  if (firstChild.type !== "paragraph") return undefined;

  const paragraph = firstChild as Paragraph;
  if (!paragraph.children.length) return undefined;

  // The first inline must be a text node (mdast parses `[X]` as linkReference
  // or text depending on context — check both patterns).
  const firstInline = paragraph.children[0];

  let displayId: string | undefined;
  let title: string | undefined;

  if (firstInline.type === "text") {
    // remark may parse `[ID] Title` as a single text node
    const match = ENTRY_START_RE.exec((firstInline as Text).value);
    if (match) {
      displayId = match[1];
      title = match[2].trim();
    }
  }

  // Try linkReference pattern: remark sometimes parses [ID] as a linkReference
  if (!displayId && firstInline.type === "linkReference") {
    const ref = firstInline as unknown as {
      type: string;
      label?: string;
      children: Array<{ type: string; value: string }>;
    };
    displayId = ref.label ?? ref.children?.[0]?.value;
    // Title comes from subsequent text nodes in the paragraph
    if (displayId && paragraph.children.length > 1) {
      const rest = paragraph.children.slice(1);
      title = rest
        .filter((n): n is Text => n.type === "text")
        .map((n) => n.value)
        .join("")
        .trim();
    }
  }

  if (!displayId) return undefined;

  // Validate display ID format
  if (!TYPED_ID_RE.test(displayId) && !REF_ID_RE.test(displayId)) {
    return undefined;
  }

  // An entry block requires indented body content (more than just the title line).
  // If there's only one child (the title paragraph) and no further content,
  // it's not an entry block.
  if (item.children.length < 2) return undefined;

  // Extract entry type from typed display IDs
  const typedMatch = TYPED_ID_RE.exec(displayId);
  const entryType: EntryType | undefined = typedMatch
    ? typedMatch[1] as EntryType
    : undefined;

  // Extract body content from remaining children
  const bodyContent = extractBodyContent(item, markdown);

  // Split body and attributes
  const [body, attrLines] = splitBodyAndAttributes(bodyContent);
  const attributes = parseAttributes(attrLines);

  // Extract ULID from Id attribute
  const idAttr = attributes.find((a) => a.key === "Id");
  const id = idAttr?.value;

  // Source location
  const line = item.position?.start.line ?? 1;
  const column = item.position?.start.column ?? 1;

  return {
    displayId,
    title: title ?? "",
    body,
    attributes,
    id,
    entryType,
    location: { file, line, column },
    source: "markdown",
  };
}

/**
 * Extract body content from a list item's children (excluding the first paragraph
 * which contains the display ID and title).
 *
 * Reconstructs the text content from the source markdown using position info.
 */
function extractBodyContent(item: ListItem, markdown: string): string {
  const children = item.children.slice(1); // Skip title paragraph
  if (!children.length) return "";

  const lines = markdown.split("\n");

  // Get the range from the second child's start to the last child's end
  const startLine = children[0].position?.start.line;
  const endLine = children[children.length - 1].position?.end.line;

  if (!startLine || !endLine) return "";

  // Extract the raw lines and strip the list item indentation (typically 2 spaces)
  const rawLines = lines.slice(startLine - 1, endLine);
  const stripped = rawLines.map((line) => {
    // Remove up to 2 leading spaces (standard list continuation indent)
    if (line.startsWith("  ")) return line.slice(2);
    return line;
  });

  return stripped.join("\n").trim();
}
