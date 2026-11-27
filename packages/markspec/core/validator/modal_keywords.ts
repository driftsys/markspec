/**
 * @module core/validator/modal_keywords
 *
 * MSL-M060 validator — uppercase RFC 2119 modal keyword (`SHALL`,
 * `SHOULD`, `MAY`, `MUST`, `WILL`) in entry-body prose. The formatter
 * normalises these to lowercase per spec §3.4.1; this validator
 * surfaces the deviation in a lint-only flow. Profiles may promote the
 * severity. MSL-M060 is skipped under `modal-keywords.casing: preserve`
 * and `rfc8174`, where uppercase is allowed or normative.
 *
 * MSL-M062 (info) is the reverse check under `casing: rfc8174`: it
 * reports each lowercase modal keyword in an entry that resolves to the core
 * type `Requirement`. The check classifies the entry with the profile
 * (display-ID pattern) when it has no type, then resolves the core type, in
 * `isRequirementWithProfile` (`types.ts`). A match is: an explicit or
 * classified type, a profile type that extends `Requirement`, the built-in
 * `REQ` display-ID prefix, a profile display-ID pattern, or a `.feature`
 * Feature or Rule entry. The keywords reported are `shall`, `should`, `may`,
 * `must` and `will` (with `not` forms). `markspec fmt` uppercases only `shall`
 * and `must` under `rfc8174`, so M062 on `may`, `should` or `will` stays until
 * the author uppercases the word or leaves it as plain English.
 *
 * MSL-M061 reports a `Requirement` entry with no modal keyword at all. It uses
 * the same profile-aware check as MSL-M062, so a profile type that extends
 * `Requirement` counts, whether an explicit `Type:` or the profile display-ID
 * pattern sets it (#1024).
 *
 * The body tokens leave out keywords in inline code, link destinations,
 * titles and labels, autolinks, images, link reference definitions,
 * footnote labels and raw HTML, which the formatter keeps, so MSL-M060 and
 * MSL-M062 do not report them (#1017).
 *
 * Reads `Entry.bodyTokens` (ADR-016) and filters for `kind === "modal"`:
 * `case === "upper"` tokens for MSL-M060 and `case === "lower"` tokens for
 * MSL-M062. Code, feature, and math blocks are
 * automatically excluded because the parser's `extractBodyTokens` does
 * not emit tokens inside verbatim regions.
 */

import type {
  BodyToken,
  Diagnostic,
  EffectiveProfile,
  Entry,
} from "../model/mod.ts";
import { isRequirementWithProfile } from "./types.ts";

type ModalToken = Extract<BodyToken, { kind: "modal" }>;

/**
 * MSL-M060: report every uppercase RFC 2119 modal keyword in entry-body
 * prose. Emits one diagnostic per uppercase occurrence with the exact
 * source text in the message.
 *
 * MSL-M062: under `modal-keywords.casing: rfc8174`, M060 is not emitted
 * and each lowercase modal keyword in a Requirement-type entry is reported
 * (info severity), because only uppercase keywords are normative there.
 *
 * MSL-M061: report when a Requirement-type entry contains no modal
 * keyword at all (info severity; style hint to add an obligation verb).
 */
export function validateModalKeywords(
  entry: Entry,
  conventions?: EffectiveProfile["conventions"],
  profile?: EffectiveProfile,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const modalTokens = entry.bodyTokens.filter(
    (t): t is ModalToken => t.kind === "modal",
  );

  const anyModalSeen = modalTokens.length > 0;
  const casing = conventions?.get("modal-keywords")?.value.settings["casing"];
  // `preserve`: the source casing is the profile's choice. `rfc8174`:
  // uppercase is the normative form. Neither reports uppercase as a warning.
  const uppercaseAllowed = casing === "preserve" || casing === "rfc8174";
  // MSL-M061 and MSL-M062 run before Stage 2 classification, so they
  // classify here with the profile: an explicit or display-ID-pattern profile
  // type that extends `Requirement` counts. Each rule classifies only when its
  // other condition holds. MSL-M062: a lowercase keyword under `rfc8174`.
  const m062Applies = casing === "rfc8174" &&
    modalTokens.some((t) => t.case === "lower") &&
    isRequirementWithProfile(entry, profile);

  for (const t of modalTokens) {
    // MSL-M062: under `rfc8174`, a lowercase keyword in a Requirement is
    // not normative (info; style hint).
    if (m062Applies && t.case === "lower") {
      diagnostics.push({
        code: "MSL-M062",
        severity: "info",
        message: `modal keyword '${t.text}' is lowercase; under RFC 8174 ` +
          `only uppercase keywords are normative`,
        location: t.location,
      });
    }
    if (t.case !== "upper" || uppercaseAllowed) continue;
    diagnostics.push({
      code: "MSL-M060",
      severity: "warning",
      message: `modal keyword '${t.text}' should be lowercase`,
      location: t.location,
    });
  }

  // MSL-M061 — Requirement-type entry contains no modal keyword
  // (info; style hint). Gated on the core type resolved with the profile
  // being `Requirement` so non-requirement entries (Tests, Contracts, etc.)
  // are not flagged. The hint stays at info severity so it doesn't
  // affect exit codes; profiles may promote.
  if (!anyModalSeen && isRequirementWithProfile(entry, profile)) {
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
