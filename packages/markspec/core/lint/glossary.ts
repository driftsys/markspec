/**
 * @module core/lint/glossary
 *
 * Glossary-only subset resolver for the flagship MSL-Q500 rule
 * (markspec-prose-analysis §2.8, §8 OQ4 resolved). Indexes:
 *
 *   1. In-entry DefinitionList terms (Term: definition pairs in any
 *      in-scope entry's bodyAst).
 *   2. H3 terms in glossary files (R4-c slug derivation via
 *      `deriveTermSlug` from core/parser/glossary.ts) plus
 *      parenthetical acronym aliases (R4-g).
 *
 * Built once per runLint invocation. The $Identifier registry leg
 * (resolver step 3 in §2.8) and profile Aliases (step 4) are NOT
 * indexed here — they remain deferred-by-dependency on the ADR-016
 * marker pass and rule promotion respectively. Q500 receives a no-op
 * hook for the $Identifier leg.
 *
 * See also: ADR-021 Decision 1 (the deferred-resolver posture and
 * the additive-enrichment invariant).
 */

import type { Entry } from "../model/mod.ts";
import { deriveTermSlug } from "../parser/glossary.ts";
import { processor } from "../parser/remark.ts";
import type { Heading, Root } from "mdast";

/** Whether a slug is present in the glossary subset. */
export interface GlossaryIndex {
  has(slug: string): boolean;
  /** For diagnostics & debugging only. */
  size(): number;
}

/** Read a glossary file's content. Returns undefined if missing. */
export type FileReader = (
  path: string,
) => Promise<{ content: string; file: string } | undefined>;

/**
 * Build the glossary index from in-entry DefinitionList nodes and
 * (optionally) a list of known glossary file paths.
 *
 * @param entries - All entries in scope (their `bodyAst` is walked for
 *   DefinitionList nodes).
 * @param readFile - Async file reader; returns undefined for missing files.
 * @param glossaryFilePaths - Paths of `markspec:glossary` files to index.
 *   Defaults to an empty array — callers (slice 5 / runLint) supply this.
 */
export async function buildGlossaryIndex(
  entries: readonly Entry[],
  readFile: FileReader,
  glossaryFilePaths: readonly string[] = [],
): Promise<GlossaryIndex> {
  const slugs = new Set<string>();

  // (1) In-entry DefinitionList terms.
  for (const entry of entries) {
    const blocks = entry.bodyAst ?? [];
    for (const block of blocks) {
      if (block.kind !== "definition-list") continue;
      for (const pair of block.items) {
        const slug = deriveTermSlug(pair.term.text);
        if (slug.length > 0) slugs.add(slug);
      }
    }
  }

  // (2) Glossary file H3 terms + R4-g aliases.
  for (const path of glossaryFilePaths) {
    const file = await readFile(path);
    if (!file) continue;
    const tree = processor.parse(file.content) as Root;
    for (const node of tree.children) {
      if (node.type !== "heading") continue;
      const h = node as unknown as Heading;
      if (h.depth !== 3) continue;
      const text = extractHeadingText(h);
      // R4-g: extract parenthetical acronym alias before slugifying the
      // primary term, so the primary slug is derived from the non-parenthetical
      // portion only (e.g. "Automotive Safety Integrity Level (ASIL)" →
      // primary "automotive-safety-integrity-level" + alias "asil").
      const aliasMatch = text.match(/\(([^)]+)\)/);
      const textForPrimary = aliasMatch
        ? text.slice(0, aliasMatch.index).trimEnd()
        : text;
      const primary = deriveTermSlug(textForPrimary);
      if (primary.length > 0) slugs.add(primary);
      if (aliasMatch) {
        const aliasSlug = deriveTermSlug(aliasMatch[1]);
        if (aliasSlug.length > 0) slugs.add(aliasSlug);
      }
    }
  }

  return {
    has: (slug: string) => slugs.has(slug),
    size: () => slugs.size,
  };
}

/** Extract plain text from a heading node by concatenating Text and
 * InlineCode child values. Mirrors the same helper in parser/glossary.ts
 * but kept local so this module has no dependency on that module's
 * non-exported internals. */
function extractHeadingText(node: Heading): string {
  let text = "";
  for (const child of node.children) {
    if (child.type === "text") text += (child as { value: string }).value;
    else if (child.type === "inlineCode") {
      text += (child as { value: string }).value;
    }
  }
  return text;
}
