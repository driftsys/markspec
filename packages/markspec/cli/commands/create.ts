/**
 * @module cli/commands/create
 *
 * `markspec create` — scaffold a new entry block for a profile-declared
 * type and print it to stdout.
 */

import { Command } from "@cliffy/command";
import { compileProject } from "../helpers.ts";
import { nextDisplayId, resolveTypePattern } from "./id_helpers.ts";

export const createCmd = new Command()
  .description("Scaffold a new entry block for a profile-declared type")
  .arguments("<type:string> <paths...:string>")
  .action(async (_options, typeName: string, ...paths: string[]) => {
    const { result, chain } = await compileProject(paths);
    if (!chain) {
      console.error(`error: create requires a profile; none configured`);
      Deno.exit(1);
    }
    const pattern = resolveTypePattern(typeName, chain, "create");
    const displayId = nextDisplayId(pattern, result.entries.values());

    const { ulid } = await import("@std/ulid");
    const id = ulid();

    const block =
      `- [${displayId}] ${typeName[0].toUpperCase()}${
        typeName.slice(1)
      } title\n` +
      `\n  Body text.\n\n      Id: ${id}\n      Type: ${typeName}\n`;
    console.log(block);
  });
