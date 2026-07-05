/**
 * @module core/validator/corpus
 *
 * Corpus-aware diagnostic post-pass (ADR-030). Two responsibilities:
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

import type { Diagnostic, Entry, EntryOrigin } from "../model/mod.ts";
import { formatEntryOrigin, sameOriginSource } from "../model/mod.ts";

/**
 * Remedy clause for an inter-tier MSL-R014 collision — both owners
 * carry an origin (upstream and/or delivered profile), so the consumer
 * reading the diagnostic can rename NEITHER read-only entry (#771; the
 * #799 review extended this from the upstream↔upstream case to every
 * origin pairing). The remedy names the actions a consumer CAN take.
 * Same-source duplicates never reach this clause (excluded via
 * `sameOriginSource` — that is the delivering author's own bug, kept on
 * the generic duplicate codes), and project↔origin collisions keep the
 * "rename this entry" wording above (the project entry is the
 * consumer's own).
 */
const INTER_TIER_REMEDY =
  "a consumer cannot rename either read-only entry; drop one of the " +
  "colliding sources (a delivered profile in .markspec.yaml, an upstream " +
  "in project.yaml) or coordinate a rename with its author";

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
    if (!e.origin) {
      const displayOwner = corpusByDisplayId.get(e.displayId);
      if (displayOwner) {
        collided.add(e.displayId);
        diagnostics.push({
          code: "MSL-R014",
          severity: "error",
          message: `display ID '${e.displayId}' is already provided by ` +
            `${formatEntryOrigin(displayOwner.origin!)}; rename this entry — ` +
            `upstream and delivered-corpus entries are read-only`,
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
            message: `Id '${e.id}' is already provided by ` +
              `${formatEntryOrigin(idOwner.origin!)}; rename this entry — ` +
              `upstream and delivered-corpus entries are read-only`,
            location: e.location,
          });
        }
      }
      continue;
    }
    // Corpus↔corpus inter-tier collision: a later delivered entry from a
    // DIFFERENT profile claims a display ID (or Id) the first-registered
    // profile already owns. Same-profile duplicates are excluded — that's
    // the delivering profile's own authoring bug, not a read-only-boundary
    // violation, and stays on the generic duplicate codes.
    const displayOwner = corpusByDisplayId.get(e.displayId);
    if (
      displayOwner !== e && displayOwner &&
      !sameOriginSource(displayOwner.origin!, e.origin)
    ) {
      collided.add(e.displayId);
      diagnostics.push({
        code: "MSL-R014",
        severity: "error",
        message: `display ID '${e.displayId}' is provided by both ` +
          `${formatEntryOrigin(displayOwner.origin!)} and ` +
          `${formatEntryOrigin(e.origin)} — ` +
          INTER_TIER_REMEDY,
        location: e.location,
      });
    }
    if (e.id) {
      const idOwner = corpusById.get(e.id);
      if (
        idOwner !== e && idOwner &&
        !sameOriginSource(idOwner.origin!, e.origin)
      ) {
        collided.add(e.id);
        diagnostics.push({
          code: "MSL-R014",
          severity: "error",
          message: `Id '${e.id}' is provided by both ` +
            `${formatEntryOrigin(idOwner.origin!)} and ` +
            `${formatEntryOrigin(e.origin)} — ` +
            INTER_TIER_REMEDY,
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
  const corpusFiles = new Map<string, EntryOrigin>();
  for (const e of allEntries) {
    if (e.origin) {
      corpusFiles.set(e.location.file, e.origin);
    }
  }
  const out: Diagnostic[] = [];
  for (const d of diagnostics) {
    // Suppress the generic duplicate codes for a corpus collision (MSL-R014
    // has already replaced them). This is a load-bearing coupling with the
    // duplicate validators' message format: MSL-R005/R006/I007/I008 all embed
    // the offending token wrapped in single quotes (`'<token>'`), and the
    // containment check below keys on that exact `'${t}'` shape. If any of
    // those producers stops single-quoting the token, the generic duplicate
    // would leak through alongside the MSL-R014 — `corpus_test.ts` pins all
    // four codes to this contract.
    if (
      GENERIC_DUP_CODES.has(d.code) &&
      [...collidedTokens].some((t) => d.message.includes(`'${t}'`))
    ) {
      continue;
    }
    const origin = d.location ? corpusFiles.get(d.location.file) : undefined;
    if (origin !== undefined) {
      // Attribution verb follows the origin tier (#771): "delivered by"
      // is ADR-030 profile-corpus language; a finding located in a
      // hydrated upstream snapshot reads "from upstream" instead.
      const verb = origin.kind === "upstream"
        ? "from upstream"
        : "delivered by";
      out.push({
        ...d,
        severity: d.severity === "error" ? "warning" : d.severity,
        message: `${verb} ${formatEntryOrigin(origin)}: ${d.message}`,
      });
      continue;
    }
    out.push(d);
  }
  return out;
}
