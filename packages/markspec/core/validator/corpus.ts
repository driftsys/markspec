/**
 * @module core/validator/corpus
 *
 * Corpus-aware diagnostic post-pass (ADR-029). Two responsibilities:
 *
 * 1. {@linkcode detectCorpusCollisions} — a project entry re-declaring a
 *    display ID (or Id) owned by a delivered corpus entry is MSL-R014, a
 *    distinct code from MSL-R006 because the fix is different: rename the
 *    project entry; the corpus entry is not yours to change.
 * 2. {@linkcode attributeCorpusDiagnostics} — consumer builds must not go
 *    red from upstream bugs they cannot fix: findings located inside a
 *    corpus file are downgraded to warnings and attributed to the
 *    delivering profile; generic duplicate codes are suppressed for
 *    collided tokens (MSL-R014 replaces them).
 */

import type { Diagnostic, Entry } from "../model/mod.ts";

/** Generic duplicate detectors superseded by MSL-R014 for corpus collisions. */
const GENERIC_DUP_CODES: ReadonlySet<string> = new Set([
  "MSL-R005",
  "MSL-R006",
  "MSL-I007",
  "MSL-I008",
]);

/** Result of {@linkcode detectCorpusCollisions}. */
export interface CorpusCollisionResult {
  readonly diagnostics: readonly Diagnostic[];
  /** Display-ID / Id tokens involved in a project↔corpus collision. */
  readonly collidedTokens: ReadonlySet<string>;
}

export function detectCorpusCollisions(
  allEntries: readonly Entry[],
): CorpusCollisionResult {
  const corpusByDisplayId = new Map<string, Entry>();
  const corpusById = new Map<string, Entry>();
  for (const e of allEntries) {
    if (!e.origin) continue;
    if (!corpusByDisplayId.has(e.displayId)) {
      corpusByDisplayId.set(e.displayId, e);
    }
    if (e.id && !corpusById.has(e.id)) corpusById.set(e.id, e);
  }
  if (corpusByDisplayId.size === 0 && corpusById.size === 0) {
    return { diagnostics: [], collidedTokens: new Set() };
  }
  const diagnostics: Diagnostic[] = [];
  const collided = new Set<string>();
  for (const e of allEntries) {
    if (e.origin) continue;
    const displayOwner = corpusByDisplayId.get(e.displayId);
    if (displayOwner) {
      collided.add(e.displayId);
      diagnostics.push({
        code: "MSL-R014",
        severity: "error",
        message: `display ID '${e.displayId}' is already delivered by ` +
          `${displayOwner.origin!.profileId}@` +
          `${displayOwner.origin!.profileVersion}; rename this entry — ` +
          `delivered corpus entries are read-only`,
        location: e.location,
      });
    }
    if (e.id) {
      const idOwner = corpusById.get(e.id);
      if (idOwner) {
        collided.add(e.id);
        diagnostics.push({
          code: "MSL-R014",
          severity: "error",
          message: `Id '${e.id}' is already delivered by ` +
            `${idOwner.origin!.profileId}@` +
            `${idOwner.origin!.profileVersion}; rename this entry — ` +
            `delivered corpus entries are read-only`,
          location: e.location,
        });
      }
    }
  }
  return { diagnostics, collidedTokens: collided };
}

export function attributeCorpusDiagnostics(
  diagnostics: readonly Diagnostic[],
  allEntries: readonly Entry[],
  collidedTokens: ReadonlySet<string>,
): Diagnostic[] {
  const corpusFiles = new Map<string, string>();
  for (const e of allEntries) {
    if (e.origin) {
      corpusFiles.set(
        e.location.file,
        `${e.origin.profileId}@${e.origin.profileVersion}`,
      );
    }
  }
  const out: Diagnostic[] = [];
  for (const d of diagnostics) {
    // Suppress the generic duplicate codes for corpus collisions; the
    // validator embeds the offending token in single quotes, which is what
    // this containment check keys on.
    if (
      GENERIC_DUP_CODES.has(d.code) &&
      [...collidedTokens].some((t) => d.message.includes(`'${t}'`))
    ) {
      continue;
    }
    const label = d.location ? corpusFiles.get(d.location.file) : undefined;
    if (label !== undefined) {
      out.push({
        ...d,
        severity: d.severity === "error" ? "warning" : d.severity,
        message: `delivered by ${label}: ${d.message}`,
      });
      continue;
    }
    out.push(d);
  }
  return out;
}
