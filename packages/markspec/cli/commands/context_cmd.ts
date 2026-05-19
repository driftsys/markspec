/**
 * @module cli/commands/context_cmd
 *
 * `markspec context` — walk the Satisfies chain upward from an entry.
 *
 * Named `context_cmd` to avoid a clash with the built-in `Context` type.
 */

import { Command } from "@cliffy/command";
import { compileProject } from "../helpers.ts";

export const contextCmd = new Command()
  .description("Walk the Satisfies chain upward from an entry")
  .option("--depth <depth:number>", "Maximum depth to walk", { default: 10 })
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .arguments("<id:string> <paths...:string>")
  .action(
    async (
      options: { depth: number; format?: string },
      id: string,
      ...paths: string[]
    ) => {
      const { result, chain: _profileChain } = await compileProject(paths);
      const entry = result.entries.get(id);

      if (!entry) {
        console.error(`error: entry not found: ${id}`);
        Deno.exit(1);
      }

      // Walk the Satisfies chain upward.
      const chain: Array<{ displayId: string; title: string; depth: number }> =
        [];
      const visited = new Set<string>();
      let currentIds = [id];
      let depth = 0;

      // Add the starting entry at depth 0.
      chain.push({ displayId: entry.displayId, title: entry.title, depth: 0 });
      visited.add(id);

      while (depth < options.depth && currentIds.length > 0) {
        const nextIds: string[] = [];
        for (const currentId of currentIds) {
          const links = result.forward.get(currentId) ?? [];
          for (const link of links) {
            if (link.kind === "satisfies" && !visited.has(link.to)) {
              visited.add(link.to);
              const target = result.entries.get(link.to);
              if (target) {
                chain.push({
                  displayId: target.displayId,
                  title: target.title,
                  depth: depth + 1,
                });
                nextIds.push(link.to);
              }
            }
          }
        }
        currentIds = nextIds;
        depth++;
      }

      if (options.format === "json") {
        console.log(JSON.stringify(chain, null, 2));
      } else {
        for (const item of chain) {
          const indent = "  ".repeat(item.depth);
          console.log(`${indent}${item.displayId}  ${item.title}`);
        }
      }
    },
  );
