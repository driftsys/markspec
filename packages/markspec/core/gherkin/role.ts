/**
 * @module core/gherkin/role
 *
 * The role of a Gherkin block follows the type of the entry that holds it
 * (epic #915, ADR-038). The role is derived on demand and is not stored on
 * the entry.
 *
 * - `criteria`: the entry is, or extends, a Requirement or a Contract. Each
 *   scenario is an acceptance criterion.
 * - `procedure`: the entry is, or extends, Test. The block is a test
 *   procedure.
 * - `illustration`: any other typed entry. The block is an example.
 */

import type { EffectiveProfile, Entry } from "../model/mod.ts";
import { isCriteriaBearing, isTestEntry } from "../criteria/scenarios.ts";

/** What a Gherkin block means in its entry. */
export type BlockRole = "criteria" | "procedure" | "illustration";

/**
 * Return the role of the Gherkin blocks of `entry`, or `undefined` when the
 * entry has no resolved type. The entry is not classified here: callers
 * classify it first (for example with the profile's display-ID patterns).
 */
export function blockRole(
  entry: Entry,
  profile: EffectiveProfile | null,
): BlockRole | undefined {
  if (entry.type === undefined) return undefined;
  if (isCriteriaBearing(entry, profile)) return "criteria";
  if (isTestEntry(entry, profile)) return "procedure";
  return "illustration";
}
