/**
 * @module parser/markdown
 *
 * CommonMark + MarkSpec extension parser. Walks the mdast AST to detect
 * `- [TYPE_XYZ_NNN[N]]` entry blocks and extract structured attributes.
 */

import type { Definition, List, ListItem, Paragraph, Text } from "mdast";
import type {
  Attribute,
  Entry,
  EntryFamily,
  EntryType,
  IdentityAttribute,
} from "../model/mod.ts";
import { FAMILY_BY_IDENTITY_KEY } from "../model/mod.ts";
import {
  collateAttributes,
  parseAttributes,
  splitBodyAndAttributes,
} from "./attributes.ts";
import { processor } from "./remark.ts";

/** Options for {@linkcode parseMarkdown}. */
export interface ParseMarkdownOptions {
  /** File path used in source locations. */
  readonly file?: string;
  /** Is this a references document? If undefined, auto-detect from file path. */
  readonly isReferencesDoc?: boolean;
}

/**
 * Spec / test entry display ID pattern per ADR-002 §Annex B.
 * TYPE = 2-6 uppercase letters
 * DOMAIN = 3-8 uppercase alphanumeric (first letter uppercase)
 * SUBDOMAIN = optional, same as DOMAIN
 * NNNN = 3-6 digits, must be > 0
 * Shared by spec and test families — discriminated by identity attribute.
 */
const TYPED_ID_RE =
  /^([A-Z]{2,6})_[A-Z][A-Z0-9]{2,7}(_[A-Z][A-Z0-9]{2,7})?_\d{3,6}$/;

/**
 * Reference entry slug pattern per ADR-002 §Part 3 (widened from the old
 * narrow subset to include `.`, `/`, `_`, and `-` inside the slug, matching
 * Pandoc citation-key convention's disciplined subset).
 */
const REF_SLUG_RE = /^[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?$/;

/**
 * Element entry display ID pattern per ADR-002 §Part 5.
 * Optional leading `::` marks an absolute path; `::` is the hierarchy
 * separator between segments; `.` and `/` may appear inside a segment.
 */
const ELEMENT_ID_RE =
  /^(::)?[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?(::[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?)*$/;

/** Identity-attribute keys per ADR-002 Part 6. */
const IDENTITY_KEYS: readonly IdentityAttribute[] = [
  "Spec-id",
  "Test-id",
  "Element-id",
  "Reference-id",
];

/** Display-ID regex for each family (post-identity-attribute discrimination). */
function displayIdMatchesFamily(
  displayId: string,
  family: EntryFamily,
): { matches: boolean; entryType: EntryType | undefined } {
  switch (family) {
    case "spec":
    case "test": {
      const m = TYPED_ID_RE.exec(displayId);
      return {
        matches: m !== null,
        entryType: m?.[1] as EntryType | undefined,
      };
    }
    case "element":
      return {
        matches: ELEMENT_ID_RE.test(displayId),
        entryType: undefined,
      };
    case "reference":
      return { matches: REF_SLUG_RE.test(displayId), entryType: undefined };
  }
}

/**
 * Find the sole identity attribute on an entry. Returns undefined when none
 * present; returns the first attribute when more than one is present (a
 * condition the validator flags as MSL-R003 in Phase 3).
 */
function findIdentityAttribute(
  attributes: readonly Attribute[],
): Attribute | undefined {
  for (const attr of attributes) {
    if ((IDENTITY_KEYS as readonly string[]).includes(attr.key)) {
      return attr;
    }
  }
  return undefined;
}

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
  const isReferencesDoc = detectReferencesDocument(
    file,
    options?.isReferencesDoc,
  );
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
      const entry = extractEntry(
        item,
        markdown,
        file,
        definitions,
        isReferencesDoc,
      );
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

/**
 * Detect if a file is a references document.
 * References context enables recognition of reference entries (slugs).
 * @param file - File path
 * @param explicit - Explicit override (undefined = auto-detect)
 */
function detectReferencesDocument(
  file: string,
  explicit: boolean | undefined,
): boolean {
  if (explicit !== undefined) return explicit;
  const basename = file.split("/").pop() ?? "";
  return basename === "references.md" || file.includes("/references/");
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
  isReferencesDoc: boolean,
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

  // Strip optional leading `@` on reference display IDs for Pandoc citation
  // compatibility (ADR-002 §Part 3). Canonical slug never contains `@`.
  if (displayId.startsWith("@")) displayId = displayId.slice(1);

  // Extract body content and attributes first — identity-attribute-based
  // family discrimination per ADR-002 Part 6 depends on the attribute block.
  const bodyContent = extractBodyContent(item, markdown);
  const [body, attrLines] = splitBodyAndAttributes(bodyContent);
  const attributes = parseAttributes(attrLines);

  let family: EntryFamily | undefined;
  let entryType: EntryType | undefined;
  let id: string | undefined;

  const identityAttr = findIdentityAttribute(attributes);
  if (identityAttr) {
    // Family is determined by the identity attribute (ADR-002 Part 6).
    family = FAMILY_BY_IDENTITY_KEY[identityAttr.key as IdentityAttribute];
    id = identityAttr.value;
    const match = displayIdMatchesFamily(displayId, family);
    if (!match.matches) {
      // Display ID doesn't match the declared family's format. Accept the
      // entry anyway — the validator (Phase 3) surfaces MSL-R007 for this
      // mismatch rather than silently dropping the entry here.
    }
    entryType = match.entryType;
  } else {
    // Legacy fallback: discriminate by display-ID regex + references-doc
    // heuristic. Used while source files still carry `Id:` instead of the
    // new family-specific identity attributes.
    const typedMatch = TYPED_ID_RE.exec(displayId);
    if (typedMatch) {
      family = "spec";
      entryType = typedMatch[1] as EntryType;
    } else if (isReferencesDoc && REF_SLUG_RE.test(displayId)) {
      family = "reference";
      entryType = undefined;
    } else {
      return undefined;
    }
    // Legacy ULID comes from the `Id` attribute.
    const idAttr = attributes.find((a) => a.key === "Id");
    id = idAttr?.value;
  }

  // Body requirement: non-reference entries require body. If there's only
  // one child (the title paragraph) and no further content, accept only
  // reference entries.
  if (family !== "reference" && item.children.length < 2) return undefined;

  // Source location
  const line = item.position?.start.line ?? 1;
  const column = item.position?.start.column ?? 1;

  return {
    displayId,
    title: title ?? "",
    body,
    attributes,
    typedAttributes: collateAttributes(attributes),
    id,
    entryType,
    family,
    location: { file, line, column },
    source: "markdown",
    properties: { file: { path: file, line, column } },
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
