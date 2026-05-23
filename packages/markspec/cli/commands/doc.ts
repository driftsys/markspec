/**
 * @module cli/commands/doc
 *
 * `markspec doc build` — single document → PDF via Typst WASM.
 */

import { Command } from "@cliffy/command";
import { dirname, fromFileUrl, parse, resolve } from "@std/path";
import { copy } from "@std/fs/copy";
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
    const bundledTypstPackagePath = fromFileUrl(
      new URL("../../../markspec-typst/", import.meta.url),
    );
    const sourceFilePath = resolve(Deno.cwd(), file);
    const { path: typstPackagePath, cleanup } = await stageTypstPackage(
      bundledTypstPackagePath,
      sourceFilePath,
    );
    try {
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
    } finally {
      await cleanup();
    }
  });

/**
 * Ensure the markspec-typst package is reachable from the same Typst
 * workspace as the source document.
 *
 * The Typst compiler requires every input under a single workspace root.
 * On Windows the package may live on a different drive than the source
 * (e.g., installed CLI on `C:` rendering docs on `D:`), and cross-drive
 * paths share no common ancestor. When that happens we copy the package
 * (≈1 MB) to a temp dir next to the source so the workspace computation
 * finds a real ancestor. POSIX hosts never trigger this path.
 *
 * The returned `cleanup` is a no-op when no copy was made.
 */
async function stageTypstPackage(
  bundledPath: string,
  sourceFilePath: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  if (Deno.build.os !== "windows") {
    return { path: bundledPath, cleanup: () => Promise.resolve() };
  }
  const pkgRoot = parse(bundledPath).root.toLowerCase();
  const srcRoot = parse(sourceFilePath).root.toLowerCase();
  if (pkgRoot === srcRoot) {
    return { path: bundledPath, cleanup: () => Promise.resolve() };
  }
  const stagingDir = await Deno.makeTempDir({
    dir: dirname(sourceFilePath),
    prefix: ".markspec-typst-",
  });
  await copy(bundledPath, stagingDir, { overwrite: true });
  return {
    path: stagingDir,
    cleanup: () => Deno.remove(stagingDir, { recursive: true }).catch(() => {}),
  };
}
