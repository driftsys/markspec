/**
 * @module core/validator/caption_convention
 *
 * MSL-C072 validator — caption position violates project-configured
 * convention (docs/specs/markspec-core-data-model.md §4.7).
 *
 * When `project.yaml` carries a `caption-conventions` map, each caption
 * whose `position` disagrees with the configured position for its keyword
 * fires MSL-C072 (warning). Keywords not present in the map are
 * unconstrained and this validator is silent for them.
 *
 * If no conventions are configured (the map is empty or absent) the
 * validator emits no diagnostics — the rule is inactive.
 *
 * This is an AST-only check: `CaptionNode.position` is set by the builder
 * (`core/ast/build.ts`) from the source order of the caption relative to
 * its captionable block.
 */

import type { CaptionConventions, Diagnostic, Entry } from "../model/mod.ts";

/**
 * Validate caption positions against the project-configured conventions.
 *
 * @param entry - The entry whose body AST is scanned for captions.
 * @param conventions - The configured position conventions from
 *   `ProjectConfig.captionConventions`. An empty record means no
 *   conventions are set and the function returns immediately.
 */
export function validateCaptionConvention(
  entry: Entry,
  conventions: CaptionConventions,
): readonly Diagnostic[] {
  // Fast-path: no conventions configured → rule inactive.
  if (Object.keys(conventions).length === 0) return [];

  const blocks = entry.bodyAst ?? [];
  const diagnostics: Diagnostic[] = [];

  for (const block of blocks) {
    if (block.kind !== "caption") continue;

    const expected = conventions[block.keyword];
    // No convention configured for this keyword → skip.
    if (expected === undefined) continue;

    // Convention is satisfied → no diagnostic.
    if (block.position === expected) continue;

    const fileLine = entry.location.line + block.range.start.line;

    diagnostics.push({
      code: "MSL-C072",
      severity: "warning",
      message:
        `${entry.displayId}: ${block.keyword}: caption appears ${block.position} ` +
        `its block but the project convention requires it to be ${expected} ` +
        `(spec §4.7; configure under 'caption-conventions' in project.yaml)`,
      location: {
        file: entry.location.file,
        line: fileLine,
        column: 1,
      },
    });
  }

  return diagnostics;
}
