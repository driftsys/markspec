/**
 * @module lsp/uxil
 *
 * LSP-side uxil helpers — pure functions that compute hover content,
 * completion items, and go-to-declaration targets for `ux:` references.
 * Consume the corpus UxRegistry from core/uxil/registry.ts. Mirrors
 * lsp/typl.ts's shape and lsp/hover.ts's token-scanning pattern.
 *
 * Profile-free by design: WorkspaceIndex.getUxRegistry(profile) applies
 * the uxilDeclaringTypes gate (S9 #727's Tier-1 opacity guarantee)
 * before a registry ever reaches these functions — an `undefined`
 * registry from the caller just means "nothing resolves," never
 * "check the profile" (S10 #728).
 */

import type { SurfaceRecord, UxRef, UxRegistry } from "../core/uxil/mod.ts";

/** Character set for a `ux:` reference token: identifier chars plus
 * the uxil DSL's structural characters (core/uxil/lexer.ts's token
 * set, minus comma and the `->` arrow — neither appears in a bare
 * citation or declaration head). */
const UX_REF_CHAR_RE = /[A-Za-z0-9_.:/!@{}]/;

/**
 * Return the `ux:` reference token at the given column on `line`, or
 * `undefined` when the column lies on whitespace/an unrelated
 * character, past the line end, or the contiguous run under the
 * cursor doesn't contain a `ux:` scheme at or before the cursor.
 *
 * Scans the full contiguous run of ref-charset characters around the
 * cursor first (so the cursor can sit anywhere inside the token, not
 * just at its start), then anchors on the literal `ux:` prefix within
 * that run — a real reference is always bounded by a backtick or
 * whitespace, so `run` and `"ux:" + rest` coincide in practice; the
 * anchor search keeps unrelated text fused to a ref with no separator
 * from being mistaken for part of it. A trailing sentence period (a
 * bare, non-code-span citation followed by prose) is trimmed,
 * mirroring `dollarNameAtPosition` (lsp/typl.ts).
 */
export function uxRefTokenAtPosition(
  line: string,
  column: number,
): string | undefined {
  if (column < 0 || column >= line.length) return undefined;
  if (!UX_REF_CHAR_RE.test(line[column])) return undefined;

  let start = column;
  while (start > 0 && UX_REF_CHAR_RE.test(line[start - 1])) start--;
  let end = column;
  while (end < line.length && UX_REF_CHAR_RE.test(line[end])) end++;

  const run = line.slice(start, end);
  const uxIndex = run.indexOf("ux:");
  if (uxIndex < 0) return undefined;
  if (column < start + uxIndex) return undefined;

  return run.slice(uxIndex).replace(/\.+$/, "");
}

/**
 * Return true when the text before the cursor triggers `ux:`
 * completion — a `ux:` scheme followed by an optional partial surface
 * path (letters, digits, underscore, dot). Anchored so it can't fire
 * mid-identifier (`fluxux:`) or against an unrelated colon context.
 * Stops matching once the partial reaches `/`, `@`, `!`, or `{` — this
 * story's completion is surface-path-only (no element/state/verb
 * segment completion).
 */
export function isUxRefTrigger(textBefore: string): boolean {
  return /(?:^|[^A-Za-z0-9_])ux:[A-Za-z0-9_.]*$/.test(textBefore);
}

/**
 * Extract the partial surface-path text typed after `ux:`, for
 * server-side prefix filtering. Empty when nothing has been typed yet.
 */
export function extractUxRefPartial(textBefore: string): string {
  return /ux:([A-Za-z0-9_.]*)$/.exec(textBefore)?.[1] ?? "";
}

/**
 * Resolve a parsed `ux:` reference to its declaring surface record.
 * First-declaration-wins on a duplicate path, matching the validator's
 * (UXIL-015) and the navigate-resolution check's convention.
 */
export function resolveUxRef(
  ref: UxRef,
  registry: UxRegistry,
): SurfaceRecord | undefined {
  return registry.surfaces.get(ref.surface.join("."))?.[0];
}

/**
 * Format the hover content for a `ux:` reference. With `ref.element`
 * set, the card leads with that element's verb set and description
 * (`eventDictionary`); otherwise it shows the surface's kind and
 * states. Always includes the owning entry. Returns `undefined` — no
 * hover, not a wrong one — when the surface, or a named element/state,
 * isn't found.
 */
export function formatUxHoverContent(
  ref: UxRef,
  registry: UxRegistry,
): string | undefined {
  const surface = resolveUxRef(ref, registry);
  if (!surface) return undefined;

  if (ref.element !== undefined) {
    const el = surface.elements.find((e) => e.name === ref.element);
    if (!el) return undefined;
    if (ref.state !== undefined && !el.states.includes(ref.state)) {
      return undefined;
    }
    const lines: string[] = [`### ux:${surface.path}/${el.name}`, ""];
    const meta = [`**Verbs:** ${el.verbs.join(", ")}`];
    if (el.states.length > 0) {
      meta.push(`**States:** ${el.states.join(", ")}`);
    }
    lines.push(meta.join(" · "));
    lines.push(`**Description:** ${el.eventDictionary}`);
    lines.push(
      `**Surface:** ${surface.kind} · **Owning entry:** ${surface.owningEntryDisplayId} (${surface.owningEntryFile})`,
    );
    return lines.join("\n");
  }

  if (ref.state !== undefined && !surface.states.includes(ref.state)) {
    return undefined;
  }

  const lines: string[] = [`### ux:${surface.path}`, ""];
  const meta = [`**Kind:** ${surface.kind}`];
  if (surface.states.length > 0) {
    meta.push(`**States:** ${surface.states.join(", ")}`);
  }
  lines.push(meta.join(" · "));
  lines.push(
    `**Owning entry:** ${surface.owningEntryDisplayId} (${surface.owningEntryFile})`,
  );
  return lines.join("\n");
}

/** One `ux:` completion item — protocol-independent for testability. */
export interface UxCompletionItem {
  readonly label: string;
  readonly detail: string;
}

/**
 * Build completion items for the `ux:` trigger: one item per known
 * surface path in the registry, server-side prefix-filtered against
 * `partial` (case-insensitive). `detail` shows the surface's kind and
 * owning entry.
 */
export function buildUxCompletionItems(
  registry: UxRegistry,
  partial: string,
): readonly UxCompletionItem[] {
  const needle = partial.toLowerCase();
  const items: UxCompletionItem[] = [];
  for (const [path, records] of registry.surfaces) {
    if (needle.length > 0 && !path.toLowerCase().startsWith(needle)) continue;
    const first = records[0];
    items.push({
      label: path,
      detail: `${first.kind} · ${first.owningEntryDisplayId}`,
    });
  }
  return items;
}
