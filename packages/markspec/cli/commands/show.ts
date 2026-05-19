/**
 * @module cli/commands/show
 *
 * `markspec show` — show details of a single entry by ID.
 */

import { Command } from "@cliffy/command";
import { compileProject } from "../helpers.ts";

export const showCmd = new Command()
  .description("Show details of a single entry by ID")
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .arguments("<id:string> <paths...:string>")
  .action(
    async (options: { format?: string }, id: string, ...paths: string[]) => {
      const { result, chain: _chain } = await compileProject(paths);
      const entry = result.entries.get(id);

      if (!entry) {
        console.error(`error: entry not found: ${id}`);
        Deno.exit(1);
      }

      const forwardLinks = result.forward.get(id) ?? [];
      const reverseLinks = result.reverse.get(id) ?? [];

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
        console.log(
          `  Source: ${entry.location.file}:${entry.location.line}:${entry.location.column}`,
        );
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
