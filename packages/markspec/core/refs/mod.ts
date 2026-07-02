/**
 * @module core/refs
 *
 * Project-aware trace-reference canonicalisation + rename-healing (issue #593,
 * Slice 4). Pure module: given a project-wide display-ID ↔ ULID index and the
 * lockfile's edge ledger, rewrite a file's trace-attribute values losslessly —
 * ULID → current display ID (canonicalise), and a stale display ID → the
 * ledger's stable target ULID → the target's current display ID (heal).
 *
 * Architecture: composed AROUND the pure `core/formatter` by the `markspec fmt`
 * CLI. It MUST NOT import `core/formatter`, and `core/formatter` MUST NOT import
 * it (WASM-migration purity guard, AGENTS.md).
 */

import type { Entry } from "../model/mod.ts";
import {
  CORE_RELATIONS,
  DISPLAY_ID_RE,
  LOCK_EXTRA_INVERSE_KEYS,
  ULID_RE,
} from "../model/mod.ts";
import type { LockEdge } from "../lock/mod.ts";
import { FENCE_RE } from "../util/fence.ts";

/**
 * Trace-attribute keys whose values are canonicalised/healed: the core
 * relations plus `Verified-by`. Derived from {@linkcode CORE_RELATIONS} so new
 * relations are covered automatically.
 */
export const TRACE_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  ...CORE_RELATIONS.map((r) => r.attr),
  ...LOCK_EXTRA_INVERSE_KEYS,
]);

/** Bidirectional display-ID ↔ ULID resolution index over a project's entries. */
export interface RefIndex {
  readonly displayIdToUlid: ReadonlyMap<string, string>;
  readonly ulidToDisplayId: ReadonlyMap<string, string>;
}

/**
 * Build a {@linkcode RefIndex} from a project's entries. First-entry-wins on
 * duplicate keys (validator/workspace convention). Entries without a ULID are
 * skipped.
 */
export function buildRefIndex(entries: readonly Entry[]): RefIndex {
  const displayIdToUlid = new Map<string, string>();
  const ulidToDisplayId = new Map<string, string>();
  for (const e of entries) {
    if (e.id === undefined) continue;
    if (!displayIdToUlid.has(e.displayId)) {
      displayIdToUlid.set(e.displayId, e.id);
    }
    if (!ulidToDisplayId.has(e.id)) {
      ulidToDisplayId.set(e.id, e.displayId);
    }
  }
  return { displayIdToUlid, ulidToDisplayId };
}

/** Trailer trace line: indent, key, `:` + spaces, value-rest. */
const TRACE_TRAILER_RE = /^(\s{4,})([A-Z][A-Za-z-]*)(\s*:\s*)(.*)$/;

/**
 * A `\`-continuation line of a multi-line trace value: leading indent then a
 * non-empty value-rest (no `Key:` — that sat on the first physical line).
 */
const CONTINUATION_LINE_RE = /^(\s+)(\S.*)$/;

/** Token splitter that preserves separators between value tokens. */
const VALUE_TOKEN_RE = /[^\s,]+/g;

/**
 * Rewrite trace-attribute values in `content` per the canonicalise/heal rules.
 * `entries` MUST be the parse of `content` (used to map each trailer line to its
 * source entry's stable ULID). Returns the rewritten text and whether anything
 * changed. Lossless: only resolvable value tokens are replaced.
 */
export function canonicalizeRefs(
  content: string,
  entries: readonly Entry[],
  index: RefIndex,
  ledger: readonly LockEdge[],
): { output: string; changed: boolean } {
  const ledgerByKey = new Map<string, string>();
  for (const e of ledger) {
    if (e.targetUlid === undefined) continue;
    ledgerByKey.set(
      `${e.sourceUlid} ${e.relation} ${e.authoredTarget}`,
      e.targetUlid,
    );
  }

  // Sort entries by start line so binary-search for source ULID is correct.
  const sorted = [...entries].sort((a, b) => a.location.line - b.location.line);

  /** Return the ULID of the entry whose block contains the given 1-based line. */
  const sourceUlidForLine = (line1: number): string | undefined => {
    let lo = 0;
    let hi = sorted.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].location.line <= line1) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans >= 0 ? sorted[ans].id : undefined;
  };

  const lines = content.split("\n");
  let changed = false;
  // Track fenced-code regions so illustrative trailers inside ``` / ~~~
  // blocks (e.g. `Realizes: 01HGW...` in a ```markdown example) are never
  // "healed" against the real ref index — the same verbatim-region rule
  // every other fmt pass honors (§5.1; cf. `collapseBlankLines`). Without
  // this, `markspec fmt` rewrites example IDs in spec/ADR docs on every run
  // (#668). The parser/validator already treat fenced content as inert.
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    // Strip a trailing CR before matching so CRLF files are handled (the
    // trailer regex ends in `$`, which `\r` would block) and re-append it on
    // rewrite so line endings stay byte-for-byte lossless.
    const cr = lines[i].endsWith("\r");
    const bare = cr ? lines[i].slice(0, -1) : lines[i];
    if (FENCE_RE.test(bare)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = TRACE_TRAILER_RE.exec(bare);
    if (!m) continue;
    const [, indent, key, sep, rest] = m;
    if (!TRACE_ATTRIBUTE_KEYS.has(key)) continue;
    const sourceUlid = sourceUlidForLine(i + 1);

    // Rewrite the key line's value, preserving any trailing `\` continuation
    // marker (only resolvable tokens change — indentation, separators and the
    // backslash stay byte-for-byte).
    const newRest = rewriteValuePreservingContinuation(
      rest,
      sourceUlid,
      key,
      index,
      ledgerByKey,
    );
    if (newRest !== rest) {
      lines[i] = `${indent}${key}${sep}${newRest}${cr ? "\r" : ""}`;
      changed = true;
    }

    // Multi-line value: a `\`-continued value splits across physical lines,
    // each non-final line ending in `\`. Walk the continuation lines (indent +
    // value, no key) and rewrite each the same way, stopping at the first line
    // that does not end in `\`. `i` is advanced past the consumed lines so the
    // outer loop does not re-scan them (#606).
    let continues = rest.endsWith("\\");
    let j = i;
    while (continues && j + 1 < lines.length) {
      j++;
      const crj = lines[j].endsWith("\r");
      const barej = crj ? lines[j].slice(0, -1) : lines[j];
      // A fence marker is never continuation text. An indented one (e.g.
      // `  ```md`) would otherwise match CONTINUATION_LINE_RE and be
      // swallowed here without toggling `inFence`, desyncing fence tracking
      // for the rest of the file. Back out and let the outer loop toggle it.
      if (FENCE_RE.test(barej)) {
        j--;
        break;
      }
      const cm = CONTINUATION_LINE_RE.exec(barej);
      if (!cm) {
        j--; // not a continuation line — leave it for the outer loop
        break;
      }
      const [, cIndent, cVal] = cm;
      const newVal = rewriteValuePreservingContinuation(
        cVal,
        sourceUlid,
        key,
        index,
        ledgerByKey,
      );
      if (newVal !== cVal) {
        lines[j] = `${cIndent}${newVal}${crj ? "\r" : ""}`;
        changed = true;
      }
      continues = cVal.endsWith("\\");
    }
    i = j;
  }
  return { output: lines.join("\n"), changed };
}

/**
 * Rewrite the value tokens of one trace-value line, preserving a trailing `\`
 * continuation marker verbatim. The backslash is split off before token
 * rewriting (so it is never mistaken for a value token) and re-appended after,
 * keeping the multi-line continuation lossless.
 */
function rewriteValuePreservingContinuation(
  value: string,
  sourceUlid: string | undefined,
  relation: string,
  index: RefIndex,
  ledgerByKey: ReadonlyMap<string, string>,
): string {
  const hasBackslash = value.endsWith("\\");
  const core = hasBackslash ? value.slice(0, -1) : value;
  const rewritten = core.replace(
    VALUE_TOKEN_RE,
    (token) => rewriteToken(token, sourceUlid, relation, index, ledgerByKey),
  );
  return hasBackslash ? `${rewritten}\\` : rewritten;
}

function rewriteToken(
  token: string,
  sourceUlid: string | undefined,
  relation: string,
  index: RefIndex,
  ledgerByKey: ReadonlyMap<string, string>,
): string {
  if (ULID_RE.test(token)) {
    // Rule 1: ULID → current display ID (canonicalise).
    return index.ulidToDisplayId.get(token) ?? token;
  }
  if (!DISPLAY_ID_RE.test(token)) return token;
  if (index.displayIdToUlid.has(token)) {
    // Rule 2: current display ID — leave unchanged.
    return token;
  }
  if (sourceUlid !== undefined) {
    // Rule 3: stale display ID — try to heal via ledger.
    const targetUlid = ledgerByKey.get(
      `${sourceUlid} ${relation} ${token}`,
    );
    if (targetUlid !== undefined) {
      const healed = index.ulidToDisplayId.get(targetUlid);
      if (healed !== undefined) return healed;
    }
  }
  // Rule 4: leave untouched (URI/broken/unknown).
  return token;
}
