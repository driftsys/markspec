/**
 * @module render/typst/template
 *
 * Generates Typst source documents from preprocessed Markdown content
 * and project metadata. The generated document uses cmarker for
 * CommonMark-to-Typst conversion and the markspec-doc template for
 * page layout and typography.
 */

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
 * The output imports the markspec-doc template and cmarker, applies
 * the document show rule with metadata, and renders the Markdown
 * content via cmarker.
 */
export function generateTypstDocument(
  markdown: string,
  metadata: DocumentMetadata = {},
): string {
  const escaped = escapeTypstString(markdown);
  const metaArgs = buildMetaArgs(metadata);

  return `#import "lib.typ": markspec-doc
#import "vendor/cmarker/lib.typ": render

#show: markspec-doc.with(${metaArgs})

#render("${escaped}")
`;
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
