/**
 * @module core/validator/modal_keywords
 *
 * MSL-M060 validator — uppercase RFC 2119 modal keyword (`SHALL`,
 * `SHOULD`, `MAY`, `MUST`, `WILL`) in entry-body prose. The formatter
 * normalises these to lowercase per spec §3.4.1; this validator
 * surfaces the deviation in a lint-only flow. Profiles may promote the
 * severity.
 *
 * Reads `Entry.bodyTokens` (ADR-016) and filters for `kind === "modal"`
 * AND `case === "upper"`. Code, feature, and math blocks are
 * automatically excluded because the parser's `extractBodyTokens` does
 * not emit tokens inside verbatim regions.
 */

import type { BodyToken, Diagnostic, Entry } from "../model/mod.ts";
import { resolvedCoreType } from "./type_resolution.ts";

type ModalToken = Extract<BodyToken, { kind: "modal" }>;

/**
 * MSL-M060: report every uppercase RFC 2119 modal keyword in entry-body
 * prose. Emits one diagnostic per uppercase occurrence with the exact
 * source text in the message.
 *
 * MSL-M061: report when a Requirement-type entry contains no modal
 * keyword at all (info severity; style hint to add an obligation verb).
 */
export function validateModalKeywords(entry: Entry): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const modalTokens = entry.bodyTokens.filter(
    (t): t is ModalToken => t.kind === "modal",
  );

  const anyModalSeen = modalTokens.length > 0;

  for (const t of modalTokens) {
    if (t.case !== "upper") continue;
    diagnostics.push({
      code: "MSL-M060",
      severity: "warning",
      message: `modal keyword '${t.text}' should be lowercase`,
      location: t.location,
    });
  }

  // MSL-M061 — Requirement-type entry contains no modal keyword
  // (info; style hint). Gated on the resolved core type being
  // `Requirement` so non-requirement entries (Tests, Contracts, etc.)
  // are not flagged. The hint stays at info severity so it doesn't
  // affect exit codes; profiles may promote.
  if (!anyModalSeen && resolvedCoreType(entry) === "Requirement") {
    diagnostics.push({
      code: "MSL-M061",
      severity: "info",
      message: `${entry.displayId}: Requirement entry contains no modal ` +
        `keyword (shall / should / may / must) — consider declaring one ` +
        `to make the obligation explicit (spec §3.4.1 "Modal keywords")`,
      location: entry.location,
    });
  }

  return diagnostics;
}
