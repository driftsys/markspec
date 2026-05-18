/**
 * @module parser/glossary
 *
 * Validates the glossary heading-shape grammar (spec §4.2).
 *
 * A `markspec:glossary` document uses H1/H2/H3 headings instead of entry
 * blocks. This module walks the mdast AST to validate the four structural
 * rules (R4-a through R4-e) and emits MSL-L020–L024 diagnostics.
 */

import type { Heading, Root } from "mdast";
import type { Diagnostic, SourceLocation } from "../model/mod.ts";
import { processor } from "./remark.ts";

/** Options for {@linkcode validateGlossaryStructure}. */
export interface GlossaryValidationOptions {
  /** File path used in source locations. */
  readonly file?: string;
}

/** Result of glossary structure validation. */
export interface GlossaryValidationResult {
  readonly diagnostics: readonly Diagnostic[];
  /** Number of H3 terms found (used by caller to detect empty glossary). */
  readonly termCount: number;
}

/**
 * Derive the canonical slug from an H3 term text per spec §4.2 R4-c:
 *   lowercase → trim → collapse whitespace runs to "-" →
 *   drop chars outside [a-z0-9._/-]
 */
export function deriveTermSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._/-]/g, "");
}

/**
 * Extract the plain-text content from a heading node by walking its
 * inline children and concatenating Text node values.
 */
function headingText(node: Heading): string {
  let text = "";
  for (const child of node.children) {
    if (child.type === "text") {
      text += (child as { type: string; value: string }).value;
    } else if (child.type === "inlineCode") {
      text += (child as { type: string; value: string }).value;
    }
  }
  return text;
}

/**
 * Walk a glossary document's mdast AST and validate the H1/H2/H3
 * heading-shape grammar (spec §4.2).
 *
 * Emits:
 * - MSL-L020: zero or ≥2 H1 headings (error)
 * - MSL-L021: H3 with no preceding H2 in the file (error)
 * - MSL-L022: duplicate term slug within the same H2 group (error)
 * - MSL-L023: H3 with no definition blocks before the next H3/H2/EOF (warning)
 * - MSL-L024: heading deeper than H3 (H4+) inside glossary (error)
 *
 * Note: MSL-L025 (link refs interleaved between terms) is out of scope
 * for this implementation.
 */
export function validateGlossaryStructure(
  markdown: string,
  options?: GlossaryValidationOptions,
): GlossaryValidationResult {
  const file = options?.file ?? "<unknown>";
  const tree = processor.parse(markdown) as Root;
  const diagnostics: Diagnostic[] = [];

  // -----------------------------------------------------------------------
  // First pass: collect all heading nodes with their positions.
  // -----------------------------------------------------------------------
  interface NodeSummary {
    depth: number;
    text: string;
    line: number;
    column: number;
  }

  const nodes: NodeSummary[] = [];
  for (const node of tree.children) {
    if (node.type === "heading") {
      const h = node as unknown as Heading;
      nodes.push({
        depth: h.depth,
        text: headingText(h),
        line: h.position?.start.line ?? 1,
        column: h.position?.start.column ?? 1,
      });
    }
  }

  // -----------------------------------------------------------------------
  // R4-a: exactly one H1.
  // -----------------------------------------------------------------------
  const h1Nodes = nodes.filter((n) => n.depth === 1);
  if (h1Nodes.length !== 1) {
    const loc: SourceLocation = h1Nodes.length > 0
      ? { file, line: h1Nodes[0].line, column: h1Nodes[0].column }
      : { file, line: 1, column: 1 };
    diagnostics.push({
      code: "MSL-L020",
      severity: "error",
      message: h1Nodes.length === 0
        ? `${file}: glossary must have exactly one H1 title (found 0) (spec §4.2 R4-a)`
        : `${file}: glossary must have exactly one H1 title (found ${h1Nodes.length}) (spec §4.2 R4-a)`,
      location: loc,
    });
  }

  // -----------------------------------------------------------------------
  // R4-e: no headings deeper than H3.
  // -----------------------------------------------------------------------
  for (const n of nodes) {
    if (n.depth >= 4) {
      diagnostics.push({
        code: "MSL-L024",
        severity: "error",
        message: `${file}:${n.line}: H${n.depth} heading '${n.text}' — ` +
          `glossary shape is exactly three levels (H1/H2/H3); ` +
          `headings deeper than H3 are not allowed (spec §4.2 R4-e)`,
        location: { file, line: n.line, column: n.column },
      });
    }
  }

  // -----------------------------------------------------------------------
  // R4-b/R4-c/R4-d: validate H2/H3 structure.
  //
  // Walk heading nodes in document order. Track:
  // - hasH2: whether we have seen an H2 since the start
  // - currentGroupSlugs: slug set for the current H2 group (for L022)
  // - prevH3: last H3 node, to check if it got definition blocks
  //
  // "Definition blocks" between H3 and next heading:
  // We need to check whether there is any non-heading block between each
  // H3 and the next heading. Walk `tree.children` (not just heading nodes)
  // for this.
  // -----------------------------------------------------------------------

  // Build a list of "events": each item is either a heading descriptor
  // (depth, text, line) or a "content block" signal.
  type Event =
    | {
      kind: "heading";
      depth: number;
      text: string;
      line: number;
      col: number;
    }
    | { kind: "block" };

  const events: Event[] = [];
  for (const node of tree.children) {
    if (node.type === "heading") {
      const h = node as unknown as Heading;
      events.push({
        kind: "heading",
        depth: h.depth,
        text: headingText(h),
        line: h.position?.start.line ?? 1,
        col: h.position?.start.column ?? 1,
      });
    } else if (
      node.type !== "definition" && node.type !== "html"
    ) {
      // Any non-heading, non-link-ref, non-HTML block is definition content.
      events.push({ kind: "block" });
    }
    // "definition" nodes are link-reference definitions → not definition content
    // "html" nodes are directive comments → not definition content
  }

  let hasH2 = false;
  let currentGroupSlugs = new Set<string>();
  let termCount = 0;

  // For L023: track the last H3 and whether it received definition blocks.
  let lastH3: { text: string; line: number; col: number } | null = null;
  let lastH3HasContent = false;

  for (const event of events) {
    if (event.kind === "block") {
      if (lastH3 !== null) {
        lastH3HasContent = true;
      }
      continue;
    }

    // heading event
    const { depth, text, line, col } = event;

    if (depth === 2) {
      // Flush L023 check for the previous H3 before starting a new group.
      if (lastH3 !== null && !lastH3HasContent) {
        diagnostics.push({
          code: "MSL-L023",
          severity: "warning",
          message: `${file}:${lastH3.line}: term '${lastH3.text}' has an ` +
            `empty definition (spec §4.2 R4-d)`,
          location: { file, line: lastH3.line, column: lastH3.col },
        });
      }
      hasH2 = true;
      currentGroupSlugs = new Set<string>();
      lastH3 = null;
      lastH3HasContent = false;
    } else if (depth === 3) {
      // Flush L023 check for the previous H3.
      if (lastH3 !== null && !lastH3HasContent) {
        diagnostics.push({
          code: "MSL-L023",
          severity: "warning",
          message: `${file}:${lastH3.line}: term '${lastH3.text}' has an ` +
            `empty definition (spec §4.2 R4-d)`,
          location: { file, line: lastH3.line, column: lastH3.col },
        });
      }

      // R4-b: H3 requires a preceding H2.
      if (!hasH2) {
        diagnostics.push({
          code: "MSL-L021",
          severity: "error",
          message: `${file}:${line}: term '${text}' has no preceding H2 ` +
            `letter-group heading (spec §4.2 R4-b)`,
          location: { file, line, column: col },
        });
      }

      // R4-c: duplicate slug within the same H2 group.
      const slug = deriveTermSlug(text);
      if (slug.length > 0 && currentGroupSlugs.has(slug)) {
        diagnostics.push({
          code: "MSL-L022",
          severity: "error",
          message: `${file}:${line}: duplicate term slug '${slug}' ` +
            `(derived from '${text}') within the same H2 group (spec §4.2 R4-c)`,
          location: { file, line, column: col },
        });
      } else if (slug.length > 0) {
        currentGroupSlugs.add(slug);
      }

      termCount++;
      lastH3 = { text, line, col };
      lastH3HasContent = false;
    } else if (depth === 1) {
      // Additional H1s: only emit L020 once (from the count check above).
      // Flush L023 on the last H3 if needed.
      if (lastH3 !== null && !lastH3HasContent) {
        diagnostics.push({
          code: "MSL-L023",
          severity: "warning",
          message: `${file}:${lastH3.line}: term '${lastH3.text}' has an ` +
            `empty definition (spec §4.2 R4-d)`,
          location: { file, line: lastH3.line, column: lastH3.col },
        });
        lastH3 = null;
        lastH3HasContent = false;
      }
    }
  }

  // Flush L023 for the final H3 in the document.
  if (lastH3 !== null && !lastH3HasContent) {
    diagnostics.push({
      code: "MSL-L023",
      severity: "warning",
      message: `${file}:${lastH3.line}: term '${lastH3.text}' has an ` +
        `empty definition (spec §4.2 R4-d)`,
      location: { file, line: lastH3.line, column: lastH3.col },
    });
  }

  return { diagnostics, termCount };
}
