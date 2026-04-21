/**
 * @module render/typst
 *
 * Typst compiler wrapper. Initializes a NodeCompiler from typst.ts
 * and compiles Typst source to PDF.
 */

import { Buffer } from "node:buffer";
import { NodeCompiler } from "typst-ts-node-compiler";

/** Result of a Typst compilation. */
export interface CompileTypstResult {
  /** PDF bytes on success, undefined on error. */
  readonly pdf?: Uint8Array;
  /** Diagnostic messages from the Typst compiler. */
  readonly diagnostics: readonly TypstDiagnostic[];
}

/** A diagnostic message from the Typst compiler. */
export interface TypstDiagnostic {
  readonly severity: "error" | "warning";
  readonly message: string;
}

/** Options for Typst compilation. */
export interface CompileTypstOptions {
  /** Absolute path to the workspace root. */
  readonly workspace: string;
  /** Absolute paths to directories containing font files. */
  readonly fontPaths: readonly string[];
  /**
   * Absolute path to use as the main file's virtual location.
   *
   * When set, the Typst source is registered as a shadow file at this path
   * and compiled via `mainFilePath`. Typst then resolves relative paths in
   * the source (most importantly image paths) against this file's
   * directory. When unset, the source is passed as `mainFileContent` and
   * relative paths resolve against the workspace root.
   */
  readonly mainFilePath?: string;
}

/**
 * Compile a Typst source string to PDF bytes.
 *
 * Creates a NodeCompiler configured with the given workspace and font
 * paths, compiles the source, and returns the PDF bytes.
 *
 * If `mainFilePath` is provided, the source is mounted as a shadow file
 * at that path so Typst can resolve relative-to-source paths (e.g. image
 * references in the user's Markdown). The path must be inside
 * `workspace`.
 */
export function compileTypst(
  source: string,
  options: CompileTypstOptions,
): CompileTypstResult {
  const compiler = NodeCompiler.create({
    workspace: options.workspace,
    fontArgs: [
      { fontPaths: [...options.fontPaths] },
    ],
  });

  try {
    let result;
    if (options.mainFilePath) {
      compiler.mapShadow(options.mainFilePath, Buffer.from(source, "utf-8"));
      try {
        result = compiler.compile({ mainFilePath: options.mainFilePath });
      } finally {
        compiler.unmapShadow(options.mainFilePath);
      }
    } else {
      result = compiler.compile({ mainFileContent: source });
    }

    const diagnostics: TypstDiagnostic[] = [];

    if (result.hasError()) {
      const diag = result.takeDiagnostics();
      if (diag?.shortDiagnostics) {
        for (const d of diag.shortDiagnostics) {
          diagnostics.push({
            severity: "error",
            message: d.message ?? String(d),
          });
        }
      }
      return { diagnostics };
    }

    const doc = result.result;
    if (!doc) {
      return {
        diagnostics: [{
          severity: "error",
          message: "Typst compilation produced no document",
        }],
      };
    }

    const pdf = compiler.pdf(doc);
    return { pdf: new Uint8Array(pdf), diagnostics };
  } finally {
    // NodeCompiler has no explicit dispose — rely on GC
  }
}
