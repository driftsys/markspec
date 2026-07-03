/**
 * @module core/profile/delivered
 *
 * Loader for profile-delivered documents (ADR-030). Checks every delivered
 * file's existence (PROFILE-DELIVERS-001/002), parses the `corpus: true`
 * files, and stamps each parsed entry with its profile origin. Pure — all
 * I/O via the injected {@linkcode ReadFile}.
 */

import { SEPARATOR } from "@std/path";
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

/**
 * Canonicalises a path, resolving symlinks (e.g. `Deno.realPath`). Injected so
 * core stays runtime-agnostic. Supplied by callers to the delivered-path
 * containment guard (#699); omitting it disables the guard.
 */
export type RealPath = (path: string) => Promise<string>;

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
  realPath?: RealPath,
): Promise<LoadDeliveredCorpusResult> {
  const entries: Entry[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const doc of delivers) {
    if (realPath && !(await deliveredPathIsContained(doc, realPath))) {
      diagnostics.push({
        code: "PROFILE-DELIVERS-005",
        severity: "error",
        message: `delivered ${doc.corpus ? "corpus" : "document"} file ` +
          `'${doc.path}' declared by ${corpusOriginLabel(doc)} resolves ` +
          `outside the profile package (symlink escape) and was not read`,
        location: { file: doc.absPath, line: 1, column: 1 },
      });
      continue;
    }
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

/**
 * True when `doc`'s real (symlink-resolved) path stays within its profile's
 * `baseDir` — the delivered-path containment guard (#699). A malicious profile
 * (pulled via `extends: git+…`, which preserves symlinks) can deliver a `.md`
 * that is actually a symlink to an arbitrary local file (`~/.ssh/id_rsa`); the
 * string-level path checks (PROFILE-DELIVERS-003/004) validate the declared
 * path, not the symlink target, so a real-path containment check is the only
 * thing that stops the read.
 *
 * Degrades to `true` (allow) when the doc carries no `baseDir` or when the
 * paths cannot be canonicalised (e.g. the file is missing) — a missing file is
 * left to the existing PROFILE-DELIVERS-001/002 checks. Shared by the MCP
 * `readDeliveredDocument` read path, which faces the same vector.
 */
export async function deliveredPathIsContained(
  doc: DeliveredDocument,
  realPath: RealPath,
): Promise<boolean> {
  if (doc.baseDir === undefined) return true;
  let realBase: string;
  let realTarget: string;
  try {
    realBase = await realPath(doc.baseDir);
    realTarget = await realPath(doc.absPath);
  } catch {
    return true; // unresolvable (e.g. missing) — handled by 001/002 downstream
  }
  if (realTarget === realBase) return true;
  const prefix = realBase.endsWith(SEPARATOR) ? realBase : realBase + SEPARATOR;
  return realTarget.startsWith(prefix);
}
