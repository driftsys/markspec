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
    let failed = false;
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
        failed = true;
      } else {
        const outPath = options.output ?? file.replace(/\.md$/, ".pdf");
        await Deno.writeFile(outPath, result.output);
        console.error(`wrote ${outPath}`);
      }
    } finally {
      await cleanup();
    }
    // Exit after the cleanup: `Deno.exit` inside the try would skip it.
    if (failed) Deno.exit(1);
  });

/**
 * Ensure the markspec-typst package is reachable from the same Typst
 * workspace as the source document.
 *
 * Typst runs as a native addon that reads the real filesystem, so it cannot
 * see files embedded in a `deno compile` binary. When running from such a
 * binary (`Deno.build.standalone`), the package is copied to a folder in the
 * system temp directory, and that copy is used. The system temp directory
 * keeps the Typst workspace root (the longest common directory of the
 * package and the source, see `render/mod.ts`) at least as wide as when
 * running from source, so references such as `../assets/x.svg` keep working,
 * and a read-only document folder does not fail. If the system temp
 * directory is on another Windows drive than the source, the copy is made
 * next to the source instead, because paths on different drives share no
 * common ancestor.
 *
 * The Typst compiler also requires every input under a single workspace root.
 * On Windows the package may live on a different drive than the source
 * (e.g., installed CLI on `C:` rendering docs on `D:`). When that happens we
 * copy the package (about 1 MB) to a temp dir next to the source so the
 * workspace computation finds a real ancestor. Outside a compiled binary,
 * POSIX hosts never trigger this path.
 *
 * The returned `cleanup` is a no-op when no copy was made.
 */
async function stageTypstPackage(
  bundledPath: string,
  sourceFilePath: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const standalone = Deno.build.standalone === true;
  let stagingParent: string | undefined;
  if (standalone) {
    const systemTemp = Deno.env.get("TMPDIR") ?? Deno.env.get("TEMP") ??
      Deno.env.get("TMP") ?? "/tmp";
    const sameDrive = Deno.build.os !== "windows" ||
      parse(resolve(systemTemp)).root.toLowerCase() ===
        parse(sourceFilePath).root.toLowerCase();
    if (!sameDrive) stagingParent = dirname(sourceFilePath);
  } else {
    if (Deno.build.os !== "windows") {
      return { path: bundledPath, cleanup: () => Promise.resolve() };
    }
    const pkgRoot = parse(bundledPath).root.toLowerCase();
    const srcRoot = parse(sourceFilePath).root.toLowerCase();
    if (pkgRoot === srcRoot) {
      return { path: bundledPath, cleanup: () => Promise.resolve() };
    }
    stagingParent = dirname(sourceFilePath);
  }
  const stagingDir = await Deno.makeTempDir(
    stagingParent === undefined
      ? { prefix: "markspec-typst-" }
      : { dir: stagingParent, prefix: ".markspec-typst-" },
  );
  await copy(bundledPath, stagingDir, { overwrite: true });
  return {
    path: stagingDir,
    cleanup: () => Deno.remove(stagingDir, { recursive: true }).catch(() => {}),
  };
}
