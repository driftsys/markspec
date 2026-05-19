/**
 * @module cli/commands/report
 *
 * `markspec report` — generate traceability matrix or coverage report.
 */

import { Command } from "@cliffy/command";
import { compileProject } from "../helpers.ts";

export const reportCmd = new Command()
  .description("Generate traceability matrix or coverage report")
  .option(
    "--format <format:string>",
    "Output format (md|json|csv)",
    { default: "md" },
  )
  .option("--scope <scope:string>", "Filter by domain abbreviation")
  .option("--label <label:string>", "Filter by label value")
  .option("--output <output:string>", "Write to file instead of stdout")
  .arguments("<kind:string> <paths...:string>")
  .action(
    async (
      options: {
        format?: string;
        scope?: string;
        label?: string;
        output?: string;
      },
      kind: string,
      ...paths: string[]
    ) => {
      if (kind !== "traceability" && kind !== "coverage") {
        console.error(
          `error: unknown report kind '${kind}' (expected: traceability, coverage)`,
        );
        Deno.exit(1);
      }

      const fmt = options.format as "md" | "json" | "csv";
      if (!["md", "json", "csv"].includes(fmt)) {
        console.error(
          `error: unknown format '${fmt}' (expected: md, json, csv)`,
        );
        Deno.exit(1);
      }

      const { result: compiled, chain: _chain } = await compileProject(paths);
      const { report } = await import("../../core/mod.ts");

      const output = report(compiled, {
        kind,
        format: fmt,
        scope: options.scope,
        label: options.label,
      });

      if (options.output) {
        await Deno.writeTextFile(options.output, output);
        console.error(`report written to ${options.output}`);
      } else {
        console.log(output);
      }
    },
  );
