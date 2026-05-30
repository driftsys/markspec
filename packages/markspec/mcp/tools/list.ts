/**
 * @module mcp/tools/list
 *
 * `entry_list` MCP tool. Two modes:
 *   - `summary` (default): counts per type + total — "what's in this spec?".
 *   - `full`: the grouped listing (reuses `renderEntriesIndex`), optionally
 *     filtered by `type` / `label`, paginated to `PAGE_SIZE`.
 *
 * Promotes the `markspec://entries` resource to a tool and adds an orientation
 * summary, so agents stop grep'ing Markdown or running `markspec compile`.
 */

import type { Entry } from "../../core/mod.ts";
import { renderEntriesIndex } from "../resources/entries.ts";

/** Page size for `mode: "full"`. Fixed, not caller-tunable. */
export const PAGE_SIZE = 50;

/** Whitespace/comma token splitter for the `Labels` attribute value. */
const LABEL_SEPARATORS_RE = /[\s,]+/;

/** Options for {@linkcode renderList}. */
export interface ListOptions {
  readonly mode: "summary" | "full";
  readonly type?: string;
  readonly label?: string;
  readonly page?: number;
}

/** Return the entry's labels, parsed from its `Labels` raw attribute. */
function labelsOf(entry: Entry): string[] {
  const out: string[] = [];
  for (const attr of entry.rawAttributes) {
    if (attr.key !== "Labels") continue;
    for (const tok of attr.value.split(LABEL_SEPARATORS_RE)) {
      if (tok.length > 0) out.push(tok);
    }
  }
  return out;
}

/** Render the summary view: total + per-type counts, sorted by type name. */
function renderSummary(entries: readonly Entry[]): string {
  const byType = new Map<string, number>();
  for (const e of entries) {
    const t = e.type ?? "untyped";
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  const lines: string[] = [
    `# Specification overview (${entries.length} entries)`,
    "",
  ];
  if (entries.length === 0) {
    lines.push("No entries in this project.");
    return lines.join("\n") + "\n";
  }
  lines.push("## Entry counts by type", "");
  for (const t of [...byType.keys()].sort()) {
    lines.push(`- ${t}: ${byType.get(t)}`);
  }
  lines.push(
    "",
    "Call entry_list with mode=full for the full listing (paginated), or filter by type or label.",
  );
  return lines.join("\n") + "\n";
}

/**
 * Render the entry list / overview.
 *
 * `summary` ignores `type` / `label` / `page`. `full` filters first
 * (`type` then `label`), then paginates the filtered set to {@linkcode PAGE_SIZE}.
 */
export function renderList(
  entries: readonly Entry[],
  options: ListOptions,
): string {
  if (options.mode === "summary") return renderSummary(entries);

  let filtered = [...entries];
  if (options.type) filtered = filtered.filter((e) => e.type === options.type);
  if (options.label) {
    filtered = filtered.filter((e) => labelsOf(e).includes(options.label!));
  }

  const total = filtered.length;
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const startIdx = (page - 1) * PAGE_SIZE;
  const slice = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  if (slice.length === 0) {
    return `# Entries\n\nNo entries on page ${page} (${total} total match).\n`;
  }

  const body = renderEntriesIndex(slice);
  const from = startIdx + 1;
  const to = startIdx + slice.length;
  const footerLines = [`Showing ${from}–${to} of ${total}.`];
  if (to < total) {
    footerLines.push(
      `Call entry_list with mode=full, page=${page + 1} for more.`,
    );
  }
  return `${body}\n${footerLines.join(" ")}\n`;
}

/** Tool input schema. */
export const ENTRY_LIST_INPUT_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["summary", "full"] },
    type: { type: "string" },
    label: { type: "string" },
    page: { type: "integer", minimum: 1 },
  },
  additionalProperties: false,
} as const;

/** Tool descriptor metadata. */
export const ENTRY_LIST_DESCRIPTOR = {
  name: "entry_list",
  description:
    `TRIGGER when: user asks "what's in this spec", "list all requirements", "give me an overview", "how many X are there", or wants to browse entries. Defaults to a summary (per-type counts); pass mode=full for the listing (paginated, 50/page), optionally filtered by type or label. PREFER over: grep across Markdown files or 'markspec compile' — this lists the compiled graph.\n\nFor one entry's detail use entry_show; for the graph around an entry use entry_neighborhood.`,
  inputSchema: ENTRY_LIST_INPUT_SCHEMA,
  annotations: {
    title: "List / overview of entries",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
