/**
 * @module criteria/scenarios
 *
 * Scenario index. Builds the `Entry.criteria` subset
 * `{ form: "scenario", name, addressable, location }` from the fenced
 * `gherkin` / `feature` blocks of an entry body.
 *
 * Source of the scenario names, per block:
 *
 * - the Gherkin AST (`FeatureNode.feature`) when it is present, in any spoken
 *   language;
 * - otherwise the line scanner ({@linkcode scanScenarioNames}, English
 *   keywords only), when the block did not parse (`parseError`) or when the
 *   parser was not loaded at parse time.
 *
 * `parseFile` loads the parser before it parses a text with a gherkin fence,
 * so every entry that reaches the compiler, the validator and the reporter
 * carries the AST or a `parseError`, unless the parser import failed. The
 * scanner for the not-loaded case covers that failure and code that builds
 * entries with the synchronous `parse()` before any load.
 */

import type { BodyBlock, FeatureNode } from "../ast/nodes.ts";
import type { Criterion, EffectiveProfile, Entry } from "../model/mod.ts";
import { descendantsOf } from "../model/mod.ts";
import { extendsTransitively } from "../profile/discipline_mode.ts";
import { normalizeLocator } from "../refs/split.ts";
import { featureFileLine } from "../gherkin/position.ts";

/** Matches a scenario-like keyword line. Group 2 is the raw name. */
const SCENARIO_RE =
  /^\s*(Scenario Outline|Scenario Template|Scenario|Example):\s*(.*)$/;

/**
 * Collect the scenario names of one Gherkin source text, in order.
 * `line` is the 0-based line of the keyword within `source`. Lines between
 * doc-string delimiters (`"""` or three backticks) are skipped. `Background`
 * and `Rule` are not scenarios. Names are trimmed but not otherwise
 * normalized.
 */
export function scanScenarioNames(
  source: string,
): { name: string; line: number }[] {
  const found: { name: string; line: number }[] = [];
  // The delimiter that opened the current doc string, if any. Only the same
  // delimiter closes it.
  let openDelimiter: string | undefined;
  source.split(/\r?\n/).forEach((text, line) => {
    const trimmed = text.trim();
    const delimiter = trimmed.startsWith('"""')
      ? '"""'
      : trimmed.startsWith("```")
      ? "```"
      : undefined;
    if (delimiter !== undefined) {
      if (openDelimiter === undefined) openDelimiter = delimiter;
      else if (openDelimiter === delimiter) openDelimiter = undefined;
      return;
    }
    if (openDelimiter !== undefined) return;
    const match = SCENARIO_RE.exec(text);
    if (match) found.push({ name: match[2].trim(), line });
  });
  return found;
}

/**
 * Build the criteria of an entry from its feature blocks, in source order.
 * Only top-level fenced blocks of the body are indexed: a fence nested in a
 * list item or another container yields no criteria.
 * A block with an AST contributes the AST's scenarios; see the module comment
 * for the fallback. Names are normalized with {@linkcode normalizeLocator}. The blocks of one
 * entry form one scope: a normalized name that occurs more than once, and an
 * empty name, are not addressable. `location.line` is the file-relative line
 * of the keyword; `location.column` is always 1.
 */
export function buildCriteria(entry: Entry): readonly Criterion[] {
  const bodyStart = entry.bodyStartLine ?? (entry.location.line + 1);
  const raw: { name: string; line: number }[] = [];
  for (const block of entry.bodyAst ?? []) {
    if (!isFeature(block)) continue;
    if (block.feature !== undefined) {
      for (const scenario of block.feature.scenarios) {
        raw.push({
          name: normalizeLocator(scenario.name),
          line: featureFileLine(entry, block, scenario.range.start.line),
        });
      }
      continue;
    }
    // Block did not parse, or the parser was not loaded: scan it. Body-
    // relative range line 1 is `bodyStart`; the block's first source line
    // follows the opening fence line.
    const firstSourceLine = bodyStart + block.range.start.line;
    for (const { name, line } of scanScenarioNames(block.source)) {
      raw.push({ name: normalizeLocator(name), line: firstSourceLine + line });
    }
  }
  const counts = new Map<string, number>();
  for (const { name } of raw) counts.set(name, (counts.get(name) ?? 0) + 1);
  return raw.map(({ name, line }) => ({
    form: "scenario",
    name,
    addressable: name !== "" && counts.get(name) === 1,
    location: { file: entry.location.file, line, column: 1 },
  }));
}

/** Core types whose descendants carry criteria. */
const CRITERIA_BEARING_TYPES = ["Requirement", "Contract"] as const;

/** `true` when `entry`'s type resolves to core Requirement or Contract —
 * the entries that carry criteria (epic #915, decision 3). Uses the
 * profile extends chain when a profile is loaded, else the core hierarchy.
 * An entry without a resolved type carries no criteria. */
export function isCriteriaBearing(
  entry: Entry,
  profile: EffectiveProfile | null | undefined,
): boolean {
  const type = entry.type;
  if (type === undefined) return false;
  return CRITERIA_BEARING_TYPES.some((core) =>
    profile
      ? extendsTransitively(type, core, profile)
      : descendantsOf(core).has(type)
  );
}

function isFeature(block: BodyBlock): block is FeatureNode {
  return block.kind === "feature";
}

/** `true` when `entry`'s type is, or extends, the core `Test` type — the
 * entries whose `Verifies` links count for criterion coverage (epic #915,
 * decision 2). Uses the profile extends chain when a profile is loaded,
 * else the core hierarchy. */
export function isTestEntry(
  entry: Entry,
  profile: EffectiveProfile | null | undefined,
): boolean {
  const type = entry.type;
  if (type === undefined) return false;
  return profile
    ? extendsTransitively(type, "Test", profile)
    : descendantsOf("Test").has(type);
}
