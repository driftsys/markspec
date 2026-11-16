/**
 * @module lsp/document_links
 *
 * Pure helper for the LSP `textDocument/documentLink` handler. `Source` is a
 * single-valued attribute, so each entry yields at most one link: the whole
 * trimmed value is one token that is either an `http(s)://` URI or a file path
 * with an optional `:<line>[:<col>]` suffix.
 *
 * The line of each `Source:` value comes from the parser
 * (`Entry.rawAttributes` + `Entry.attributeLines`), not from a text scan. This
 * covers Markdown trailers and source doc comments (`///`, `*`), and never
 * links a line that is outside an entry's trailer or inside a code fence.
 *
 * The link **range** covers the URI, or the path without the line suffix. The
 * link **target** is the value itself for a URI, or the URI returned by
 * `resolveTarget` for a path.
 */

import { type Entry, isCorpusEntry } from "../core/mod.ts";

/** A subset of the LSP `DocumentLink` interface. */
export interface DocumentLink {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  readonly target: string;
}

/** A value that is an `http(s)://` URI, linked as is. */
const URI_VALUE_RE = /^https?:\/\/\S+$/i;

/** An optional trailing `:<line>[:<col>]` suffix, digits only. */
const LINE_SUFFIX_RE = /:(\d+)(?::\d+)?$/;

/**
 * Build the `DocumentLink[]` for a document.
 *
 * @param entries — entries declared in the document the client requested
 *   links for. Entries that carry an `origin` (delivered corpus, upstream)
 *   are skipped.
 * @param text — the full text of the document. Used to locate the value's
 *   column on its line.
 * @param resolveTarget — `(path, lineSuffix?) => uri | undefined`.
 *   Resolves a path to a `file://` URI, appending `#L<lineSuffix>` when
 *   `lineSuffix` is a number. Returns `undefined` to suppress the link (for
 *   example when the file does not exist). Keeping the resolver injected
 *   keeps the helper free of I/O.
 */
export function buildDocumentLinks(
  entries: readonly Entry[],
  text: string,
  resolveTarget: (
    path: string,
    lineSuffix: number | undefined,
  ) => string | undefined,
): DocumentLink[] {
  const lines = text.split("\n");
  const out: DocumentLink[] = [];
  for (const entry of entries) {
    // Delivered-corpus and upstream entries are read-only and their paths
    // are not local (ADR-030), so they get no links.
    if (isCorpusEntry(entry)) continue;
    const attributeLines = entry.attributeLines;
    if (!attributeLines) continue;
    entry.rawAttributes.forEach((attr, n) => {
      const fileLine = attributeLines[n];
      if (attr.key !== "Source" || fileLine === undefined) return;
      const value = attr.value.trim();
      if (value.length === 0) return;
      const lineText = lines[fileLine - 1]?.replace(/\r$/, "");
      if (lineText === undefined) return;
      const keyAt = lineText.search(/Source\s*:/);
      const column = keyAt < 0 ? -1 : lineText.indexOf(value, keyAt);
      if (column < 0) return;

      let target: string | undefined;
      let length = value.length;
      if (URI_VALUE_RE.test(value)) {
        target = value;
      } else {
        const suffix = LINE_SUFFIX_RE.exec(value);
        const path = suffix ? value.slice(0, suffix.index) : value;
        if (path.length === 0) return;
        target = resolveTarget(path, suffix ? Number(suffix[1]) : undefined);
        length = path.length;
      }
      if (target === undefined) return;
      out.push({
        range: {
          start: { line: fileLine - 1, character: column },
          end: { line: fileLine - 1, character: column + length },
        },
        target,
      });
    });
  }
  return out;
}
