/**
 * @module core/validator/feature_ac
 *
 * MSL-B044 validator — entry body contains both a Feature (Gherkin)
 * block and a separate list labelled "Acceptance criteria" (the
 * alternative form). Only one canonical form is required; having both
 * is redundant and indicates an inconsistency the author should resolve.
 *
 * Detection heuristic (spec §4.5 "MSL-B044"):
 *   - The entry body contains at least one `FeatureNode`.
 *   - The entry body also contains a `ListNode` that is introduced by
 *     a `ParagraphNode` (or is headed by text in a paragraph) whose
 *     text matches "acceptance criteria" case-insensitively — i.e., a
 *     paragraph immediately preceding a list whose prose trims to
 *     "acceptance criteria" (or starts with it), OR a paragraph
 *     immediately following the list that reads like a label, OR the
 *     first item text of the list begins with "Acceptance criteria".
 *
 * This is an AST-only check; no external dependency.
 */

import type { Diagnostic, Entry } from "../model/mod.ts";
import type { BodyBlock } from "../ast/nodes.ts";

/** Case-insensitive match for "acceptance criteria" anywhere in text. */
const ACCEPTANCE_CRITERIA_RE = /acceptance\s+criteria/i;

/**
 * Determine whether a body block appears to label an "Acceptance
 * criteria" list — either the block itself is a paragraph whose text
 * matches, or it is a list whose first item text matches.
 */
function isAcceptanceCriteriaLabel(block: BodyBlock): boolean {
  if (block.kind === "paragraph") {
    return ACCEPTANCE_CRITERIA_RE.test(block.content.text);
  }
  if (block.kind === "list") {
    // Check first list item's first paragraph for the label.
    const firstItem = block.items[0];
    if (firstItem) {
      for (const sub of firstItem.blocks) {
        if (
          sub.kind === "paragraph" &&
          ACCEPTANCE_CRITERIA_RE.test(sub.content.text)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Check if there is an "Acceptance criteria" list in the body.
 *
 * Strategies (in priority order):
 * 1. A `ListNode` is preceded by a `ParagraphNode` whose text matches
 *    "acceptance criteria".
 * 2. A `ListNode` is followed by a `ParagraphNode` whose text matches
 *    "acceptance criteria".
 * 3. A `ListNode`'s first item paragraph text matches.
 */
function hasAcceptanceCriteriaList(blocks: readonly BodyBlock[]): boolean {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.kind !== "list") continue;

    // Strategy 1: preceding paragraph is the label
    if (i > 0 && isAcceptanceCriteriaLabel(blocks[i - 1])) return true;
    // Strategy 2: following paragraph is the label
    if (
      i + 1 < blocks.length && isAcceptanceCriteriaLabel(blocks[i + 1])
    ) return true;
    // Strategy 3: first list item text is the label
    if (isAcceptanceCriteriaLabel(block)) return true;
  }
  return false;
}

/**
 * Validate that an entry's body does not contain both a Feature block
 * (Gherkin) and a separate "Acceptance criteria" list. Emits MSL-B044
 * (warning) when both are present.
 */
export function validateFeatureAc(entry: Entry): readonly Diagnostic[] {
  const blocks = entry.bodyAst ?? [];

  // Quick exit: need at least one FeatureNode.
  const featureBlock = blocks.find((b) => b.kind === "feature");
  if (!featureBlock) return [];

  // Now check for an "Acceptance criteria" list.
  if (!hasAcceptanceCriteriaList(blocks)) return [];

  const fileLine = entry.location.line + featureBlock.range.start.line;

  return [
    {
      code: "MSL-B044",
      severity: "warning",
      message:
        `${entry.displayId}: body contains both a Feature (Gherkin) block ` +
        `and a separate "Acceptance criteria" list — use one canonical form ` +
        `(Feature block preferred per spec §4.5)`,
      location: {
        file: entry.location.file,
        line: fileLine,
        column: 1,
      },
    },
  ];
}
