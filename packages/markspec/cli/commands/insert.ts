/**
 * @module cli/commands/insert
 *
 * `markspec insert` — append a scaffolded entry block to a file
 * (agent write path).
 */

import { Command } from "@cliffy/command";
import { compileProject } from "../helpers.ts";
import { nextDisplayId, resolveTypePattern } from "./id_helpers.ts";

export const insertCmd = new Command()
  .description("Append a scaffolded entry block to <file> (agent write path)")
  .option("--print", "Also echo the inserted block to stdout for inspection")
  .arguments("<type:string> <file:string>")
  .action(
    async (
      options: { print?: boolean },
      typeName: string,
      filePath: string,
    ) => {
      // Verify target exists before doing project work.
      let original: string;
      try {
        original = await Deno.readTextFile(filePath);
      } catch {
        console.error(`error: ${filePath}: file not found`);
        Deno.exit(1);
      }

      const { result, chain } = await compileProject([filePath]);
      if (!chain) {
        console.error(`error: insert requires a profile; none configured`);
        Deno.exit(1);
      }
      const pattern = resolveTypePattern(typeName, chain, "insert");
      const displayId = nextDisplayId(pattern, result.entries.values());

      const { ulid } = await import("@std/ulid");
      const id = ulid();

      const block =
        `- [${displayId}] ${typeName[0].toUpperCase()}${typeName.slice(1)} ` +
        `title\n\n  Body text.\n\n      Id: ${id}\n      Type: ${typeName}\n`;

      // Ensure exactly one blank line between existing content and the
      // new block. If the file ends without a trailing newline, add one
      // first.
      const separator = original.length === 0 || original.endsWith("\n\n")
        ? ""
        : original.endsWith("\n")
        ? "\n"
        : "\n\n";
      await Deno.writeTextFile(filePath, original + separator + block);

      if (options.print) {
        console.log(block);
      }
      console.error(`insert: appended ${displayId} to ${filePath}`);
    },
  );
