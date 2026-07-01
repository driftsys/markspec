/**
 * @module core/profile/delivered
 *
 * Loader for profile-delivered documents (ADR-029). Checks every delivered
 * file's existence (PROFILE-DELIVERS-001/002), parses the `corpus: true`
 * files, and stamps each parsed entry with its profile origin. Pure — all
 * I/O via the injected {@linkcode ReadFile}.
 */

import type { ReadFile } from "../config/mod.ts";
import type {
  DeliveredDocument,
  Diagnostic,
  Entry,
  EntryOrigin,
} from "../model/mod.ts";
import { parseFile } from "../parser/mod.ts";

/** Result of {@linkcode loadDeliveredCorpus}. */
export interface LoadDeliveredCorpusResult {
  readonly entries: readonly Entry[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Human-facing label of a delivered document's providing tier. */
export function corpusOriginLabel(doc: DeliveredDocument): string {
  return `${doc.profileId}@${doc.profileVersion}`;
}

/** Index delivered documents by absolute path — used by CLI/LSP callers to
 * recognise corpus locations when rendering diagnostics. */
export function buildCorpusIndex(
  delivers: readonly DeliveredDocument[],
): ReadonlyMap<string, DeliveredDocument> {
  const out = new Map<string, DeliveredDocument>();
  for (const d of delivers) out.set(d.absPath, d);
  return out;
}

/**
 * Load the delivered corpus of an effective profile chain. Iterates
 * `delivers` in order (parent-first + manifest order — the deterministic
 * injection order), so the returned entry order is stable across runs.
 */
export async function loadDeliveredCorpus(
  delivers: readonly DeliveredDocument[],
  readFile: ReadFile,
): Promise<LoadDeliveredCorpusResult> {
  const entries: Entry[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const doc of delivers) {
    const content = await readFile(doc.absPath);
    if (content === undefined) {
      diagnostics.push({
        code: doc.corpus ? "PROFILE-DELIVERS-001" : "PROFILE-DELIVERS-002",
        severity: doc.corpus ? "error" : "warning",
        message: `delivered ${doc.corpus ? "corpus" : "document"} file ` +
          `'${doc.path}' declared by ${corpusOriginLabel(doc)} is missing ` +
          `from the profile package`,
        location: { file: doc.absPath, line: 1, column: 1 },
      });
      continue;
    }
    if (!doc.corpus) continue; // docs-only: existence check only, never parsed
    const parsed = await parseFile(content, { file: doc.absPath });
    for (const d of parsed.diagnostics) {
      diagnostics.push({
        ...d,
        message: `delivered by ${corpusOriginLabel(doc)}: ${d.message}`,
      });
    }
    const origin: EntryOrigin = {
      kind: "profile",
      profileId: doc.profileId,
      profileVersion: doc.profileVersion,
    };
    entries.push(...parsed.entries.map((e) => ({ ...e, origin })));
  }
  return { entries, diagnostics };
}
