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
import { dirname, isAbsolute, join, relative, resolve } from "@std/path";

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
  /**
   * Absolute path to the source Markdown file on disk.
   *
   * The Typst compiler resolves relative paths in the source
   * (`![image](./asset.svg)`, etc.) against this file's directory.
   * When omitted, relative paths resolve against `typstPackagePath`
   * and image references outside the package will not load.
   */
  readonly sourceFilePath?: string;
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
 * Generates a Typst document from the Markdown content using the
 * markspec-doc template and cmarker, then compiles it to PDF via the
 * Typst compiler. When `sourceFilePath` is provided, image references
 * relative to the source Markdown resolve correctly.
 *
 * @param markdown - Preprocessed Markdown content
 * @param options - Render options with compiled model and config
 * @returns PDF bytes and diagnostics
 */
export function renderPdf(
  markdown: string,
  options: RenderOptions,
): RenderResult {
  const typstPackagePath = ensureTrailingSlash(
    resolve(options.typstPackagePath),
  );
  const sourceAbsPath = options.sourceFilePath
    ? resolve(options.sourceFilePath)
    : undefined;

  // Workspace must contain both the markspec-typst package (for
  // lib.typ, vendor/cmarker, themes) and the source Markdown (for
  // relative image references). Use the longest common ancestor.
  const workspace = sourceAbsPath
    ? longestCommonDirectory(typstPackagePath, sourceAbsPath)
    : typstPackagePath;

  // Build the Typst package import prefix as a workspace-absolute path
  // (Typst recognizes a leading `/` as "from workspace root").
  const typstPackageImportPrefix = "/" +
    ensureTrailingSlash(
      relative(workspace, typstPackagePath).replaceAll("\\", "/"),
    );

  // Build the image-path base prefix: a workspace-absolute path to the
  // source document's directory. cmarker's `image()` calls are written
  // inside its own `lib.typ`, so relative image paths otherwise resolve
  // against cmarker rather than the source doc; prefixing with this path
  // (in a scope-provided wrapper) fixes that.
  const imageBasePrefix = sourceAbsPath
    ? "/" +
      ensureTrailingSlash(
        relative(workspace, dirname(sourceAbsPath)).replaceAll("\\", "/"),
      )
    : "";

  const typstSource = renderTypst(
    markdown,
    options,
    typstPackageImportPrefix,
    imageBasePrefix,
  );

  // When compiling from a source file on disk, register the generated
  // Typst source as a shadow file next to the Markdown so Typst
  // resolves relative paths against the source directory.
  const mainFilePath = sourceAbsPath
    ? join(dirname(sourceAbsPath), "__markspec_render__.typ")
    : undefined;

  const fontPath = join(typstPackagePath, "fonts");
  const result = compileTypst(typstSource, {
    workspace,
    fontPaths: [fontPath],
    mainFilePath,
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
 * Generates the Typst document without compiling to PDF. Useful for
 * debugging and inspection.
 *
 * @param markdown - Preprocessed Markdown content
 * @param options - Render options with compiled model and config
 * @param typstPackageImportPrefix - Optional workspace-absolute prefix
 *   to use for the markspec-typst package imports (e.g. `"/"` or
 *   `"/path/to/markspec-typst/"`). Defaults to empty (imports
 *   resolved relative to workspace root).
 * @returns Typst source string
 */
export function renderTypst(
  markdown: string,
  options: RenderOptions,
  typstPackageImportPrefix: string = "",
  imageBasePrefix: string = "",
): string {
  const metadata: DocumentMetadata = {
    project: options.config.name,
    version: options.config.version,
  };

  // Parse entries from the markdown for structured rendering
  const entries = parse(markdown);

  return generateTypstDocument(
    markdown,
    metadata,
    entries,
    typstPackageImportPrefix,
    imageBasePrefix,
  );
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

/**
 * Longest-common-directory of two absolute paths. Used to compute a
 * Typst workspace that includes both the markspec-typst package and
 * an arbitrary source document's directory.
 */
function longestCommonDirectory(a: string, b: string): string {
  if (!isAbsolute(a) || !isAbsolute(b)) {
    throw new Error("longestCommonDirectory requires absolute paths");
  }
  const aParts = a.replace(/\/+$/, "").split("/");
  const bParts = b.replace(/\/+$/, "").split("/");
  const shared: string[] = [];
  const len = Math.min(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    if (aParts[i] === bParts[i]) {
      shared.push(aParts[i]);
    } else {
      break;
    }
  }
  const result = shared.join("/");
  return result === "" ? "/" : result;
}

/** Ensure a directory path ends with a single `/`. */
function ensureTrailingSlash(p: string): string {
  return p.endsWith("/") ? p : `${p}/`;
}
