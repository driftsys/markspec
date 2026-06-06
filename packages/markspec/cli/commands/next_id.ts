/**
 * @module cli/commands/next_id
 *
 * `markspec next-id` — print the next available display ID for a type.
 */

import { Command } from "@cliffy/command";
import { parseDisplayIdPattern } from "../../core/mod.ts";
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
      const value = nextDisplayId(pattern, result.entries.values());
      // A named (counter-less) type is not mintable: `value` is a fill-in
      // template (e.g. `SWC_NAME`), not an allocated ID. parseDisplayIdPattern
      // returns undefined only for named patterns here (malformed ones already
      // exited inside nextDisplayId), so it is a reliable discriminator.
      const named = parseDisplayIdPattern(pattern) === undefined;

      if (options.format === "json") {
        // Give structured consumers an explicit flag so an agent does not write
        // the placeholder template as if it were an allocated display ID.
        console.log(JSON.stringify(
          named
            ? { type: typeName, named: true, template: value }
            : { type: typeName, displayId: value },
        ));
      } else {
        console.log(value);
      }
    },
  );
