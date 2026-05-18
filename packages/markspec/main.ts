/**
 * @module main
 *
 * CLI entry point for MarkSpec. Subcommand dispatch via Cliffy.
 * Each subcommand dynamically imports only the modules it needs.
 *
 * Compile targets:
 *   deno compile packages/markspec/main.ts  → markspec
 */

import { Command } from "@cliffy/command";
import { CompletionsCommand } from "@cliffy/command/completions";
import { ConfigError, CORE_SCHEMA_VERSION, VERSION } from "./core/mod.ts";
import type {
  CaptionConventions,
  CompileResult,
  Diagnostic,
  ProfileChain,
  ReadFile,
} from "./core/mod.ts";
import type { BookStructure, Chapter } from "./book/mod.ts";

/** Print "not yet implemented" to stderr and exit 1. */
function notImplemented(name: string): () => void {
  return () => {
    console.error(`markspec ${name}: not yet implemented`);
    Deno.exit(1);
  };
}

/** Deno-specific file reader for config discovery. */
const readFile: ReadFile = async (path: string) => {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return undefined;
  }
};

/**
 * Load project config or exit with an error.
 * Used by commands that require project context.
 */
async function requireProjectConfig() {
  const { loadConfig } = await import("./core/mod.ts");
  try {
    const result = await loadConfig(Deno.cwd(), readFile);
    if (result === undefined) {
      console.error(
        "error: no project.yaml found\n" +
          `  searched from ${Deno.cwd()} to filesystem root\n\n` +
          "  Create a project.yaml in your project root, or use\n" +
          "  markspec format <file> / markspec validate <file>\n" +
          "  which work without project context.",
      );
      Deno.exit(1);
    }
    return result;
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`error: ${err.message}`);
      Deno.exit(1);
    }
    throw err;
  }
}

/**
 * Load the active profile chain (or null) for the current project and
 * surface any diagnostics. Called by every profile-aware subcommand so
 * `.markspec.yaml` errors are caught uniformly.
 *
 * The loaded chain itself is not yet consumed by the validator / compiler —
 * that lands in Phase 5+ of the profile system rollout.
 */
async function loadActiveProfile(projectRoot: string) {
  const { loadProfileForCommand } = await import("./core/mod.ts");
  const result = await loadProfileForCommand(projectRoot, readFile);

  let sawError = false;
  for (const diag of result.diagnostics) {
    const loc = diag.location
      ? `${diag.location.file}:${diag.location.line}`
      : "";
    console.error(`${diag.severity}[${diag.code}]: ${loc} ${diag.message}`);
    if (diag.severity === "error") sawError = true;
  }
  if (sawError) {
    Deno.exit(1);
  }
  return result.chain;
}

/**
 * Compile project files and return the result alongside the loaded profile chain.
 * Shared helper for commands that need the compiled graph.
 */
async function compileProject(
  paths: string[],
): Promise<{ result: CompileResult; chain: ProfileChain | null }> {
  const configResult = await requireProjectConfig();
  const chain = await loadActiveProfile(configResult.projectRoot);
  const { compile } = await import("./core/mod.ts");
  const result = await compile(paths, {
    readFile: (p) => Deno.readTextFile(p),
    profile: chain?.effective ?? undefined,
  });

  for (const diag of result.diagnostics) {
    const loc = diag.location
      ? `${diag.location.file}:${diag.location.line}`
      : "";
    console.error(`${diag.severity}[${diag.code}]: ${loc} ${diag.message}`);
  }

  return { result, chain };
}

// ── Nested subcommands (composed as separate Command instances) ───────

const docCmd = new Command()
  .description("Document generation")
  .command("build <file:string>")
  .description("Generate document PDF")
  .option("-o, --output <path:string>", "Output file path")
  .action(async (options: { output?: string }, file: string) => {
    const { config } = await requireProjectConfig();
    const { result: compiled, chain } = await compileProject([file]);
    const { renderPdf } = await import("./render/mod.ts");

    const markdown = await Deno.readTextFile(file);
    const typstPackagePath = new URL(
      "../markspec-typst/",
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

const bookCmd = new Command()
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

    const { parseSummary, buildBook } = await import("./book/mod.ts");
    const { compile } = await import("./core/mod.ts");

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

/** RFC-4180 quoting: surround with double quotes when the value contains
 * a comma, a double quote, a carriage return, or a newline; double any
 * embedded quotes inside. */
function csvQuote(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

// ── Profile command group ─────────────────────────────────────────────

const profileCmd = new Command()
  .description("Profile management")
  .command("show")
  .description("Show the active profile chain")
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .action(async (options: { format?: string }) => {
    const { config: _config, projectRoot } = await requireProjectConfig();
    const chain = await loadActiveProfile(projectRoot);

    if (options.format === "json") {
      const output = {
        chain: chain
          ? chain.tiers.map((tier) => ({
            id: tier.id,
            version: tier.version,
            specifier: tier.specifier,
            sourcePath: tier.sourcePath,
          }))
          : [],
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      if (!chain) {
        console.error("no profile configured for this project");
      } else {
        console.error("Active profile chain:");
        for (const tier of chain.tiers) {
          const spec = tier.specifier.kind === "local"
            ? tier.specifier.path
            : tier.specifier.kind === "git"
            ? `${tier.specifier.repo}@${tier.specifier.tag}`
            : `npm:${
              tier.specifier.scope ? `${tier.specifier.scope}/` : ""
            }${tier.specifier.name}@${tier.specifier.range}`;
          console.error(`  ${tier.id}@${tier.version}  (${spec})`);
          console.error(`    source: ${tier.sourcePath}`);
        }
      }
    }
  })
  .command("new <id:string>")
  .description("Scaffold a new profile directory")
  .option("--dir <dir:string>", "Override output directory")
  .action(async (options: { dir?: string }, id: string) => {
    const PROFILE_ID_RE = /^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9-]*$/;
    if (!PROFILE_ID_RE.test(id)) {
      console.error(
        `error: invalid profile id '${id}'\n` +
          "  expected: lowercase alphanumeric with hyphens, optional @scope/ prefix\n" +
          "  examples: my-profile, @org/my-profile",
      );
      Deno.exit(1);
    }

    const dirName = id.includes("/") ? id.split("/")[1] : id;
    const targetDir = options.dir ?? `./${dirName}`;

    try {
      await Deno.stat(targetDir);
      console.error(`error: directory '${targetDir}' already exists`);
      Deno.exit(1);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }

    await Deno.mkdir(targetDir, { recursive: true });

    const manifest = `id: "${id}"
version: 0.1.0
description: ""
# license: MIT
# extends: "./path/to/parent"

profile:
  # Universal scope
  attributes: []
  labels: []

  # Per-type scope (use extends: to link to a core type, e.g. extends: Requirement)
  types: {}

  # Document scope
  documents:
    types: []
    frontMatter: []
`;

    const readme = `# ${id}\n\nA MarkSpec profile.\n`;

    await Deno.writeTextFile(`${targetDir}/markspec.yaml`, manifest);
    await Deno.writeTextFile(`${targetDir}/README.md`, readme);

    console.error(`created profile at ${targetDir}/`);
  })
  .command("publish")
  .description("Validate a profile manifest for publishability")
  .option("--dry-run", "Validate only (default)", { default: true })
  .option("--dir <dir:string>", "Profile directory", { default: "." })
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .action(
    async (options: { dryRun?: boolean; dir?: string; format?: string }) => {
      const { parseManifest } = await import("./core/mod.ts");
      const dir = options.dir ?? ".";
      const manifestPath = `${dir}/markspec.yaml`;

      let rawYaml: string;
      try {
        rawYaml = await Deno.readTextFile(manifestPath);
      } catch {
        console.error(`error: no markspec.yaml found at ${manifestPath}`);
        Deno.exit(1);
      }

      const result = parseManifest(rawYaml, manifestPath);
      const diagnostics = [...result.diagnostics];

      if (result.manifest) {
        if (!result.manifest.description) {
          diagnostics.push({
            code: "PROFILE-PUB-001",
            severity: "warning",
            message:
              "profile is missing 'description' (recommended for publishing)",
            location: { file: manifestPath, line: 1, column: 1 },
          });
        }
        if (!result.manifest.license) {
          diagnostics.push({
            code: "PROFILE-PUB-002",
            severity: "warning",
            message:
              "profile is missing 'license' (recommended for publishing)",
            location: { file: manifestPath, line: 1, column: 1 },
          });
        }
      }

      const hasErrors = diagnostics.some((d) => d.severity === "error");

      if (options.format === "json") {
        const output = {
          valid: !hasErrors,
          profile: result.manifest
            ? { id: result.manifest.id, version: result.manifest.version }
            : null,
          diagnostics: diagnostics.map((d) => ({
            severity: d.severity,
            code: d.code,
            message: d.message,
          })),
        };
        console.log(JSON.stringify(output, null, 2));
      } else {
        for (const diag of diagnostics) {
          console.error(`${diag.severity}[${diag.code}]: ${diag.message}`);
        }
        if (!hasErrors) {
          console.error(
            result.manifest
              ? `✓ ${result.manifest.id}@${result.manifest.version} is valid for publishing`
              : "✓ profile is valid",
          );
        }
      }

      Deno.exit(hasErrors ? 1 : 0);
    },
  )
  .command("add <spec:string>")
  .description("Add a profile to the project")
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .action(async (options: { format?: string }, spec: string) => {
    const { config: _config, projectRoot } = await requireProjectConfig();

    // Parse the specifier string to validate format.
    const { parseMarkspecYaml } = await import("./core/config/markspec.ts");
    const testYaml = `profiles:\n  - "${spec}"\n`;
    const parseResult = parseMarkspecYaml(testYaml, "<cli>");

    if (!parseResult.config || parseResult.config.profiles.length === 0) {
      for (const diag of parseResult.diagnostics) {
        console.error(`${diag.severity}[${diag.code}]: ${diag.message}`);
      }
      Deno.exit(1);
    }

    const specifier = parseResult.config.profiles[0];

    // For local specifiers, validate the profile exists by attempting load.
    if (specifier.kind === "local") {
      const { loadChain } = await import("./core/mod.ts");
      const chainResult = await loadChain(
        specifier,
        projectRoot,
        projectRoot,
        readFile,
      );

      let sawError = false;
      for (const diag of chainResult.diagnostics) {
        console.error(`${diag.severity}[${diag.code}]: ${diag.message}`);
        if (diag.severity === "error") sawError = true;
      }
      if (sawError || !chainResult.chain) {
        Deno.exit(1);
      }
    }

    // Record the specifier in .markspec.yaml.
    const { addProfileSpecifier } = await import("./core/config/markspec.ts");
    await addProfileSpecifier(
      spec,
      readFile,
      (path: string, content: string) => Deno.writeTextFile(path, content),
      projectRoot,
    );

    if (options.format === "json") {
      console.log(JSON.stringify({ added: spec }));
    } else {
      console.error(`added profile: ${spec}`);
    }
  });

const deckCmd = new Command()
  .description("Presentation generation")
  .command("build <file:string>")
  .description("Generate presentation PDF")
  .action(notImplemented("deck build"))
  .command("dev <file:string>")
  .description("Live preview")
  .action(notImplemented("deck dev"));

// ── LSP command group ─────────────────────────────────────────────────

const lspCmd = new Command()
  .description("Start LSP server or install its configuration")
  // LSP clients (e.g. vscode-languageclient) append a transport flag to args.
  // We always use stdio, so accept and ignore these.
  .option("--stdio", "Transport flag (no-op; stdio is always used)")
  .option("--node-ipc", "Transport flag (no-op; stdio is always used)")
  .option(
    "--socket=<port:number>",
    "Transport flag (no-op; stdio is always used)",
  )
  .action(async () => {
    await import("./lsp/server.ts");
  })
  .command("install")
  .description("Print LSP server configuration for an editor")
  .option("--editor <editor:string>", "Editor ID (vscode|neovim|zed)", {
    required: true,
  })
  .option("--print", "Print config block to stdout (no file writes; default for this release)")
  .option("--scope <scope:string>", "Config scope: user|workspace (reserved for Tier 3)")
  .option("--no-color", "Suppress color output (also reads NO_COLOR env)")
  .action(
    async (options: { editor: string; print?: boolean; scope?: string }) => {
      const { LSP_EDITOR_IDS, suggestId } = await import(
        "./cli/install/adapters.ts"
      );
      const editorId = options.editor;
      if (!LSP_EDITOR_IDS.includes(editorId as "vscode" | "neovim" | "zed")) {
        const suggestion = suggestId(editorId, LSP_EDITOR_IDS);
        const hint = suggestion ? `\n  did you mean: ${suggestion}` : "";
        console.error(
          `error: unknown editor '${editorId}' (known: ${LSP_EDITOR_IDS.join(", ")})${hint}`,
        );
        Deno.exit(1);
      }
      const { neovimAdapter, vscodeAdapter, zedAdapter } = await import(
        "./cli/install/lsp_adapters.ts"
      );
      let result;
      if (editorId === "neovim") result = neovimAdapter();
      else if (editorId === "zed") result = zedAdapter();
      else result = await vscodeAdapter();
      if (result.stdout) console.log(result.stdout);
      if (result.stderr) console.error(result.stderr);
      Deno.exit(result.exitCode);
    },
  );

// ── MCP command group ─────────────────────────────────────────────────

const mcpCmd = new Command()
  .description("Start MCP server or install its configuration")
  .action(async () => {
    const { startServer } = await import("./mcp/server.ts");
    await startServer();
  })
  .command("install")
  .description("Print MCP server configuration for a client")
  .option(
    "--client <client:string>",
    "Client ID (claude-desktop|cursor|vscode)",
    { required: true },
  )
  .option("--print", "Print config block to stdout (no file writes; default for this release)")
  .option("--scope <scope:string>", "Config scope: user|workspace (reserved for Tier 3)")
  .option("--no-color", "Suppress color output (also reads NO_COLOR env)")
  .action(
    async (options: { client: string; print?: boolean; scope?: string }) => {
      const { MCP_CLIENT_IDS, suggestId } = await import(
        "./cli/install/adapters.ts"
      );
      const clientId = options.client;
      if (
        !MCP_CLIENT_IDS.includes(
          clientId as "claude-desktop" | "cursor" | "vscode",
        )
      ) {
        const suggestion = suggestId(clientId, MCP_CLIENT_IDS);
        const hint = suggestion ? `\n  did you mean: ${suggestion}` : "";
        console.error(
          `error: unknown client '${clientId}' (known: ${MCP_CLIENT_IDS.join(", ")})${hint}`,
        );
        Deno.exit(1);
      }
      const { claudeDesktopAdapter, cursorAdapter, vscodeMcpAdapter } =
        await import("./cli/install/mcp_adapters.ts");
      let result;
      if (clientId === "claude-desktop") result = claudeDesktopAdapter();
      else if (clientId === "cursor") result = cursorAdapter();
      else result = await vscodeMcpAdapter();
      if (result.stdout) console.log(result.stdout);
      if (result.stderr) console.error(result.stderr);
      Deno.exit(result.exitCode);
    },
  );

// ── Root command ──────────────────────────────────────────────────────

const cli = new Command()
  .name("markspec")
  .version(`${VERSION} (core-schema ${CORE_SCHEMA_VERSION})`)
  .description(
    "Markdown flavor and toolchain for traceable industrial documentation",
  )
  .globalOption("-q, --quiet", "Suppress non-error output")
  // Core commands
  .command("format [...files:string]")
  .description("Stamp ULIDs, fix indentation, normalize attributes")
  .option(
    "--check",
    "Check mode: report but don't write (exit 1 if changes needed)",
  )
  .action(async (options: { check?: boolean }, ...files: string[]) => {
    if (files.length === 0) {
      console.error("error: no files specified");
      console.error("usage: markspec format <file...>");
      Deno.exit(1);
    }

    const { discoverProjectRoot } = await import("./core/mod.ts");
    const projectRoot = await discoverProjectRoot(Deno.cwd(), readFile);
    if (projectRoot !== undefined) {
      await loadActiveProfile(projectRoot);
    }

    const { format } = await import("./core/mod.ts");

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
  })
  .command("validate [...files:string]")
  .description("Check broken refs, missing Ids, duplicates")
  .option("--strict", "Promote warnings to errors")
  .option(
    "--format <format:string>",
    "Output format (json|text)",
    { default: "text" },
  )
  .action(
    async (
      options: { strict?: boolean; format?: string },
      ...files: string[]
    ) => {
      if (files.length === 0) {
        console.error("error: no files specified");
        console.error("usage: markspec validate <file...>");
        Deno.exit(1);
      }

      const { discoverProjectRoot, loadConfig } = await import("./core/mod.ts");
      const projectRoot = await discoverProjectRoot(Deno.cwd(), readFile);
      const chain = projectRoot !== undefined
        ? await loadActiveProfile(projectRoot)
        : null;

      // Load project config for config-driven rules (e.g. MSL-C072
      // caption-position convention). Absent config → defaults (rules inactive).
      // A malformed config (ConfigError) IS surfaced — a bad caption-conventions
      // block silently disabling MSL-C072 would be invisible debt (M-1 fix).
      let captionConventions: CaptionConventions = {};
      if (projectRoot !== undefined) {
        try {
          const configResult = await loadConfig(projectRoot, readFile);
          if (configResult) {
            captionConventions = configResult.config.captionConventions;
          }
        } catch (err) {
          if (err instanceof ConfigError) {
            console.error(`error: ${err.message}`);
            Deno.exit(1);
          }
          // Other unexpected errors (I/O, etc.) remain non-fatal — the rule
          // simply stays inactive; the file-missing path already returns undefined
          // from readFile and never throws.
        }
      }

      const {
        detectDirectives,
        parseFile,
        runPipeline,
        validateListingDocuments,
      } = await import("./core/mod.ts");

      const allEntries = [];
      const parseDiagnostics: Diagnostic[] = [];
      // deno-lint-ignore no-explicit-any
      const listingContexts: any[] = [];
      for (const filePath of files) {
        let content: string;
        try {
          content = await Deno.readTextFile(filePath);
        } catch {
          console.error(`error: ${filePath}: file not found`);
          Deno.exit(1);
        }
        const result = await parseFile(content, { file: filePath });
        allEntries.push(...result.entries);
        parseDiagnostics.push(...result.diagnostics);
        listingContexts.push({
          file: filePath,
          content,
          entries: result.entries,
          directives: detectDirectives(content, { file: filePath }),
        });
      }

      const result = runPipeline(
        allEntries,
        chain?.effective ?? null,
        captionConventions,
      );

      const listingDiagnostics = validateListingDocuments(listingContexts);

      // Merge parse-level (MSL-P0xx), pipeline, and listing diagnostics.
      const allDiagnostics = [
        ...parseDiagnostics,
        ...result.diagnostics,
        ...listingDiagnostics,
      ];

      // Apply --strict: promote warnings to errors.
      const diagnostics = options.strict
        ? allDiagnostics.map((d) =>
          d.severity === "warning" ? { ...d, severity: "error" as const } : d
        )
        : allDiagnostics;

      const hasErrors = diagnostics.some((d) => d.severity === "error");
      const hasWarnings = diagnostics.some((d) => d.severity === "warning");

      if (options.format === "json") {
        console.log(JSON.stringify(diagnostics, null, 2));
      } else {
        for (const d of diagnostics) {
          const loc = d.location ? `${d.location.file}:${d.location.line}` : "";
          console.error(`${d.severity}[${d.code}]: ${loc} ${d.message}`);
        }
      }

      if (hasErrors) {
        Deno.exit(1);
      } else if (hasWarnings) {
        Deno.exit(2);
      }
    },
  )
  .command("compile <paths...:string>")
  .description("Parse files, build traceability graph, output JSON")
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .option("--output <dir:string>", "Write /api/ directory to <dir>")
  .option(
    "--split-threshold <n:number>",
    "Entry count at which to switch to NDJSON streaming output",
    { default: 1000 },
  )
  .action(
    async (
      _options: { format?: string; output?: string; splitThreshold: number },
      ...paths: string[]
    ) => {
      const { result, chain } = await compileProject(paths);

      if (_options.output) {
        const {
          buildManifest,
          buildEdgesNdjson,
          buildEntriesNdjson,
          indexToJson,
          serializeCompileResult,
        } = await import("./core/mod.ts");
        const configResult = await requireProjectConfig();
        const streaming = result.entries.size >= _options.splitThreshold;

        const manifestJson = buildManifest(
          result,
          configResult.config,
          configResult.projectRoot,
          chain?.effective,
          VERSION,
          streaming,
        );
        await Deno.mkdir(_options.output, { recursive: true });
        await Deno.writeTextFile(
          `${_options.output}/manifest.json`,
          JSON.stringify(manifestJson, null, 2),
        );
        console.error(`wrote ${_options.output}/manifest.json`);

        if (streaming) {
          const { ndjson, index } = buildEntriesNdjson(result.entries);
          await Deno.writeFile(`${_options.output}/entries.ndjson`, ndjson);
          console.error(`wrote ${_options.output}/entries.ndjson`);
          await Deno.writeTextFile(
            `${_options.output}/entries.idx`,
            indexToJson(index),
          );
          console.error(`wrote ${_options.output}/entries.idx`);
          const edgesBytes = buildEdgesNdjson(result.links);
          await Deno.writeFile(`${_options.output}/edges.ndjson`, edgesBytes);
          console.error(`wrote ${_options.output}/edges.ndjson`);
        } else {
          const compiled = serializeCompileResult(result);
          await Deno.writeTextFile(
            `${_options.output}/compiled.json`,
            JSON.stringify(compiled, null, 2),
          );
          console.error(`wrote ${_options.output}/compiled.json`);
        }
        return;
      }

      if (_options.format === "json") {
        const { serializeCompileResult } = await import("./core/mod.ts");
        const output = serializeCompileResult(result);
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log(
          `${result.entries.size} entries, ${result.links.length} links from ${paths.length} files`,
        );
      }
    },
  )
  .command("export <format:string> <paths...:string>")
  .description(
    "Emit the compiled traceability graph in json, yaml, or csv (reqif pending)",
  )
  .action(async (_options, format: string, ...paths: string[]) => {
    if (format !== "json" && format !== "yaml" && format !== "csv") {
      console.error(
        `error: unknown export format '${format}' (supported: json, yaml, csv)`,
      );
      Deno.exit(1);
    }
    const { result } = await compileProject(paths);
    const { serializeCompileResult } = await import("./core/mod.ts");
    const output = serializeCompileResult(result);
    if (format === "json") {
      console.log(JSON.stringify(output, null, 2));
    } else if (format === "yaml") {
      // Round-trip through JSON to strip undefined values — @std/yaml's
      // stringify throws on undefined, but the Entry shape carries
      // optional fields (type, id, properties) that may legitimately
      // be undefined. JSON.stringify drops them.
      const jsonSafe = JSON.parse(JSON.stringify(output));
      const { stringify } = await import("@std/yaml");
      console.log(stringify(jsonSafe));
    } else {
      // CSV: one row per entry, fixed-shape header. Values are
      // RFC-4180 quoted when they contain a comma, double quote,
      // or newline; internal quotes are doubled.
      const headers = [
        "displayId",
        "title",
        "type",
        "shape",
        "id",
        "file",
        "line",
      ];
      const lines = [headers.join(",")];
      for (const entry of Object.values(output.entries)) {
        const row = [
          entry.displayId,
          entry.title,
          entry.type ?? "",
          entry.shape,
          entry.id ?? "",
          entry.location.file,
          String(entry.location.line),
        ].map(csvQuote);
        lines.push(row.join(","));
      }
      console.log(lines.join("\n"));
    }
  })
  .command("insert <type:string> <file:string>")
  .description("Append a scaffolded entry block to <file> (agent write path)")
  .option("--print", "Also echo the inserted block to stdout for inspection")
  .action(
    async (
      options: { print?: boolean },
      typeName: string,
      filePath: string,
    ) => {
      // Verify target exists before doing project work.
      let original: string;
      try {
        original = await Deno.readTextFile(filePath);
      } catch {
        console.error(`error: ${filePath}: file not found`);
        Deno.exit(1);
      }

      const { result, chain } = await compileProject([filePath]);
      if (!chain) {
        console.error(`error: insert requires a profile; none configured`);
        Deno.exit(1);
      }
      const typeEntry = chain.effective.types.get(typeName);
      if (!typeEntry) {
        console.error(
          `error: type '${typeName}' is not declared by the active profile`,
        );
        Deno.exit(1);
      }
      const pattern = typeEntry.value.displayIdPattern.value;
      if (!pattern) {
        console.error(`error: type '${typeName}' has no display-id-pattern`);
        Deno.exit(1);
      }
      const placeholderMatch = /\{n:(\d+)d\}/.exec(pattern);
      if (!placeholderMatch) {
        console.error(
          `error: type '${typeName}' display-id-pattern '${pattern}' does ` +
            `not contain a recognised number placeholder ('{n:Nd}')`,
        );
        Deno.exit(1);
      }
      const width = parseInt(placeholderMatch[1], 10);
      const prefix = pattern.slice(0, placeholderMatch.index);
      const suffix = pattern.slice(
        placeholderMatch.index + placeholderMatch[0].length,
      );

      let max = 0;
      for (const entry of result.entries.values()) {
        const id = entry.displayId;
        if (!id.startsWith(prefix)) continue;
        if (suffix && !id.endsWith(suffix)) continue;
        const numberPart = id.slice(prefix.length, id.length - suffix.length);
        const n = parseInt(numberPart, 10);
        if (!isNaN(n) && n > max) max = n;
      }
      const next = max + 1;
      const padded = String(next).padStart(width, "0");
      const displayId = `${prefix}${padded}${suffix}`;

      const { ulid } = await import("@std/ulid");
      const id = ulid();

      const block =
        `- [${displayId}] ${typeName[0].toUpperCase()}${typeName.slice(1)} ` +
        `title\n\n  Body text.\n\n      Id: ${id}\n      Type: ${typeName}\n`;

      // Ensure exactly one blank line between existing content and the
      // new block. If the file ends without a trailing newline, add one
      // first.
      const separator = original.length === 0 || original.endsWith("\n\n")
        ? ""
        : original.endsWith("\n")
        ? "\n"
        : "\n\n";
      await Deno.writeTextFile(filePath, original + separator + block);

      if (options.print) {
        console.log(block);
      }
      console.error(`insert: appended ${displayId} to ${filePath}`);
    },
  )
  .command("create <type:string> <paths...:string>")
  .description("Scaffold a new entry block for a profile-declared type")
  .action(async (_options, typeName: string, ...paths: string[]) => {
    const { result, chain } = await compileProject(paths);
    if (!chain) {
      console.error(`error: create requires a profile; none configured`);
      Deno.exit(1);
    }
    const typeEntry = chain.effective.types.get(typeName);
    if (!typeEntry) {
      console.error(
        `error: type '${typeName}' is not declared by the active profile`,
      );
      Deno.exit(1);
    }
    const pattern = typeEntry.value.displayIdPattern.value;
    if (!pattern) {
      console.error(`error: type '${typeName}' has no display-id-pattern`);
      Deno.exit(1);
    }
    const placeholderMatch = /\{n:(\d+)d\}/.exec(pattern);
    if (!placeholderMatch) {
      console.error(
        `error: type '${typeName}' display-id-pattern '${pattern}' does ` +
          `not contain a recognised number placeholder ('{n:Nd}')`,
      );
      Deno.exit(1);
    }
    const width = parseInt(placeholderMatch[1], 10);
    const prefix = pattern.slice(0, placeholderMatch.index);
    const suffix = pattern.slice(
      placeholderMatch.index + placeholderMatch[0].length,
    );

    let max = 0;
    for (const entry of result.entries.values()) {
      const id = entry.displayId;
      if (!id.startsWith(prefix)) continue;
      if (suffix && !id.endsWith(suffix)) continue;
      const numberPart = id.slice(prefix.length, id.length - suffix.length);
      const n = parseInt(numberPart, 10);
      if (!isNaN(n) && n > max) max = n;
    }
    const next = max + 1;
    const padded = String(next).padStart(width, "0");
    const displayId = `${prefix}${padded}${suffix}`;

    const { ulid } = await import("@std/ulid");
    const id = ulid();

    const block =
      `- [${displayId}] ${typeName[0].toUpperCase()}${
        typeName.slice(1)
      } title\n` +
      `\n  Body text.\n\n      Id: ${id}\n      Type: ${typeName}\n`;
    console.log(block);
  })
  .command("next-id <type:string> <paths...:string>")
  .description("Print the next available display ID for a type")
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .action(
    async (
      options: { format?: string },
      typeName: string,
      ...paths: string[]
    ) => {
      const { result, chain } = await compileProject(paths);
      if (!chain) {
        console.error(`error: next-id requires a profile; none configured`);
        Deno.exit(1);
      }
      const typeEntry = chain.effective.types.get(typeName);
      if (!typeEntry) {
        console.error(
          `error: type '${typeName}' is not declared by the active profile`,
        );
        Deno.exit(1);
      }
      const pattern = typeEntry.value.displayIdPattern.value;
      if (!pattern) {
        console.error(`error: type '${typeName}' has no display-id-pattern`);
        Deno.exit(1);
      }
      const placeholderMatch = /\{n:(\d+)d\}/.exec(pattern);
      if (!placeholderMatch) {
        console.error(
          `error: type '${typeName}' display-id-pattern '${pattern}' does ` +
            `not contain a recognised number placeholder ('{n:Nd}')`,
        );
        Deno.exit(1);
      }
      const width = parseInt(placeholderMatch[1], 10);
      const prefix = pattern.slice(0, placeholderMatch.index);
      const suffix = pattern.slice(
        placeholderMatch.index + placeholderMatch[0].length,
      );

      let max = 0;
      for (const entry of result.entries.values()) {
        const id = entry.displayId;
        if (!id.startsWith(prefix)) continue;
        if (suffix && !id.endsWith(suffix)) continue;
        const numberPart = id.slice(prefix.length, id.length - suffix.length);
        const n = parseInt(numberPart, 10);
        if (!isNaN(n) && n > max) max = n;
      }
      const next = max + 1;
      const padded = String(next).padStart(width, "0");
      const displayId = `${prefix}${padded}${suffix}`;

      if (options.format === "json") {
        console.log(JSON.stringify({ type: typeName, displayId }));
      } else {
        console.log(displayId);
      }
    },
  )
  .command("show <id:string> <paths...:string>")
  .description("Show details of a single entry by ID")
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .action(
    async (options: { format?: string }, id: string, ...paths: string[]) => {
      const { result, chain: _chain } = await compileProject(paths);
      const entry = result.entries.get(id);

      if (!entry) {
        console.error(`error: entry not found: ${id}`);
        Deno.exit(1);
      }

      const forwardLinks = result.forward.get(id) ?? [];
      const reverseLinks = result.reverse.get(id) ?? [];

      if (options.format === "json") {
        const output = {
          ...entry,
          forwardLinks,
          reverseLinks,
        };
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log(`${entry.displayId}  ${entry.title}`);
        if (entry.type) {
          console.log(`  Type: ${entry.type}`);
        }
        console.log(`  Shape: ${entry.shape}`);
        for (const attr of entry.rawAttributes) {
          console.log(`  ${attr.key}: ${attr.value}`);
        }
        console.log(
          `  Source: ${entry.location.file}:${entry.location.line}:${entry.location.column}`,
        );
        if (forwardLinks.length > 0) {
          console.log("  Outgoing links:");
          for (const link of forwardLinks) {
            console.log(`    ${link.kind} → ${link.to}`);
          }
        }
        if (reverseLinks.length > 0) {
          console.log("  Incoming links:");
          for (const link of reverseLinks) {
            console.log(`    ${link.kind} ← ${link.from}`);
          }
        }
      }
    },
  )
  .command("context <id:string> <paths...:string>")
  .description("Walk the Satisfies chain upward from an entry")
  .option("--depth <depth:number>", "Maximum depth to walk", { default: 10 })
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .action(
    async (
      options: { depth: number; format?: string },
      id: string,
      ...paths: string[]
    ) => {
      const { result, chain: _profileChain } = await compileProject(paths);
      const entry = result.entries.get(id);

      if (!entry) {
        console.error(`error: entry not found: ${id}`);
        Deno.exit(1);
      }

      // Walk the Satisfies chain upward.
      const chain: Array<{ displayId: string; title: string; depth: number }> =
        [];
      const visited = new Set<string>();
      let currentIds = [id];
      let depth = 0;

      // Add the starting entry at depth 0.
      chain.push({ displayId: entry.displayId, title: entry.title, depth: 0 });
      visited.add(id);

      while (depth < options.depth && currentIds.length > 0) {
        const nextIds: string[] = [];
        for (const currentId of currentIds) {
          const links = result.forward.get(currentId) ?? [];
          for (const link of links) {
            if (link.kind === "satisfies" && !visited.has(link.to)) {
              visited.add(link.to);
              const target = result.entries.get(link.to);
              if (target) {
                chain.push({
                  displayId: target.displayId,
                  title: target.title,
                  depth: depth + 1,
                });
                nextIds.push(link.to);
              }
            }
          }
        }
        currentIds = nextIds;
        depth++;
      }

      if (options.format === "json") {
        console.log(JSON.stringify(chain, null, 2));
      } else {
        for (const item of chain) {
          const indent = "  ".repeat(item.depth);
          console.log(`${indent}${item.displayId}  ${item.title}`);
        }
      }
    },
  )
  .command("dependents <id:string> <paths...:string>")
  .description("List all entries that depend on a given entry")
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .action(
    async (options: { format?: string }, id: string, ...paths: string[]) => {
      const { result, chain: _chain } = await compileProject(paths);
      const entry = result.entries.get(id);

      if (!entry) {
        console.error(`error: entry not found: ${id}`);
        Deno.exit(1);
      }

      const reverseLinks = result.reverse.get(id) ?? [];

      if (options.format === "json") {
        const output = reverseLinks.map((link) => ({
          from: link.from,
          kind: link.kind,
          title: result.entries.get(link.from)?.title ?? "",
        }));
        console.log(JSON.stringify(output, null, 2));
      } else {
        if (reverseLinks.length === 0) {
          console.log(`No dependents for ${id}`);
        } else {
          for (const link of reverseLinks) {
            const source = result.entries.get(link.from);
            const title = source ? `  ${source.title}` : "";
            console.log(`${link.from}  ${link.kind}${title}`);
          }
        }
      }
    },
  )
  .command("report <kind:string> <paths...:string>")
  .description("Generate traceability matrix or coverage report")
  .option(
    "--format <format:string>",
    "Output format (md|json|csv)",
    { default: "md" },
  )
  .option("--scope <scope:string>", "Filter by domain abbreviation")
  .option("--label <label:string>", "Filter by label value")
  .option("--output <output:string>", "Write to file instead of stdout")
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
      const { report } = await import("./core/mod.ts");

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
  )
  .command("hook [...files:string]")
  .description("Run format --check + validate as a pre-commit hook")
  .action(async (_options: Record<string, unknown>, ...files: string[]) => {
    if (files.length === 0) {
      // Nothing to do — exit clean. Pre-commit frameworks call with
      // zero files when no tracked file matches the hook's filter.
      Deno.exit(0);
    }

    const { discoverProjectRoot, format, loadConfig, parseFile, runPipeline } =
      await import("./core/mod.ts");

    const projectRoot = await discoverProjectRoot(Deno.cwd(), readFile);
    const chain = projectRoot !== undefined
      ? await loadActiveProfile(projectRoot)
      : null;

    // Load caption conventions for MSL-C072.  A malformed config (ConfigError)
    // IS surfaced — same as the validate command (M-1 fix).  Absent config stays
    // non-fatal; the rule simply stays inactive.
    let hookCaptionConventions: CaptionConventions = {};
    if (projectRoot !== undefined) {
      try {
        const configResult = await loadConfig(projectRoot, readFile);
        if (configResult) {
          hookCaptionConventions = configResult.config.captionConventions;
        }
      } catch (err) {
        if (err instanceof ConfigError) {
          console.error(`error: ${err.message}`);
          Deno.exit(1);
        }
        // Other unexpected errors remain non-fatal.
      }
    }

    let hadError = false;
    const allEntries = [];

    for (const filePath of files) {
      let content: string;
      try {
        content = await Deno.readTextFile(filePath);
      } catch {
        console.error(`error: ${filePath}: file not found`);
        hadError = true;
        continue;
      }

      // Stage 1 — format check. `result.changed` means the file is
      // not in canonical form; reject the commit.
      const formatResult = format(content, { file: filePath });
      for (const d of formatResult.diagnostics) {
        const loc = d.location ? `${d.location.file}:${d.location.line}` : "";
        console.error(`${d.severity}: ${loc} ${d.message}`);
      }
      if (formatResult.changed) {
        console.error(`${filePath}: needs formatting (run 'markspec format')`);
        hadError = true;
      }

      // Stage 2 — collect entries for validation.
      const parsed = await parseFile(content, { file: filePath });
      allEntries.push(...parsed.entries);
    }

    if (!hadError) {
      const result = runPipeline(
        allEntries,
        chain?.effective ?? null,
        hookCaptionConventions,
      );
      for (const d of result.diagnostics) {
        const loc = d.location ? `${d.location.file}:${d.location.line}` : "";
        console.error(`${d.severity}[${d.code}]: ${loc} ${d.message}`);
      }
      if (result.diagnostics.some((d) => d.severity === "error")) {
        hadError = true;
      }
    }

    console.error(
      hadError
        ? `hook: ${files.length} file(s) checked — failed`
        : `hook: ${files.length} file(s) checked — clean`,
    );

    if (hadError) Deno.exit(1);
  })
  // Nested commands
  .command("profile", profileCmd)
  .command("doctor")
  .description("Project health check")
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .action(async (options: { format?: string }) => {
    const { config, projectRoot } = await requireProjectConfig();

    // Load profile, but catch diagnostics via loadActiveProfile
    // (it already prints diagnostics and exits on error).
    const chain = await loadActiveProfile(projectRoot);

    const diagnostics: Array<
      { severity: string; code: string; message: string }
    > = [];

    if (options.format === "json") {
      const output = {
        project: {
          name: config.name,
          version: config.version,
          root: projectRoot,
        },
        profile: chain
          ? {
            id: chain.tiers[0].id,
            version: chain.tiers[0].version,
            tiers: chain.tiers.length,
          }
          : null,
        diagnostics,
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.error(`Project: ${config.name} (${config.version})`);
      console.error(`Root: ${projectRoot}`);
      if (chain) {
        console.error(
          `Profile: ${chain.tiers[0].id}@${
            chain.tiers[0].version
          } (${chain.tiers.length} tier(s))`,
        );
      } else {
        console.error("Profile: no profile configured");
      }
    }
  })
  .command("doc", docCmd)
  .command("book", bookCmd)
  .command("deck", deckCmd)
  // Server commands
  .command("lsp", lspCmd)
  .command("mcp", mcpCmd)
  // Version subcommand (alias for --version)
  .command("version")
  .description("Print version")
  .action(() => {
    console.log(`markspec ${VERSION} (core-schema ${CORE_SCHEMA_VERSION})`);
  })
  // Shell completions (bash, zsh, fish)
  .command("completions", new CompletionsCommand())
  // Help subcommand: enables `markspec help show`, etc. (clig.dev)
  .command("help [...command:string]")
  .description("Show help for a command")
  .action(async (_options: Record<string, unknown>, ...args: string[]) => {
    // deno-lint-ignore no-explicit-any
    let target: any = cli;
    for (const name of args) {
      const commands = target.getCommands() as Array<{ getName(): string }>;
      const found = commands.find((c: { getName(): string }) =>
        c.getName() === name
      );
      if (!found) {
        console.error(`error: unknown command '${name}'`);
        console.error("Run 'markspec --help' to see available commands.");
        Deno.exit(1);
      }
      target = found;
    }
    await target.showHelp();
  });

if (import.meta.main) {
  await cli.parse(Deno.args);
}
