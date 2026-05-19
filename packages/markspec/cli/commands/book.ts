/**
 * @module cli/commands/book
 *
 * `markspec book build` — multi-chapter → static HTML site.
 * `markspec book dev`   — live preview (not yet implemented).
 */

import { Command } from "@cliffy/command";
import type { BookStructure, Chapter } from "../../book/mod.ts";
import {
  loadActiveProfile,
  makeGitFile,
  notImplemented,
  requireProjectConfig,
} from "../helpers.ts";

export const bookCmd = new Command()
  .description("Book generation")
  .command("build")
  .description("Generate HTML book from SUMMARY.md")
  .option("-o, --output <dir:string>", "Output directory", { default: "_site" })
  .option("-s, --summary <file:string>", "SUMMARY.md path", {
    default: "SUMMARY.md",
  })
  .action(async (options: { output: string; summary: string }) => {
    const { config, projectRoot } = await requireProjectConfig();
    const bookChain = await loadActiveProfile(projectRoot);

    // Read SUMMARY.md
    let summaryMd = "";
    try {
      summaryMd = await Deno.readTextFile(options.summary);
    } catch {
      console.error(`error: ${options.summary}: file not found`);
      Deno.exit(1);
    }

    const { parseSummary, buildBook } = await import("../../book/mod.ts");
    const { compile } = await import("../../core/mod.ts");

    const structure = parseSummary(summaryMd);

    // Collect chapter paths
    const allPaths = _collectPaths(structure);

    // Read all chapter files
    const files = new Map<string, string>();
    for (const p of allPaths) {
      try {
        files.set(p, await Deno.readTextFile(p));
      } catch {
        console.error(`warning: chapter file not found: ${p}`);
      }
    }

    // Compile for traceability context (profile-aware for coloring)
    const compiled = await compile([...files.keys()], {
      readFile: (p) => Deno.readTextFile(p),
      profile: bookChain?.effective ?? undefined,
      statFile: (p) =>
        Deno.stat(p).then((s) => ({ mtime: s.mtime })).catch(() => undefined),
      gitFile: makeGitFile(false),
    });

    const result = buildBook(structure, {
      files,
      compiled,
      config,
      profile: bookChain?.effective,
    });

    for (const d of result.diagnostics) {
      console.error(`${d.severity}[${d.code}]: ${d.message}`);
    }

    // Write output
    await Deno.mkdir(options.output, { recursive: true });
    for (const chapter of result.chapters) {
      const slug = chapter.path.replace(/\.md$/, "").replace(/\//g, "-");
      const outPath = `${options.output}/${slug}.html`;
      await Deno.writeTextFile(outPath, _wrapHtml(chapter.title, chapter.html));
      console.error(`wrote ${outPath}`);
    }

    // Write index.html linking all chapters
    const indexHtml = _indexHtml(
      config.name ?? "Book",
      result.chapters.map((c) => ({
        title: c.title,
        slug: c.path.replace(/\.md$/, "").replace(/\//g, "-"),
      })),
    );
    await Deno.writeTextFile(`${options.output}/index.html`, indexHtml);
    console.error(`wrote ${options.output}/index.html`);
  })
  .command("dev")
  .description("Live preview with hot reload")
  .action(notImplemented("book dev"));

/** Collect all chapter paths from a BookStructure. */
function _collectPaths(structure: BookStructure): string[] {
  const paths: string[] = [];
  for (const c of structure.prefixChapters) if (c.path) paths.push(c.path);
  for (const part of structure.parts) {
    for (const c of _flatChapters(part.chapters)) {
      if (c.path) paths.push(c.path);
    }
  }
  for (const c of structure.suffixChapters) if (c.path) paths.push(c.path);
  return paths;
}

function _flatChapters(chapters: readonly Chapter[]): Chapter[] {
  return chapters.flatMap((c) => [c, ..._flatChapters(c.subChapters)]);
}

/** Wrap a chapter body in a minimal HTML shell. */
function _wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${_escHtml(title)}</title>
  <link rel="stylesheet" href="markspec.css">
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

/** Generate a minimal index page. */
function _indexHtml(
  bookTitle: string,
  chapters: readonly { title: string; slug: string }[],
): string {
  const links = chapters
    .map((c) => `  <li><a href="${c.slug}.html">${_escHtml(c.title)}</a></li>`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${_escHtml(bookTitle)}</title>
  <link rel="stylesheet" href="markspec.css">
</head>
<body>
<h1>${_escHtml(bookTitle)}</h1>
<ul>
${links}
</ul>
</body>
</html>
`;
}

function _escHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  );
}
