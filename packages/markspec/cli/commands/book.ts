/**
 * @module cli/commands/book
 *
 * `markspec book build` — multi-chapter → static HTML site.
 * `markspec book dev`   — live preview (not yet implemented).
 */

import { Command } from "@cliffy/command";
import { dirname, join, relative, resolve, SEPARATOR } from "@std/path";
import type { BookStructure, Chapter } from "../../book/mod.ts";
import {
  loadActiveProfile,
  makeGitFile,
  notImplemented,
  requireProjectConfig,
} from "../helpers.ts";

interface ImageAsset {
  readonly source: string;
  readonly realSource: string;
}

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

    const { parseSummary, buildBook, slugForChapterPath } = await import(
      "../../book/mod.ts"
    );
    const { compile, isWithin } = await import("../../core/mod.ts");

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

    const realProjectRoot = await Deno.realPath(projectRoot);
    const imageAssets = new Map<string, ImageAsset>();
    const result = buildBook(structure, {
      files,
      compiled,
      config,
      profile: bookChain?.effective,
      rewriteImage: (chapter, src) => {
        const image = _relativeImageUrl(src);
        if (!image) return undefined;
        const source = resolve(dirname(chapter), ...image.segments);
        const warn = (reason: string) => {
          console.error(`warning: ${chapter}: image '${src}' ${reason}`);
        };
        if (!isWithin(projectRoot, source)) {
          warn("is outside the project");
          return undefined;
        }
        const relativePath = relative(projectRoot, source);
        const outputPath = join("_assets", relativePath);
        if (!imageAssets.has(outputPath)) {
          try {
            const realSource = Deno.realPathSync(source);
            if (!isWithin(realProjectRoot, realSource)) {
              warn("is outside the project");
              return undefined;
            }
            if (!Deno.statSync(realSource).isFile) {
              warn("is not a file");
              return undefined;
            }
            // Check readability before adding this source to the copy plan.
            Deno.openSync(realSource).close();
            imageAssets.set(outputPath, { source, realSource });
          } catch {
            warn("could not be read");
            return undefined;
          }
        }
        const url = outputPath.split(SEPARATOR).map(encodeURIComponent).join(
          "/",
        );
        return url + image.suffix;
      },
    });

    for (const d of result.diagnostics) {
      console.error(`${d.severity}[${d.code}]: ${d.message}`);
    }

    // Abort before writing anything if the build produced an error (e.g. a
    // chapter-slug collision, MSL-K001) — writing would silently overwrite one
    // chapter with another and serve the wrong content (#778). Fail loud with
    // a non-zero exit rather than emit a confidently-wrong site.
    if (result.diagnostics.some((d) => d.severity === "error")) {
      Deno.exit(1);
    }

    // Write output
    await Deno.mkdir(options.output, { recursive: true });
    const outputRoot = await Deno.realPath(options.output);
    const sources = new Set(
      [...imageAssets.values()].flatMap(({ source, realSource }) => [
        source,
        realSource,
      ]),
    );
    const copies = new Map<string, string>();
    for (const [path, { source, realSource }] of imageAssets) {
      const destination = join(outputRoot, path);
      if (destination === source || destination === realSource) continue;
      // An existing destination can alias a source by filesystem spelling
      // even when its path string (for example, casing) differs.
      const existing = await Deno.realPath(destination).catch((error) => {
        if (error instanceof Deno.errors.NotFound) return undefined;
        throw error;
      });
      if (sources.has(destination) || (existing && sources.has(existing))) {
        console.error(
          `error: copying '${source}' would overwrite an image source at '${destination}'`,
        );
        Deno.exit(1);
      }
      copies.set(path, realSource);
    }
    for (const [path, source] of copies) {
      await _copyImageAsset(outputRoot, path, source);
    }
    const chapterLinks = result.chapters.map((c) => ({
      title: c.title,
      slug: slugForChapterPath(c.path),
    }));
    const hasIndexChapter = chapterLinks.some((c) => c.slug === "index");
    for (const chapter of result.chapters) {
      const slug = slugForChapterPath(chapter.path);
      const outPath = join(options.output, `${slug}.html`);
      // A chapter mapped from e.g. "index.md" is the book's real homepage —
      // its own content wins over the synthesized nav-only page. But every
      // chapter must still be reachable from index.html regardless of what
      // that chapter's own prose happens to link to, so the full chapter
      // nav is always appended to whichever page becomes index.html.
      const body = slug === "index"
        ? chapter.html + _navSectionHtml(chapterLinks)
        : chapter.html;
      await Deno.writeTextFile(outPath, _wrapHtml(chapter.title, body));
      console.error(`wrote ${outPath}`);
    }

    if (!hasIndexChapter) {
      const indexHtml = _indexHtml(config.name ?? "Book", chapterLinks);
      const indexPath = join(options.output, "index.html");
      await Deno.writeTextFile(indexPath, indexHtml);
      console.error(`wrote ${indexPath}`);
    }
  })
  .command("dev")
  .description("Live preview with hot reload")
  .action(notImplemented("book dev"));

/** Separate a chapter-relative image path from its optional URL suffix. */
function _relativeImageUrl(src: string): {
  segments: string[];
  suffix: string;
} | undefined {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(src)) return undefined;
  const match = /^([^?#]+)(.*)$/.exec(src);
  if (!match) return undefined;
  try {
    const segments = match[1].split("/").map(decodeURIComponent);
    if (
      segments.some((s) =>
        s.includes("/") || s.includes("\\") || s.includes("\0")
      )
    ) {
      return undefined;
    }
    return { segments, suffix: match[2] };
  } catch {
    return undefined;
  }
}

/** Copy an image into the site without following pre-existing output symlinks. */
async function _copyImageAsset(
  outputRoot: string,
  outputPath: string,
  source: string,
): Promise<void> {
  const parts = outputPath.split(SEPARATOR);
  const filename = parts.pop()!;
  let parent = outputRoot;
  for (const part of parts) {
    parent = join(parent, part);
    try {
      await Deno.mkdir(parent);
    } catch (error) {
      if (
        !(error instanceof Deno.errors.AlreadyExists) ||
        !(await Deno.lstat(parent)).isDirectory
      ) throw error;
    }
  }
  const destination = join(parent, filename);
  const staging = await Deno.makeTempFile({ dir: parent });
  try {
    await Deno.copyFile(source, staging);
    await Deno.rename(staging, destination);
  } catch (error) {
    await Deno.remove(staging).catch(() => {});
    throw error;
  }
}

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

/**
 * A "Chapters" nav section listing every chapter, appended to whichever
 * page becomes a book's `index.html` — its own synthesized nav page, or a
 * real chapter's rendered content when one maps to the "index" slug. Every
 * chapter stays reachable from the homepage this way, regardless of
 * whether that chapter's own prose links to the rest of the book.
 */
function _navSectionHtml(
  chapters: readonly { title: string; slug: string }[],
): string {
  const links = chapters
    .map((c) => `  <li><a href="${c.slug}.html">${_escHtml(c.title)}</a></li>`)
    .join("\n");
  return `\n<h2>Chapters</h2>\n<ul>\n${links}\n</ul>\n`;
}

/** Generate a minimal index page (used when no chapter claims the "index" slug). */
function _indexHtml(
  bookTitle: string,
  chapters: readonly { title: string; slug: string }[],
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${_escHtml(bookTitle)}</title>
  <link rel="stylesheet" href="markspec.css">
</head>
<body>
<h1>${_escHtml(bookTitle)}</h1>
${_navSectionHtml(chapters)}
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
