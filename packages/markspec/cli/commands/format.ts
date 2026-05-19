/**
 * @module cli/commands/format
 *
 * `markspec format` — stamp ULIDs, fix indentation, normalize attributes.
 */

import { Command } from "@cliffy/command";
import { loadActiveProfile, readFile } from "../helpers.ts";

export const formatCmd = new Command()
  .description("Stamp ULIDs, fix indentation, normalize attributes")
  .option(
    "--check",
    "Check mode: report but don't write (exit 1 if changes needed)",
  )
  .arguments("[...files:string]")
  .action(async (options: { check?: boolean }, ...files: string[]) => {
    if (files.length === 0) {
      console.error("error: no files specified");
      console.error("usage: markspec format <file...>");
      Deno.exit(1);
    }

    const { discoverProjectRoot } = await import("../../core/mod.ts");
    const projectRoot = await discoverProjectRoot(Deno.cwd(), readFile);
    if (projectRoot !== undefined) {
      await loadActiveProfile(projectRoot);
    }

    const { format } = await import("../../core/mod.ts");

    let totalFormatted = 0;
    let totalUnchanged = 0;

    let hasErrors = false;

    for (const filePath of files) {
      let content: string;
      try {
        content = await Deno.readTextFile(filePath);
      } catch {
        console.error(`error: ${filePath}: file not found`);
        hasErrors = true;
        continue;
      }

      const result = format(content, { file: filePath });

      for (const d of result.diagnostics) {
        const loc = d.location ? `${d.location.file}:${d.location.line}` : "";
        console.error(`${d.severity}: ${loc} ${d.message}`);
      }

      if (result.changed) {
        totalFormatted++;
        if (!options.check) {
          await Deno.writeTextFile(filePath, result.output);
        }
      } else {
        totalUnchanged++;
      }
    }

    const total = totalFormatted + totalUnchanged;
    console.error(
      `${totalFormatted} file(s) formatted, ${totalUnchanged} unchanged (${total} total)`,
    );

    if (hasErrors) {
      Deno.exit(1);
    }
    if (options.check && totalFormatted > 0) {
      Deno.exit(1);
    }
  });
