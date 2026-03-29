/**
 * @module parser/markdown
 *
 * CommonMark + MarkSpec extension parser. Walks the mdast AST to detect
 * `- [TYPE_XYZ_NNN[N]]` entry blocks and extract structured attributes.
 */

import type { Definition, List, ListItem, Paragraph, Text } from "mdast";
import type { Entry, EntryType } from "../model/mod.ts";
import { parseAttributes, splitBodyAndAttributes } from "./attributes.ts";
import { processor } from "./remark.ts";

/** Options for {@linkcode parseMarkdown}. */
export interface ParseMarkdownOptions {
  /** File path used in source locations. */
  readonly file?: string;
}

/**
 * Typed entry display ID pattern: `TYPE_XYZ_NNN[N]`.
 * TYPE = 2+ uppercase letters, XYZ = 2-12 uppercase letters, NNN[N] = 3 or 4 zero-padded digits.
 */
const TYPED_ID_RE = /^([A-Z]{2,})_[A-Z]{2,12}_\d{3,4}$/;

/**
 * Reference entry display ID pattern: letters, digits, hyphens.
 */
const REF_ID_RE = /^[A-Za-z0-9-]{2,}$/;

/**
 * Match a display ID in `[...]` at the start of a list item paragraph.
 * Captures: [1] = full display ID, [2] = title (rest of line).
 */
const ENTRY_START_RE = /^\[([^\]]+)\]\s*(.*)$/;

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

  // Collect link definition identifiers for shortcut reference exclusion.
  const definitions = new Set(
    tree.children
      .filter((n): n is Definition => n.type === "definition")
      .map((n) => n.identifier),
  );

  for (const node of tree.children) {
    if (node.type !== "list") continue;
    const list = node as List;

    // Ordered lists never contain entry blocks.
    if (list.ordered) continue;

    for (const item of list.children) {
      const entry = extractEntry(item, markdown, file, definitions);
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
  definitions: Set<string>,
): Entry | undefined {
  // Task list items (remark-gfm sets checked to true/false) are not entries.
  if (item.checked != null) return undefined;

  // An entry block must have children (body content).
  // The first child must be a paragraph starting with `[DISPLAY_ID]`.
  if (!item.children.length) return undefined;

  const firstChild = item.children[0];
  if (firstChild.type !== "paragraph") return undefined;

  const paragraph = firstChild as Paragraph;
  if (!paragraph.children.length) return undefined;

  const firstInline = paragraph.children[0];

  // Inline link: [text](url) — not an entry.
  if (firstInline.type === "link") return undefined;

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
      referenceType?: string;
      label?: string;
      identifier?: string;
      children: Array<{ type: string; value: string }>;
    };

    // Full [text][ref] and collapsed [text][] references are links, not entries.
    if (ref.referenceType === "full" || ref.referenceType === "collapsed") {
      return undefined;
    }

    // Shortcut [text] with a matching definition is a resolved link, not an entry.
    if (ref.referenceType === "shortcut" && ref.identifier != null) {
      if (definitions.has(ref.identifier)) return undefined;
    }

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

  // Compute indent width from the list item's column position.
  // column is 1-based, plus 2 for the `- ` marker.
  const indent = (item.position?.start.column ?? 1) - 1 + 2;
  const indentStr = " ".repeat(indent);

  // Extract the raw lines and strip the list item continuation indent
  const rawLines = lines.slice(startLine - 1, endLine);
  const stripped = rawLines.map((line) => {
    if (line.startsWith(indentStr)) return line.slice(indent);
    return line;
  });

  return stripped.join("\n").trim();
}
