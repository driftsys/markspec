/**
 * @module cli/commands/next_id
 *
 * `markspec next-id` — print the next available display ID for a type.
 */

import { Command } from "@cliffy/command";
import { compileProject } from "../helpers.ts";
import { nextDisplayId, resolveTypePattern } from "./id_helpers.ts";

export const nextIdCmd = new Command()
  .description("Print the next available display ID for a type")
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .arguments("<type:string> <paths...:string>")
  .action(
    async (
      options: { format?: string },
      typeName: string,
      ...paths: string[]
    ) => {
      const { result, chain } = await compileProject(paths);
      if (!chain) {
        console.error(`error: next-id requires a profile; none configured`);
        Deno.exit(1);
      }
      const pattern = resolveTypePattern(typeName, chain, "next-id");
      const displayId = nextDisplayId(pattern, result.entries.values());

      if (options.format === "json") {
        console.log(JSON.stringify({ type: typeName, displayId }));
      } else {
        console.log(displayId);
      }
    },
  );
