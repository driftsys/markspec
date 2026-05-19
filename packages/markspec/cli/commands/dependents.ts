/**
 * @module cli/commands/dependents
 *
 * `markspec dependents` — list all entries that depend on a given entry.
 */

import { Command } from "@cliffy/command";
import { makeDisplayId } from "../../core/mod.ts";
import { compileProject } from "../helpers.ts";

export const dependentsCmd = new Command()
  .description("List all entries that depend on a given entry")
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .arguments("<id:string> <paths...:string>")
  .action(
    async (options: { format?: string }, id: string, ...paths: string[]) => {
      const { result, chain: _chain } = await compileProject(paths);
      const displayId = makeDisplayId(id);
      const entry = result.entries.get(displayId);

      if (!entry) {
        console.error(`error: entry not found: ${id}`);
        Deno.exit(1);
      }

      const reverseLinks = result.reverse.get(displayId) ?? [];

      if (options.format === "json") {
        const output = reverseLinks.map((link) => ({
          from: link.from,
          kind: link.kind,
          title: result.entries.get(link.from)?.title ?? "",
        }));
        console.log(JSON.stringify(output, null, 2));
      } else {
        if (reverseLinks.length === 0) {
          console.log(`No dependents for ${id}`);
        } else {
          for (const link of reverseLinks) {
            const source = result.entries.get(link.from);
            const title = source ? `  ${source.title}` : "";
            console.log(`${link.from}  ${link.kind}${title}`);
          }
        }
      }
    },
  );
