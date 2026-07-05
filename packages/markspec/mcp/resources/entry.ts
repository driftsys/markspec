/**
 * @module mcp/resources/entry
 *
 * Renders the `markspec://entry/{displayId}` resource. Output is Markdown:
 * title, metadata (type, shape, id, location), body, attributes table,
 * outgoing links, incoming links.
 *
 * `titles` is a lookup from display ID to entry title, used to render
 * `markspec://entry/...` cross-reference labels.
 */

import {
  type Entry,
  formatEntryOrigin,
  isUpstreamEntry,
  type Link,
} from "../../core/mod.ts";
import { relativeToRoot } from "../path.ts";
import { entryUri } from "../uri.ts";

/** Render one entry to Markdown. */
export function renderEntry(
  entry: Entry,
  forwardLinks: readonly Link[],
  reverseLinks: readonly Link[],
  titles: ReadonlyMap<string, string>,
  projectRoot?: string,
): string {
  const lines: string[] = [];

  lines.push(`# ${entry.displayId} — ${entry.title}`, "");

  if (entry.type) lines.push(`**Type**: ${entry.type}`);
  lines.push(`**Shape**: ${entry.shape}`);
  if (entry.origin) {
    const verb = isUpstreamEntry(entry) ? "from upstream" : "delivered by";
    lines.push(
      `**Origin**: ${verb} ${formatEntryOrigin(entry.origin)} (read-only)`,
    );
  }
  if (entry.id) lines.push(`**Id**: \`${entry.id}\``);
  const location = `${
    relativeToRoot(entry.location.file, projectRoot)
  }:${entry.location.line}`;
  lines.push(
    isUpstreamEntry(entry)
      ? `**Location**: ${location} (in upstream ${entry.origin.upstreamId})`
      : `**Location**: ${location}`,
  );
  lines.push("");

  if (entry.body.trim().length > 0) {
    lines.push(entry.body.trimEnd(), "");
  }

  const nonIdAttrs = entry.rawAttributes.filter(
    (a) => a.key.toLowerCase() !== "id",
  );
  if (nonIdAttrs.length > 0) {
    lines.push("## Attributes", "");
    for (const a of nonIdAttrs) {
      lines.push(`- **${a.key}**: ${a.value}`);
    }
    lines.push("");
  }

  if (forwardLinks.length > 0) {
    lines.push("## Outgoing links", "");
    for (const link of forwardLinks) {
      const title = titles.get(link.to);
      const titlePart = title ? ` — ${title}` : "";
      lines.push(
        `- **${link.kind}** → [${link.to}](${entryUri(link.to)})${titlePart}`,
      );
    }
    lines.push("");
  }

  if (reverseLinks.length > 0) {
    lines.push("## Incoming links", "");
    for (const link of reverseLinks) {
      const title = titles.get(link.from);
      const titlePart = title ? ` — ${title}` : "";
      lines.push(
        `- **${link.kind}** ← [${link.from}](${
          entryUri(link.from)
        })${titlePart}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}
