/**
 * @module parser/markdown
 *
 * CommonMark + MarkSpec extension parser. Walks the mdast AST to detect
 * `- [DISPLAY_ID] Title` entry blocks and extract structured attributes.
 */

import type { Definition, List, ListItem, Paragraph, Text } from "mdast";
import type { Attribute, Diagnostic, Entry, EntryShape } from "../model/mod.ts";
import {
  CORE_RELATIONS,
  IDENTITY_KEY,
  LOCK_EXTRA_INVERSE_KEYS,
  makeDisplayId,
  shapeFromIdValue,
  UNIVERSAL_ATTRIBUTE_KEYS,
} from "../model/mod.ts";
import {
  ATTR_LINE_RE,
  collateAttributes,
  parseAttributes,
  splitBodyAndAttributes,
} from "./attributes.ts";
import { extractBodyTokens } from "./body_tokens.ts";
import { processor } from "./remark.ts";
import { buildBodyAstWithTree } from "../ast/build.ts";
import type { LineMap } from "./line_map.ts";
import { translateEntryLocations } from "./translate.ts";
import {
  bridgeTyplDiagnostic,
  extractTyplBullets,
  extractTyplFences,
  extractTyplInlines,
  parseTyplBlock,
  type TyplBlock,
} from "../typl/mod.ts";

/**
 * Canonical set of trailer attribute keys the core recognizes: the union of
 * every universal attribute, every core trace relation, and the extra inverse
 * lock key (`Verified-by`). MSL-P020 (misplaced trailer) fires only when a
 * body line's key is in this set; any other capitalized `Word:` lead-in
 * (`Note:`, `Example:`, `Assumption:`) is prose, not a misplaced trailer (#654).
 */
const RECOGNIZED_TRAILER_KEYS: ReadonlySet<string> = new Set([
  ...UNIVERSAL_ATTRIBUTE_KEYS,
  ...CORE_RELATIONS.map((r) => r.attr),
  ...LOCK_EXTRA_INVERSE_KEYS,
]);

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
  /**
   * When supplied, every `SourceLocation` emitted by this parse — on
   * entries, on `bodyAst` ranges, on `bodyTokens` — is translated through
   * this map before being returned. Used by `parseSource` to convert
   * doc-comment-buffer coordinates to file coordinates. See ADR-016
   * Decision 6.
   */
  readonly lineMap?: LineMap;
}

/**
 * Slug pattern for referenced-entry display IDs.
 *
 * Pandoc/BibTeX cite-key convention, restricted to a portable character set
 * (`.`, `/`, `_`, `-` accepted inside; must start with a letter and end
 * with an alphanumeric).
 */
const SLUG_RE = /^[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?$/;

/**
 * Match `[...]` at the start of a list item paragraph. Captures:
 * [1] = display ID, [2] = title.
 *
 * The title group is `[\s\S]*` (not `.*`) so a title that soft-wraps onto
 * a second physical line is still captured — remark keeps a soft-wrapped
 * paragraph as one text node with an embedded `\n`, which `.` would not
 * cross, leaving the entry silently undetected (#686). {@linkcode collapseTitle}
 * then folds the wrapped title back to a single logical line.
 */
const ENTRY_START_RE = /^\[([^\]]+)\]\s*([\s\S]*)$/;

/** Match `[]` at the start — empty brackets. */
const EMPTY_BRACKET_RE = /^\[\]\s*(.*)$/;

/** Match `[` at the start without a closing `]` on the same logical content — unterminated. */
const UNTERMINATED_BRACKET_RE = /^\[[^\]]*$/;

/**
 * Fold a title that may span multiple soft-wrapped physical lines (one
 * Markdown paragraph) into a single logical line: every run of whitespace
 * — including the embedded newlines remark preserves inside the paragraph
 * text node — collapses to a single space, matching how a soft-wrapped
 * line renders (#686).
 */
function collapseTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

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

  // Pre-split once so every extractBodyContent call shares the same array
  // instead of re-splitting for each list item (O(N×L) → O(N+L)).
  const markdownLines = markdown.split("\n");

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
        markdownLines,
        file,
        definitions,
        isReferencesDoc,
        diagnostics,
        !!options?.lineMap,
      );
      if (entry) entries.push(entry);
    }
  }

  const finalEntries = options?.lineMap
    ? translateEntryLocations(entries, options.lineMap)
    : entries;
  return { entries: finalEntries, diagnostics };
}

/**
 * Resolve whether this is a references document.
 *
 * The caller (`parseFile` in `parser/mod.ts`) always passes an explicit
 * value computed via the canonical `isReferencesDocument` helper, so the
 * auto-detection fallback is never needed here.
 */
function detectReferencesDocument(
  _file: string,
  explicit: boolean | undefined,
): boolean {
  return explicit ?? false;
}

/**
 * Attempt to extract a MarkSpec entry from a list item.
 * Returns undefined if the list item is not an entry block.
 * Diagnostics (e.g., deprecation warnings) are pushed into the accumulator.
 */
function extractEntry(
  item: ListItem,
  markdownLines: string[],
  file: string,
  definitions: Set<string>,
  isReferencesDoc: boolean,
  diagnostics: Diagnostic[],
  _hasLineMap = false,
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
    const textValue = (firstInline as Text).value;
    const match = ENTRY_START_RE.exec(textValue);
    if (match) {
      displayId = match[1];
      title = collapseTitle(match[2]);
    } else if (EMPTY_BRACKET_RE.test(textValue)) {
      // MSL-P001: bracketed content is empty — `- [] Title`
      const entryLine = item.position?.start.line ?? 1;
      diagnostics.push({
        code: "MSL-P001",
        severity: "error",
        message:
          "list item starts with `[]` but the bracketed content is empty " +
          "(spec section 4.1)",
        location: { file, line: entryLine, column: 1 },
      });
      return undefined;
    } else if (UNTERMINATED_BRACKET_RE.test(textValue)) {
      // MSL-P003: display-ID brackets unterminated (missing `]`)
      const entryLine = item.position?.start.line ?? 1;
      diagnostics.push({
        code: "MSL-P003",
        severity: "error",
        message:
          "display-ID brackets unterminated -- missing `]` before end of " +
          "title line (spec section 4.1)",
        location: { file, line: entryLine, column: 1 },
      });
      return undefined;
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
      title = collapseTitle(
        rest
          .filter((n): n is Text => n.type === "text")
          .map((n) => n.value)
          .join(""),
      );
    }
  }

  if (!displayId) return undefined;

  // Strip optional leading `@` on referenced-entry display IDs for Pandoc
  // citation compatibility. Canonical slug never contains `@`.
  if (displayId.startsWith("@")) displayId = displayId.slice(1);

  // MSL-I005: Display ID is empty (after `@` stripping).
  if (displayId.length === 0) {
    const entryLine = item.position?.start.line ?? 1;
    diagnostics.push({
      code: "MSL-I005",
      severity: "error",
      message: "display ID is empty (spec section 4.2)",
      location: { file, line: entryLine, column: 1 },
    });
    return undefined;
  }

  // MSL-P002: title text missing after `]`. The title capture is empty
  // and was not populated from subsequent nodes (linkReference path sets
  // title from rest nodes).
  if (title !== undefined && title.length === 0) {
    const entryLine = item.position?.start.line ?? 1;
    diagnostics.push({
      code: "MSL-P002",
      severity: "error",
      message:
        `${displayId}: title line missing title text after ']' (spec section 4.1)`,
      location: { file, line: entryLine, column: 1 },
    });
    // Continue parsing — entry is still structurally valid for downstream
    // validation (MSL-P010 also fires from the validator for empty titles).
  }

  // Extract body content and attributes.
  const bodyContent = extractBodyContent(item, markdownLines);
  const [body, attrLines] = splitBodyAndAttributes(bodyContent);
  const attributes = parseAttributes(attrLines);
  const { blocks: bodyAst, tree: mdastTree } = buildBodyAstWithTree(body);

  const entryLine = item.position?.start.line ?? 1;

  // MSL-P020: trailers block is not the final indented code block.
  // Detect `Key: Value` lines in the body that likely should be trailers
  // but are not at the final position (body content follows them). Only lines
  // whose key is a recognized trailer attribute count — see
  // RECOGNIZED_TRAILER_KEYS — so ordinary prose (`Note:`, `Example:`) and
  // caption lead-ins (`Figure:`, `Table:`) are left as legitimate body content.
  if (body.length > 0) {
    const bodyLines = body.split("\n");
    let inFencedBlock = false;
    for (let i = 0; i < bodyLines.length; i++) {
      const trimmed = bodyLines[i].trim();
      // Track fenced code blocks (``` or ~~~) to skip their contents
      if (/^(`{3,}|~{3,})/.test(trimmed)) {
        inFencedBlock = !inFencedBlock;
        continue;
      }
      if (inFencedBlock) continue;
      if (!ATTR_LINE_RE.test(trimmed)) continue;
      // Only a RECOGNIZED trailer key signals a genuinely misplaced trailer.
      // A body paragraph starting with any other capitalized word + colon
      // (`Note:`, `Example:`, `Assumption:`) is prose, not a trailer (#654).
      const keyMatch = trimmed.match(/^([A-Z][A-Za-z-]*):/);
      if (!keyMatch || !RECOGNIZED_TRAILER_KEYS.has(keyMatch[1])) continue;
      // Found a misplaced trailer-like line in the body — non-final position
      diagnostics.push({
        code: "MSL-P020",
        severity: "error",
        message:
          `${displayId}: trailers block is not the final indented code ` +
          `block of the entry -- content appears after trailer-like ` +
          `lines (spec section 4.1)`,
        location: { file, line: entryLine, column: 1 },
      });
      break; // One diagnostic per entry is sufficient
    }
  }

  // MSL-P021 / MSL-P022: validate trailer lines for syntax correctness.
  // The trailer block is the final indented code block. Lines within it
  // should all match `Key: Value` syntax. We check both the parsed
  // attrLines AND the trailing body lines that might be in a code block
  // but failed ATTR_LINE_RE (thus stayed in the body).
  const TRAILER_KEY_RE = /^[A-Za-z][A-Za-z0-9-]*$/;
  const COLON_SPLIT_RE = /^([^:]+):\s*(.*)$/;

  // Check lines that DID end up in attrLines but might have key issues
  for (const rawLine of attrLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (!ATTR_LINE_RE.test(trimmed)) {
      const colonMatch = COLON_SPLIT_RE.exec(trimmed);
      if (colonMatch) {
        const key = colonMatch[1].trim();
        if (!TRAILER_KEY_RE.test(key)) {
          diagnostics.push({
            code: "MSL-P022",
            severity: "error",
            message: `${displayId}: trailer key '${key}' contains characters ` +
              `outside [A-Za-z][A-Za-z0-9-]* (spec section 4.1)`,
            location: { file, line: entryLine, column: 1 },
          });
        } else {
          diagnostics.push({
            code: "MSL-P021",
            severity: "error",
            message: `${displayId}: trailer line does not match 'Key: Value' ` +
              `syntax (spec section 4.1): "${trimmed}"`,
            location: { file, line: entryLine, column: 1 },
          });
        }
      } else {
        diagnostics.push({
          code: "MSL-P021",
          severity: "error",
          message: `${displayId}: trailer line does not match 'Key: Value' ` +
            `syntax (spec section 4.1): "${trimmed}"`,
          location: { file, line: entryLine, column: 1 },
        });
      }
    }
  }

  // Also scan trailing body lines for suspected misplaced trailers.
  // If the body's last non-empty lines look like they belong to an
  // indented code block with colon-separated content that has invalid
  // keys, emit P022. Lines without colons that appear in what looks
  // like a trailer block emit P021.
  if (body.length > 0) {
    const bodyLines = body.split("\n");
    // Walk backward from the end of the body to find lines in a trailing
    // code-block-like region that have colons (suspected trailers).
    for (let i = bodyLines.length - 1; i >= 0; i--) {
      const trimmed = bodyLines[i].trim();
      if (!trimmed) continue; // skip trailing blanks
      const colonMatch = COLON_SPLIT_RE.exec(trimmed);
      if (!colonMatch) break; // stop at non-colon line
      const key = colonMatch[1].trim();
      // A genuine trailer key is a single token; it never contains internal
      // whitespace or a pipe. A colon inside prose ("modes are: fast") or a
      // Markdown table row ("| Fast | latency: 200ms |") is body content, not
      // a malformed trailer — stop scanning at it (#648).
      if (/[\s|]/.test(key)) break;
      if (ATTR_LINE_RE.test(trimmed)) {
        // Valid attr line in body → already caught by P020
        continue;
      }
      if (!TRAILER_KEY_RE.test(key)) {
        diagnostics.push({
          code: "MSL-P022",
          severity: "error",
          message: `${displayId}: trailer key '${key}' contains characters ` +
            `outside [A-Za-z][A-Za-z0-9-]* (spec section 4.1)`,
          location: { file, line: entryLine, column: 1 },
        });
      } else if (colonMatch[2].trim().length === 0) {
        diagnostics.push({
          code: "MSL-P021",
          severity: "error",
          message: `${displayId}: trailer line does not match 'Key: Value' ` +
            `syntax (spec section 4.1): "${trimmed}"`,
          location: { file, line: entryLine, column: 1 },
        });
      }
      break; // one diagnostic per trailing suspect line is sufficient
    }
  }

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
      shape = "Authored";
    }
  } else {
    // No `Id:`. Fall back on display-ID shape + document context to decide
    // whether to admit the entry at all.
    if (isReferencesDoc && SLUG_RE.test(displayId)) {
      shape = "Reference";
    } else {
      // No identity attribute and no references-doc context — admit as
      // identified so the validator can surface the missing-`Id:` error.
      shape = "Authored";
    }
  }

  // Inferred type from display-ID prefix — left to the profile layer. For
  // now the core records no type; downstream profile-aware code populates
  // this field when a profile is loaded.
  const type: string | undefined = undefined;

  // MSL-P030: Authored entry has no body block (title + trailers only).
  // For Reference shape, body is optional (ADR-002 section Part 3). For Authored,
  // the body is required. We also emit P030 when the body is empty (all
  // content was consumed as attributes).
  if (shape === "Authored" && body.trim().length === 0) {
    diagnostics.push({
      code: "MSL-P030",
      severity: "error",
      message:
        `${displayId}: Authored entry has no body block -- entries must ` +
        `have body content between title and trailers (spec section 4.1)`,
      location: { file, line: entryLine, column: 1 },
    });
  }

  // Body requirement: identified entries require a body; referenced entries
  // may omit it. If there's only one child (the title paragraph), admit
  // only referenced entries.
  if (shape !== "Reference" && item.children.length < 2) return undefined;

  // Source location
  const line = item.position?.start.line ?? 1;
  const column = item.position?.start.column ?? 1;

  const entryLocation = { file, line, column };

  // Inline-construct tokens (ADR-016). Reuses the already-built bodyAst to
  // avoid a redundant mdast parse.
  //
  // bodyStartLine: use the mdast position of the second child (the body
  // paragraph) — the actual buffer line where the body starts. CommonMark
  // loose lists have a blank line between title and body, so the body is at
  // (entry_line + 2), not (entry_line + 1).
  //
  // columnOffset: body text has been stripped of the list-item indent (e.g.,
  // "  " for column-1 items), so each token column must be bumped by that
  // indent width. The + 2 accounts for the "  " continuation indent
  // prepended by wrapAsListItem to every non-title line.
  const bodyIndent = (item.position?.start.column ?? 1) - 1 + 2;
  const bodyStartLine = item.children[1]?.position?.start.line ?? (line + 1);
  const bodyTokens = extractBodyTokens(
    body,
    bodyAst,
    {
      file,
      line: bodyStartLine,
      column: 1,
    },
    bodyIndent,
    mdastTree,
  );

  // Extract typl declarations from all three surfaces in the body:
  // (1) ```typl fences, (2) bullet-glossary items, (3) inline code spans.
  // Per-surface diagnostics are bridged to file-relative positions and
  // pushed into the parser's diagnostic stream. Cross-entry collision
  // detection lands in a later PR; this PR aggregates all intra-entry
  // bindings + typedefs from every surface.
  let types: TyplBlock | undefined;
  const allBindings: TyplBlock["bindings"][number][] = [];
  const allTypedefs: TyplBlock["typedefs"][number][] = [];

  for (const fence of extractTyplFences(bodyAst)) {
    const result = parseTyplBlock(fence.source);
    allBindings.push(...result.ast.bindings);
    allTypedefs.push(...result.ast.typedefs);
    // Fence content starts on the line AFTER the opening ```, so the
    // bridge offset is the file line of the opening fence.
    const fenceFileStartLine = bodyStartLine + fence.range.start.line - 1;
    for (const td of result.diagnostics) {
      diagnostics.push(bridgeTyplDiagnostic(td, file, fenceFileStartLine));
    }
  }

  for (const bullet of extractTyplBullets(bodyAst)) {
    const result = parseTyplBlock(bullet.source);
    allBindings.push(...result.ast.bindings);
    allTypedefs.push(...result.ast.typedefs);
    // A bullet item IS the typl content (single line). The bridge
    // computes line as `offset + diag.position.line`; we want diag
    // position.line 1 to map to the item's file line, so offset is
    // `itemFileLine - 1` = `bodyStartLine + bullet.range.start.line - 2`.
    const bulletFileOffset = bodyStartLine + bullet.range.start.line - 2;
    for (const td of result.diagnostics) {
      diagnostics.push(bridgeTyplDiagnostic(td, file, bulletFileOffset));
    }
  }

  for (const inline of extractTyplInlines(bodyTokens)) {
    const result = parseTyplBlock(inline.source);
    allBindings.push(...result.ast.bindings);
    allTypedefs.push(...result.ast.typedefs);
    // inline.location is already file-relative (translated by the
    // bodyTokens extractor). The bridge computes file line as
    // `offset + diag.position.line`; for inline content where
    // diag.position.line is 1 (single-line span), offset is
    // `inline.location.line - 1`.
    const inlineFileOffset = inline.location.line - 1;
    for (const td of result.diagnostics) {
      diagnostics.push(
        bridgeTyplDiagnostic(td, inline.location.file, inlineFileOffset),
      );
    }
  }

  if (allBindings.length > 0 || allTypedefs.length > 0) {
    types = { bindings: allBindings, typedefs: allTypedefs };
  }

  return {
    displayId: makeDisplayId(displayId),
    title: title ?? "",
    body,
    bodyAst,
    rawAttributes: attributes,
    typedAttributes: collateAttributes(attributes),
    id,
    type,
    shape,
    location: entryLocation,
    bodyStartLine,
    source: { kind: "markdown" },
    properties: { file: { path: file, line, column } },
    bodyTokens,
    ...(types ? { types } : {}),
  };
}

/**
 * Extract body content from a list item's children (excluding the first paragraph
 * which contains the display ID and title).
 *
 * Reconstructs the text content from the source markdown using position info.
 * Accepts a pre-split lines array to avoid redundant splits across entries.
 */
function extractBodyContent(item: ListItem, lines: string[]): string {
  const children = item.children.slice(1); // Skip title paragraph
  if (!children.length) return "";

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
