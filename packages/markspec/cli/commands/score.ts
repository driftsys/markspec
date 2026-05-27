/**
 * @module cli/commands/score
 *
 * `markspec score` — score a single piece of requirement prose using
 * the PA-3 lint pipeline. One-shot mode via `--text`, batch mode via
 * JSONL on stdin.
 */

import { Command } from "@cliffy/command";
import { scoreText } from "../../core/lint/mod.ts";

export const scoreCmd = new Command()
  .description(
    "Score a single requirement prose against the PA-3 rule catalog",
  )
  .option("--text <text:string>", "Inline prose to score")
  .option("--id <id:string>", "Identifier to echo in the result")
  .option(
    "--format <format:string>",
    "Output format (json|text). Default: json when stdout is not a TTY, text otherwise.",
  )
  .action(
    async (options: { text?: string; id?: string; format?: string }) => {
      if (options.text === undefined) {
        // Stdin/batch path lands in Task 4; for now require --text.
        console.error(
          "error: --text is required (stdin mode not yet implemented)",
        );
        Deno.exit(1);
      }
      const result = await scoreText(options.text, { id: options.id });
      console.log(JSON.stringify(result, null, 2));
    },
  );
