/**
 * @module core/compiler/link_target
 *
 * MSL-T013: Tiered link-target severity. After links are extracted and
 * inverses generated, check the state of each link target:
 *
 * | Target state | Severity |
 * |---|---|
 * | Active | OK (no diagnostic) |
 * | Draft (Labels: DRAFT) | info |
 * | Retired (Superseded-by: set OR Deprecated: set) | warning |
 */

import type { Diagnostic, DisplayId, Entry, Link } from "../model/mod.ts";

/**
 * Check all link targets for retirement/draft state.
 * Run after inverse generation so `Superseded-by:` is available.
 */
export function checkLinkTargets(
  entries: ReadonlyMap<DisplayId, Entry>,
  links: readonly Link[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const link of links) {
    const target = entries.get(link.to);
    if (!target) continue; // Unresolved — handled by MSL-T005/MSL-T012

    const state = classifyTargetState(target);
    if (state === "active") continue;

    if (state === "draft") {
      diagnostics.push({
        code: "MSL-T013",
        severity: "info",
        message: `${link.from}: link target '${link.to}' is marked DRAFT`,
        location: link.location,
      });
    } else {
      diagnostics.push({
        code: "MSL-T013",
        severity: "warning",
        message: `${link.from}: link target '${link.to}' is retired`,
        location: link.location,
      });
    }
  }

  return diagnostics;
}

type TargetState = "active" | "draft" | "retired";

function classifyTargetState(entry: Entry): TargetState {
  // Check for retirement markers
  const hasDeprecated = entry.rawAttributes.some((a) => a.key === "Deprecated");
  if (hasDeprecated) return "retired";

  const supersededBy = entry.typedAttributes.get("Superseded-by");
  if (supersededBy && supersededBy.length > 0) return "retired";

  // Check for DRAFT label via typedAttributes
  const labels = entry.typedAttributes.get("Labels");
  if (labels && labels.includes("DRAFT")) return "draft";

  // Also check raw attributes for Labels containing DRAFT
  for (const attr of entry.rawAttributes) {
    if (attr.key === "Labels") {
      const values = attr.value.split(",").map((s) => s.trim());
      if (values.includes("DRAFT")) return "draft";
    }
  }

  return "active";
}
