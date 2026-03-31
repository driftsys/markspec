/**
 * @module render/typst/template
 *
 * Generates Typst source documents from preprocessed Markdown content
 * and project metadata. The generated document uses cmarker for
 * CommonMark-to-Typst conversion and the markspec-doc template for
 * page layout and typography. Entry blocks are rendered as structured
 * `req-block` calls with admonition-style left borders.
 */

import type { Entry } from "../../core/mod.ts";

/** Metadata for the generated Typst document. */
export interface DocumentMetadata {
  readonly title?: string;
  readonly project?: string;
  readonly version?: string;
  readonly date?: string;
  readonly classification?: string;
}

/**
 * Generate a complete Typst document from preprocessed Markdown.
 *
 * When entries are provided, the markdown is split at entry block
 * boundaries: prose segments are rendered via cmarker, and entry
 * blocks are rendered as structured `req-block` Typst calls.
 *
 * @param markdown - Preprocessed Markdown content
 * @param metadata - Document metadata
 * @param entries - Parsed entries with position info (optional)
 */
export function generateTypstDocument(
  markdown: string,
  metadata: DocumentMetadata = {},
  entries: readonly Entry[] = [],
): string {
  const metaArgs = buildMetaArgs(metadata);
  const imports = `#import "lib.typ": markspec-doc, req-block, entry-category
#import "vendor/cmarker/lib.typ": render
#import "themes/light.typ" as theme`;

  const showRule = `#show: markspec-doc.with(${metaArgs})`;

  if (entries.length === 0) {
    const escaped = escapeTypstString(markdown);
    return `${imports}\n\n${showRule}\n\n#render("${escaped}")\n`;
  }

  const segments = spliceEntries(markdown, entries);
  const body = segments.map((seg) => {
    if (seg.kind === "prose") {
      if (seg.content.trim() === "") return "";
      return `#render("${escapeTypstString(seg.content)}")`;
    }
    return renderEntryTypst(seg.entry);
  }).filter((s) => s !== "").join("\n\n");

  return `${imports}\n\n${showRule}\n\n${body}\n`;
}

/** A segment of the document: either prose or an entry block. */
interface ProseSegment {
  readonly kind: "prose";
  readonly content: string;
}

interface EntrySegment {
  readonly kind: "entry";
  readonly entry: Entry;
}

type Segment = ProseSegment | EntrySegment;

/**
 * Split markdown into alternating prose and entry segments using
 * entry position info (line numbers).
 */
function spliceEntries(
  markdown: string,
  entries: readonly Entry[],
): Segment[] {
  const lines = markdown.split("\n");

  // Sort entries by line number
  const sorted = [...entries]
    .filter((e) => e.source === "markdown")
    .sort((a, b) => a.location.line - b.location.line);

  if (sorted.length === 0) {
    return [{ kind: "prose", content: markdown }];
  }

  const segments: Segment[] = [];
  let cursor = 0; // 0-based line index

  for (const entry of sorted) {
    const entryStart = entry.location.line - 1; // convert to 0-based

    // Find entry end: scan forward for the end of the list item.
    // Entry items end when we hit a line that is not indented (not part
    // of the list item continuation) or end of file.
    const entryEnd = findEntryEnd(lines, entryStart);

    // Prose before this entry
    if (entryStart > cursor) {
      const prose = lines.slice(cursor, entryStart).join("\n");
      segments.push({ kind: "prose", content: prose });
    }

    segments.push({ kind: "entry", entry });
    cursor = entryEnd;
  }

  // Trailing prose
  if (cursor < lines.length) {
    const prose = lines.slice(cursor).join("\n");
    segments.push({ kind: "prose", content: prose });
  }

  return segments;
}

/**
 * Find the end line index (exclusive, 0-based) of an entry list item
 * starting at `start`.
 */
function findEntryEnd(lines: readonly string[], start: number): number {
  // The first line is the `- [ID] Title` line.
  // Subsequent lines belong to the entry if they are:
  // - blank, or
  // - indented (continuation of the list item body)
  // The entry ends at the first non-blank, non-indented line, or at
  // another top-level list item (`- `).
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    // Blank line might be internal to the entry — peek ahead
    if (line.trim() === "") {
      // If next non-blank line is indented, this blank is internal
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j < lines.length && /^\s{2,}/.test(lines[j])) {
        i = j;
        continue;
      }
      // Otherwise this blank ends the entry
      i++;
      break;
    }
    // Indented continuation
    if (/^\s{2,}/.test(line)) {
      i++;
      continue;
    }
    // Non-indented, non-blank — entry is over
    break;
  }
  return i;
}

/**
 * Map entry type prefix to the color category used by req-block.
 */
function entryTypeCategory(entryType: string | undefined): string {
  if (!entryType) return "req";
  if (["ARC", "SAD", "ICD"].includes(entryType)) return "spec";
  if (["TST", "VAL", "SIT", "SWT"].includes(entryType)) return "test";
  return "req";
}

/** Render a single entry as a Typst `req-block` call. */
function renderEntryTypst(entry: Entry): string {
  const category = entryTypeCategory(entry.entryType);

  // Extract labels from attributes
  const labelsAttr = entry.attributes.find((a) => a.key === "Labels");
  const labels = labelsAttr
    ? labelsAttr.value.split(",").map((s) => s.trim()).filter((s) =>
      s.length > 0
    )
    : [];

  // Build attrs array (excluding Labels — those go into pills)
  const attrs = entry.attributes
    .filter((a) => a.key !== "Labels")
    .map((a) =>
      `("${escapeTypstString(a.key)}", "${escapeTypstString(a.value)}")`
    );

  const labelsTypst = labels.map((l) => `"${escapeTypstString(l)}"`);

  // Escape body content
  const bodyEscaped = escapeTypstString(entry.body);

  // Always use trailing comma so Typst treats single-element arrays correctly.
  // Without it, `(expr)` is just parenthesised `expr`, not a 1-element array.
  const attrsStr = attrs.length > 0 ? `(${attrs.join(", ")},)` : "()";
  const labelsStr = labelsTypst.length > 0
    ? `(${labelsTypst.join(", ")},)`
    : "()";

  return `#req-block(
  type: "${category}",
  display-id: "${escapeTypstString(entry.displayId)}",
  title: "${escapeTypstString(entry.title)}",
  body: render("${bodyEscaped}"),
  attrs: ${attrsStr},
  labels: ${labelsStr},
  theme: theme,
)`;
}

/** Escape a string for use inside a Typst double-quoted string literal. */
function escapeTypstString(s: string): string {
  return s
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "")
    .replaceAll("\t", "\\t");
}

/** Build the keyword argument list for markspec-doc.with(). */
function buildMetaArgs(metadata: DocumentMetadata): string {
  const args: string[] = [];

  if (metadata.title !== undefined) {
    args.push(`title: "${escapeTypstString(metadata.title)}"`);
  }
  if (metadata.project !== undefined) {
    args.push(`project: "${escapeTypstString(metadata.project)}"`);
  }
  if (metadata.version !== undefined) {
    args.push(`version: "${escapeTypstString(metadata.version)}"`);
  }
  if (metadata.date !== undefined) {
    args.push(
      `date: datetime(year: ${metadata.date.slice(0, 4)}, month: ${
        parseInt(metadata.date.slice(5, 7), 10)
      }, day: ${parseInt(metadata.date.slice(8, 10), 10)})`,
    );
  }
  if (metadata.classification !== undefined) {
    args.push(
      `classification: "${escapeTypstString(metadata.classification)}"`,
    );
  }

  return args.join(", ");
}
