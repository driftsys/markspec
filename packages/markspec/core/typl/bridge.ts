/**
 * @module typl/bridge
 *
 * Bridges between fence-relative {@linkcode TyplDiagnostic}s emitted by
 * the typl parser and file-relative core {@linkcode Diagnostic}s
 * consumed by the validator and CLI.
 *
 * The typl parser operates on raw typl source strings without knowing
 * the host file. Surface adapters (fence, bullet, inline) attach the
 * file path and a position offset when bridging.
 *
 * See ADR-019.
 */
import type { Diagnostic } from "../model/mod.ts";
import type { TyplDiagnostic } from "./diagnostics.ts";

/**
 * Convert a fence-relative typl diagnostic into a file-relative core
 * diagnostic.
 *
 * The fence's opening ` ``` ` line is at `fenceStartLine` (1-based).
 * The typl content begins on the line _after_ the opening fence, so a
 * typl diagnostic at line N corresponds to file line `fenceStartLine + N`.
 * Column is passed through unchanged (the spec acknowledges a minor
 * indent-translation wart for fences inside indented list items —
 * tracked separately, not in scope here).
 *
 * @param diag        the fence-relative diagnostic emitted by parseTyplBlock
 * @param file        the host file path
 * @param fenceStartLine 1-based line of the opening ``` in the host file
 */
export function bridgeTyplDiagnostic(
  diag: TyplDiagnostic,
  file: string,
  fenceStartLine: number,
): Diagnostic {
  return {
    code: diag.code,
    severity: diag.severity,
    message: diag.message,
    location: {
      file,
      line: fenceStartLine + diag.position.line,
      column: diag.position.column,
    },
  };
}
