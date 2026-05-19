/**
 * @module cli/commands/deck
 *
 * `markspec deck build` / `markspec deck dev` — presentation generation
 * (not yet implemented).
 */

import { Command } from "@cliffy/command";
import { notImplemented } from "../helpers.ts";

export const deckCmd = new Command()
  .description("Presentation generation")
  .command("build <file:string>")
  .description("Generate presentation PDF")
  .action(notImplemented("deck build"))
  .command("dev <file:string>")
  .description("Live preview")
  .action(notImplemented("deck dev"));
