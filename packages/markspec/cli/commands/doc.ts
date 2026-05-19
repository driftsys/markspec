/**
 * @module cli/commands/doc
 *
 * `markspec doc build` — single document → PDF via Typst WASM.
 */

import { Command } from "@cliffy/command";
import { compileProject, requireProjectConfig } from "../helpers.ts";

export const docCmd = new Command()
  .description("Document generation")
  .command("build <file:string>")
  .description("Generate document PDF")
  .option("-o, --output <path:string>", "Output file path")
  .action(async (options: { output?: string }, file: string) => {
    const { config } = await requireProjectConfig();
    const { result: compiled, chain } = await compileProject([file]);
    const { renderPdf } = await import("../../render/mod.ts");

    const markdown = await Deno.readTextFile(file);
    const typstPackagePath = new URL(
      "../../../markspec-typst/",
      import.meta.url,
    ).pathname;
    const sourceFilePath = new URL(file, `file://${Deno.cwd()}/`).pathname;
    const result = renderPdf(markdown, {
      compiled,
      config,
      typstPackagePath,
      sourceFilePath,
      profile: chain?.effective,
    });

    for (const d of result.diagnostics) {
      console.error(`${d.severity}[${d.code}]: ${d.message}`);
    }

    if (result.output.length === 0) {
      console.error("error: PDF rendering failed");
      Deno.exit(1);
    }

    const outPath = options.output ?? file.replace(/\.md$/, ".pdf");
    await Deno.writeFile(outPath, result.output);
    console.error(`wrote ${outPath}`);
  });
