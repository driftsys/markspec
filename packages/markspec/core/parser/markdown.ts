/**
 * @module parser/markdown
 *
 * CommonMark + MarkSpec extension parser. Walks the mdast AST to detect
 * `- [DISPLAY_ID] Title` entry blocks and extract structured attributes.
 */

import type { Definition, List, ListItem, Paragraph, Text } from "mdast";
import type { Attribute, Diagnostic, Entry, EntryShape } from "../model/mod.ts";
import { IDENTITY_KEY, shapeFromIdValue } from "../model/mod.ts";
import {
  collateAttributes,
  parseAttributes,
  splitBodyAndAttributes,
} from "./attributes.ts";
import { extractEntityRefs } from "./entity_refs.ts";
import { processor } from "./remark.ts";
import { buildBodyAst } from "../ast/build.ts";

/** Options for {@linkcode parseMarkdown}. */
export interface ParseMarkdownOptions {
  /** File path used in source locations. */
  readonly file?: string;
  /**
   * Is this a references document? If undefined, auto-detect from file path.
   * When true, `[slug]` items without an `Id:` attribute are still admitted
   * as referenced-entry candidates (the validator flags the missing `Id:`).
   */
  readonly isReferencesDoc?: boolean;
}

/**
 * Slug pattern for referenced-entry display IDs.
 *
 * Pandoc/BibTeX cite-key convention, restricted to a portable character set
 * (`.`, `/`, `_`, `-` accepted inside; must start with a letter and end
 * with an alphanumeric).
 */
const SLUG_RE = /^[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?$/;

/** Match `[...]` at the start of a list item paragraph. Captures: [1] = display ID, [2] = title. */
const ENTRY_START_RE = /^\[([^\]]+)\]\s*(.*)$/;

/**
 * Find the `Id:` attribute on an entry. Returns undefined when absent. If
 * more than one `Id:` is present, returns the first — the validator flags
 * this as MSL-R003.
 */
function findIdentityAttribute(
  attributes: readonly Attribute[],
): Attribute | undefined {
  for (const attr of attributes) {
    if (attr.key === IDENTITY_KEY) return attr;
  }
  return undefined;
}

/** Result returned by {@linkcode parseMarkdown}. */
export interface ParseMarkdownResult {
  /** Parsed entries found in the Markdown source. */
  readonly entries: Entry[];
  /** Parse-level diagnostics (e.g., deprecation warnings). */
  readonly diagnostics: Diagnostic[];
}

/**
 * Parse a Markdown string and return all MarkSpec entries found.
 *
 * Walks the mdast AST to detect `- [DISPLAY_ID] Title` list items with
 * indented body content. Extracts display ID, title, body, and trailing
 * attribute blocks. Entry shape (identified or referenced) is decided by
 * the `Id:` attribute's value format.
 *
 * @param markdown - Markdown source text
 * @param options - Parse options (file path for source locations)
 * @returns Parsed entries and any parse-level diagnostics
 */
export function parseMarkdown(
  markdown: string,
  options?: ParseMarkdownOptions,
): ParseMarkdownResult {
  const file = options?.file ?? "<unknown>";
  const isReferencesDoc = detectReferencesDocument(
    file,
    options?.isReferencesDoc,
  );
  const tree = processor.parse(markdown);
  const entries: Entry[] = [];
  const diagnostics: Diagnostic[] = [];

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
        diagnostics,
      );
      if (entry) entries.push(entry);
    }
  }

  return { entries, diagnostics };
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
 * Diagnostics (e.g., deprecation warnings) are pushed into the accumulator.
 */
function extractEntry(
  item: ListItem,
  markdown: string,
  file: string,
  definitions: Set<string>,
  isReferencesDoc: boolean,
  diagnostics: Diagnostic[],
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

  // Strip optional leading `@` on referenced-entry display IDs for Pandoc
  // citation compatibility. Canonical slug never contains `@`.
  if (displayId.startsWith("@")) displayId = displayId.slice(1);

  // Extract body content and attributes.
  const bodyContent = extractBodyContent(item, markdown);
  const [body, attrLines] = splitBodyAndAttributes(bodyContent);
  const attributes = parseAttributes(attrLines);
  const bodyAst = buildBodyAst(body);

  // Detect legacy paragraph + trailing-backslash attribute form and warn.
  if (
    attributes.length > 0 &&
    attrLines.some((line) => line.trimEnd().endsWith("\\"))
  ) {
    const entryLine = item.position?.start.line ?? 1;
    diagnostics.push({
      code: "MSL-DEPRECATED-ATTR-001",
      severity: "warning",
      message:
        "legacy attribute block (paragraph with trailing `\\`) is deprecated; " +
        "run `markspec format` to convert to the canonical indented code block",
      location: { file, line: entryLine, column: 1 },
    });
  }

  // Discriminate shape by the `Id:` attribute's value format.
  let shape: EntryShape | undefined;
  let id: string | undefined;

  const identityAttr = findIdentityAttribute(attributes);
  if (identityAttr) {
    id = identityAttr.value;
    shape = shapeFromIdValue(identityAttr.value);
    if (shape === undefined) {
      // `Id:` is neither a ULID nor a scheme-qualified URI. Accept as an
      // identified entry so the validator can surface MSL-R004; missing
      // shape on a parsed entry is not useful downstream.
      shape = "identified";
    }
  } else {
    // No `Id:`. Fall back on display-ID shape + document context to decide
    // whether to admit the entry at all.
    if (isReferencesDoc && SLUG_RE.test(displayId)) {
      shape = "referenced";
    } else {
      // No identity attribute and no references-doc context — admit as
      // identified so the validator can surface the missing-`Id:` error.
      shape = "identified";
    }
  }

  // Inferred type from display-ID prefix — left to the profile layer. For
  // now the core records no type; downstream profile-aware code populates
  // this field when a profile is loaded.
  const type: string | undefined = undefined;

  // Body requirement: identified entries require a body; referenced entries
  // may omit it. If there's only one child (the title paragraph), admit
  // only referenced entries.
  if (shape !== "referenced" && item.children.length < 2) return undefined;

  // Source location
  const line = item.position?.start.line ?? 1;
  const column = item.position?.start.column ?? 1;

  const entryLocation = { file, line, column };

  // Inline `$Identifier` entity references (spec §2.5.2). Resolution
  // into the project's entity registry is left to the validator's
  // marker pass; the parser only emits the lexical hits.
  const entityRefs = extractEntityRefs(body, {
    file,
    // Body content starts on the line after the title; +1 keeps
    // emitted line numbers 1-based relative to the file.
    line: line + 1,
    column: 1,
  });

  return {
    displayId,
    title: title ?? "",
    body,
    bodyAst,
    rawAttributes: attributes,
    typedAttributes: collateAttributes(attributes),
    id,
    type,
    shape,
    location: entryLocation,
    source: "markdown",
    properties: { file: { path: file, line, column } },
    entityRefs: entityRefs.length > 0 ? entityRefs : undefined,
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
