/**
 * @module core/lint/types
 *
 * LintDiagnostic — prose-quality diagnostic type, extending the core
 * Diagnostic interface with slug, group, and score metadata. Kept
 * separate from core Diagnostic to prevent slug/group fields from
 * leaking into validate/compile JSON output, which has a stable schema.
 */

import type { Diagnostic } from "../model/mod.ts";
import type { SourceRange } from "../ast/nodes.ts";

/** A prose-quality diagnostic with slug and group metadata. */
export interface LintDiagnostic extends Diagnostic {
  /** Human-readable rule slug, e.g. "incose-r7-vague-term". */
  readonly slug: string;
  /** Rule group: "ears" | "modal" | "incose" | "struct" | "xref" | "disable". */
  readonly group: "ears" | "modal" | "incose" | "struct" | "xref" | "disable";
  /** Entry-level score contribution for this firing. */
  readonly scoreContribution: number;
  /** Sentence- or token-span range within the source file. When present,
   * the LSP bridge uses this for precise highlighting; when absent, the
   * entry-level `location` is used as a degenerate EOL-clamped range.
   * Positions are 1-based (matching {@linkcode SourceRange} convention). */
  readonly range?: SourceRange;
}
