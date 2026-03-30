/**
 * @module render/typst
 *
 * Typst compiler wrapper. Initializes a NodeCompiler from typst.ts
 * and compiles Typst source to PDF.
 */

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
  /** Absolute path to the workspace root (where lib.typ lives). */
  readonly workspace: string;
  /** Absolute paths to directories containing font files. */
  readonly fontPaths: readonly string[];
}

/**
 * Compile a Typst source string to PDF bytes.
 *
 * Creates a NodeCompiler configured with the given workspace and
 * font paths, compiles the source, and returns the PDF bytes.
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
    const result = compiler.compile({ mainFileContent: source });
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
