/**
 * @module cli/commands/show
 *
 * `markspec show` — show details of a single entry by ID.
 */

import { Command } from "@cliffy/command";
import { buildCorpusIndex, makeDisplayId } from "../../core/mod.ts";
import { compileProject, renderDiagnosticLocation } from "../helpers.ts";

export const showCmd = new Command()
  .description("Show details of a single entry by ID")
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .arguments("<id:string> <paths...:string>")
  .action(
    async (options: { format?: string }, id: string, ...paths: string[]) => {
      const { result, chain } = await compileProject(paths);
      const displayId = makeDisplayId(id);
      const entry = result.entries.get(displayId);

      if (!entry) {
        console.error(`error: entry not found: ${id}`);
        Deno.exit(1);
      }

      const forwardLinks = result.forward.get(displayId) ?? [];
      const reverseLinks = result.reverse.get(displayId) ?? [];

      if (options.format === "json") {
        const output = {
          ...entry,
          forwardLinks,
          reverseLinks,
        };
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log(`${entry.displayId}  ${entry.title}`);
        if (entry.type) {
          console.log(`  Type: ${entry.type}`);
        }
        console.log(`  Shape: ${entry.shape}`);
        for (const attr of entry.rawAttributes) {
          console.log(`  ${attr.key}: ${attr.value}`);
        }
        // A corpus entry's Source renders in the stable ADR-029 form
        // (`<profile-id>@<version>:<relative-path>:<line>`) — never the
        // raw cache/package absolute path. Project entries keep the
        // plain `<file>:<line>` form. Column is appended in both cases.
        const corpusIndex = buildCorpusIndex(chain?.effective.delivers ?? []);
        const source = renderDiagnosticLocation(
          { location: entry.location },
          corpusIndex,
        );
        console.log(`  Source: ${source}:${entry.location.column}`);
        if (forwardLinks.length > 0) {
          console.log("  Outgoing links:");
          for (const link of forwardLinks) {
            console.log(`    ${link.kind} → ${link.to}`);
          }
        }
        if (reverseLinks.length > 0) {
          console.log("  Incoming links:");
          for (const link of reverseLinks) {
            console.log(`    ${link.kind} ← ${link.from}`);
          }
        }
      }
    },
  );
