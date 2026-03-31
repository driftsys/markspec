/**
 * @module render
 *
 * Rendering subsystem — converts preprocessed Markdown to PDF via
 * Typst. Uses cmarker for CommonMark-to-Typst conversion and the
 * markspec-doc template for page layout and IBM Plex typography.
 *
 * This module is lazy-imported by CLI commands that produce rendered
 * output (doc build, book build). It is never loaded by parse,
 * validate, or compile commands.
 */

import type { CompileResult, Diagnostic, ProjectConfig } from "../core/mod.ts";
import { parse } from "../core/mod.ts";
import { generateTypstDocument } from "./typst/template.ts";
import type { DocumentMetadata } from "./typst/template.ts";
import { compileTypst } from "./typst/mod.ts";
import type { TypstDiagnostic } from "./typst/mod.ts";
import { join } from "@std/path";

/** Options for rendering a Markdown document. */
export interface RenderOptions {
  /** Compiled project model for resolving references. */
  readonly compiled: CompileResult;
  /** Project configuration from project.yaml. */
  readonly config: ProjectConfig;
  /**
   * Absolute path to the markspec-typst package directory.
   * Contains lib.typ, fonts/, and vendor/cmarker/.
   */
  readonly typstPackagePath: string;
}

/** Result of a render operation. */
export interface RenderResult {
  /** PDF bytes. Empty if compilation failed. */
  readonly output: Uint8Array;
  /** Diagnostics from rendering. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Render a Markdown document to PDF.
 *
 * Generates a Typst document from the Markdown content using
 * the markspec-doc template and cmarker, then compiles it to PDF
 * via the Typst compiler.
 *
 * @param markdown - Preprocessed Markdown content
 * @param options - Render options with compiled model and config
 * @returns PDF bytes and diagnostics
 */
export function renderPdf(
  markdown: string,
  options: RenderOptions,
): RenderResult {
  const typstSource = renderTypst(markdown, options);
  const fontPath = join(options.typstPackagePath, "fonts");

  const result = compileTypst(typstSource, {
    workspace: options.typstPackagePath,
    fontPaths: [fontPath],
  });

  const diagnostics: Diagnostic[] = result.diagnostics.map(
    typstToDiagnostic,
  );

  return {
    output: result.pdf ?? new Uint8Array(0),
    diagnostics,
  };
}

/**
 * Render a Markdown document to Typst source.
 *
 * Generates the Typst document without compiling to PDF.
 * Useful for debugging and inspection.
 *
 * @param markdown - Preprocessed Markdown content
 * @param options - Render options with compiled model and config
 * @returns Typst source string
 */
export function renderTypst(
  markdown: string,
  options: RenderOptions,
): string {
  const metadata: DocumentMetadata = {
    project: options.config.name,
    version: options.config.version,
  };

  // Parse entries from the markdown for structured rendering
  const entries = parse(markdown);

  return generateTypstDocument(markdown, metadata, entries);
}

/** Convert a Typst diagnostic to a MarkSpec diagnostic. */
function typstToDiagnostic(d: TypstDiagnostic): Diagnostic {
  return {
    severity: d.severity,
    code: d.severity === "error" ? "R001" : "R002",
    message: `typst: ${d.message}`,
    location: undefined,
  };
}
