/**
 * @module mcp/resources/entries
 *
 * Renders the `markspec://entries` index — an alphabetical-by-type listing
 * of every entry in the project, each as a Markdown link to its own entry
 * resource URI.
 */

import type { Entry } from "../../core/mod.ts";
import { entryUri } from "../uri.ts";

/**
 * Render the entries index to Markdown.
 *
 * Entries are grouped by type (or `"untyped"` when `entry.type` is
 * `undefined`). Groups are sorted alphabetically; entries within each
 * group are sorted by display ID. Each entry is rendered as a Markdown
 * link to its `markspec://entry/{displayId}` resource URI.
 */
export function renderEntriesIndex(entries: readonly Entry[]): string {
  const lines: string[] = [`# Entries (${entries.length})`, ""];

  if (entries.length === 0) {
    lines.push("No entries in this project.");
    return lines.join("\n") + "\n";
  }

  // Group by type (or "untyped").
  const byType = new Map<string, Entry[]>();
  for (const entry of entries) {
    const t = entry.type ?? "untyped";
    const list = byType.get(t);
    if (list) list.push(entry);
    else byType.set(t, [entry]);
  }

  const types = [...byType.keys()].sort();
  for (const type of types) {
    const list = byType.get(type)!;
    list.sort((a, b) => a.displayId.localeCompare(b.displayId));
    lines.push(`## ${type} (${list.length})`, "");
    for (const e of list) {
      lines.push(
        `- [${e.displayId}](${entryUri(e.displayId)}) — ${e.title}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
