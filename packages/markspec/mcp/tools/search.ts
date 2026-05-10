/**
 * @module mcp/tools/search
 *
 * `entry_search` MCP tool.
 *
 * Inputs: `{ query: string, limit?: number }`.
 * Output: Markdown list of ranked matches over display IDs and titles.
 *
 * Ranking rules:
 *   +10 query is prefix of displayId
 *   +5  query is substring of displayId
 *   +3  per query-token exact-matching a title-token
 *   +1  per query-token substring-matching a title-token
 *   +2  all query-tokens appear in title (any order)
 */

import type { Entry } from "../../core/mod.ts";
import { entryUri } from "../uri.ts";

/** A ranked search result. */
export interface ScoredEntry {
  readonly entry: Entry;
  readonly score: number;
}

const TOKEN_RE = /[\s_]+/g;

/**
 * Score a list of entries against a query; return top-N hits with score > 0.
 *
 * Scoring is case-insensitive. Entries with a score of zero are excluded.
 * Results are sorted descending by score, then ascending by displayId for
 * stability.
 */
export function scoreEntries(
  entries: readonly Entry[],
  query: string,
  limit: number,
): ScoredEntry[] {
  const q = query.toLowerCase();
  const qTokens = q.split(TOKEN_RE).filter(Boolean);

  const hits: ScoredEntry[] = [];
  for (const entry of entries) {
    const id = entry.displayId.toLowerCase();
    const title = entry.title.toLowerCase();
    const titleTokens = title.split(TOKEN_RE).filter(Boolean);

    let score = 0;
    if (id.startsWith(q)) {
      score += 10;
    } else if (id.includes(q)) {
      score += 5;
    }

    for (const qt of qTokens) {
      if (titleTokens.includes(qt)) {
        score += 3;
      } else if (titleTokens.some((t) => t.includes(qt))) {
        score += 1;
      }
    }
    if (qTokens.length > 0 && qTokens.every((qt) => title.includes(qt))) {
      score += 2;
    }

    if (score > 0) hits.push({ entry, score });
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      a.entry.displayId.localeCompare(b.entry.displayId),
  );
  return hits.slice(0, limit);
}

/**
 * Render search hits as a Markdown list.
 *
 * Each hit is rendered as a link using the `markspec://entry/` URI scheme,
 * followed by the entry title and its score for transparency.
 */
export function renderSearchResults(
  hits: readonly ScoredEntry[],
  query: string,
): string {
  if (hits.length === 0) {
    return `# Search results\n\nNo matches for \`${query}\`.\n`;
  }
  const lines: string[] = [
    `# Search results for "${query}" (${hits.length} ${
      hits.length === 1 ? "match" : "matches"
    })`,
    "",
  ];
  for (const { entry, score } of hits) {
    lines.push(
      `- [${entry.displayId}](${
        entryUri(entry.displayId)
      }) — ${entry.title} (score ${score})`,
    );
  }
  return lines.join("\n") + "\n";
}

/** JSON Schema for the entry_search tool input. */
export const ENTRY_SEARCH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

/** Tool descriptor metadata used by the MCP tools/list handler. */
export const ENTRY_SEARCH_DESCRIPTOR = {
  name: "entry_search",
  description:
    "Search project entries by display ID and title. Returns ranked matches as Markdown links.",
  inputSchema: ENTRY_SEARCH_INPUT_SCHEMA,
};
