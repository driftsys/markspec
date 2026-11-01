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

import { PROJECT_ARG_SCHEMA } from "./fan_out.ts";
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

/** A search hit tagged with the label of the project it comes from. */
export interface ProjectHit {
  readonly label: string;
  readonly hit: ScoredEntry;
}

/**
 * Apply one `limit` to the hits of several projects. `hitsPerProject`
 * lists the projects in label order; each `hits` list is already sorted
 * by {@linkcode scoreEntries}. Returns the best `limit` hits of all
 * projects in one list, highest score first. Equal scores keep project
 * label order, then the order within the project.
 */
export function rankAcrossProjects(
  hitsPerProject: readonly {
    readonly label: string;
    readonly hits: readonly ScoredEntry[];
  }[],
  limit: number,
): ProjectHit[] {
  return hitsPerProject
    .flatMap(({ label, hits }) => hits.map((hit) => ({ label, hit })))
    // Array.prototype.sort is stable, so equal scores keep the order above.
    .sort((a, b) => b.hit.score - a.hit.score)
    .slice(0, limit);
}

/**
 * Render the search answer for several projects: one ranked list where
 * each hit names its project, followed by one line per project that
 * failed. With no hit and no failure, returns the same text as
 * {@linkcode renderSearchResults} with no hits.
 */
export function renderProjectSearchResults(
  hits: readonly ProjectHit[],
  query: string,
  errors: readonly { readonly label: string; readonly message: string }[],
): string {
  let text = hits.length === 0 ? renderSearchResults([], query) : renderLines(
    hits.map(({ label, hit }) => ({
      entry: hit.entry,
      note: `project: ${label}, score ${hit.score}`,
    })),
    query,
  );
  if (errors.length > 0) {
    text += "\nErrors:\n\n" +
      errors.map(({ label, message }) =>
        `- Error in project ${label}: ${message}\n`
      ).join("");
  }
  return text;
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
  return renderLines(
    hits.map(({ entry, score }) => ({ entry, note: `score ${score}` })),
    query,
  );
}

/** The heading and one list line per hit, with `note` in parentheses. */
function renderLines(
  hits: readonly {
    readonly entry: ScoredEntry["entry"];
    readonly note: string;
  }[],
  query: string,
): string {
  const lines: string[] = [
    `# Search results for "${query}" (${hits.length} ${
      hits.length === 1 ? "match" : "matches"
    })`,
    "",
  ];
  for (const { entry, note } of hits) {
    lines.push(
      `- [${entry.displayId}](${
        entryUri(entry.displayId)
      }) — ${entry.title} (${note})`,
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
    project: PROJECT_ARG_SCHEMA,
  },
  required: ["query"],
  additionalProperties: false,
} as const;

/** Tool descriptor metadata used by the MCP tools/list handler. */
export const ENTRY_SEARCH_DESCRIPTOR = {
  name: "entry_search",
  description:
    `TRIGGER when: user asks to find/list/show/search requirements, specifications, ICDs, architecture descriptions, or tests about X; mentions a display ID like STK_0001, SAD_AEB_0042, or ICD_BRK_0010; or asks "what requirements cover X", "where is Y specified", "list stakeholder requirements", "show ASIL-B safety requirements". PREFER over: grep, Read, Glob on Markdown files — this returns ranked matches from the compiled traceability graph in one call instead of N file reads.\n\nReturns up to 100 ranked matches as Markdown links to markspec://entry/{id} resources, searching across display IDs and titles. Limit: 5–20 for broad exploration, 50+ only when listing every match in a domain. With several projects, 'limit' is the total number of matches across all projects: one list ranked by score, each match naming its project.\n\nOptional 'project' limits the answer to one project label from project_list.\n\nSKIP when: returns "No MarkSpec project found" — this workspace doesn't use MarkSpec; stop calling MarkSpec tools.`,
  inputSchema: ENTRY_SEARCH_INPUT_SCHEMA,
  annotations: {
    title: "Search entries",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
