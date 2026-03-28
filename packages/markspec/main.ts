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
import { ConfigError, VERSION } from "./core/mod.ts";
import type { CompileResult, ReadFile } from "./core/mod.ts";

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
 * Compile project files and return the result.
 * Shared helper for commands that need the compiled graph.
 */
async function compileProject(paths: string[]): Promise<CompileResult> {
  await requireProjectConfig();
  const { compile } = await import("./core/mod.ts");
  return await compile(paths);
}

// ── Nested subcommands (composed as separate Command instances) ───────

const docCmd = new Command()
  .description("Document generation")
  .command("build <file:string>")
  .description("Generate document PDF")
  .action(notImplemented("doc build"));

const bookCmd = new Command()
  .description("Book generation")
  .command("build")
  .description("Generate PDF + HTML book")
  .action(notImplemented("book build"))
  .command("dev")
  .description("Live preview with hot reload")
  .action(notImplemented("book dev"));

const deckCmd = new Command()
  .description("Presentation generation")
  .command("build <file:string>")
  .description("Generate presentation PDF")
  .action(notImplemented("deck build"))
  .command("dev <file:string>")
  .description("Live preview")
  .action(notImplemented("deck dev"));

// ── Root command ──────────────────────────────────────────────────────

const cli = new Command()
  .name("markspec")
  .version(VERSION)
  .description(
    "Markdown flavor and toolchain for traceable industrial documentation",
  )
  .globalOption("-q, --quiet", "Suppress non-error output")
  .globalOption(
    "--output-format <format:string>",
    "Output format (json|text)",
    { default: "text" },
  )
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

      const { parse, validate } = await import("./core/mod.ts");

      const allEntries = [];
      for (const filePath of files) {
        let content: string;
        try {
          content = await Deno.readTextFile(filePath);
        } catch {
          console.error(`error: ${filePath}: file not found`);
          Deno.exit(1);
        }
        const entries = parse(content, { file: filePath });
        allEntries.push(...entries);
      }

      const result = validate(allEntries);

      // Apply --strict: promote warnings to errors.
      const diagnostics = options.strict
        ? result.diagnostics.map((d) =>
          d.severity === "warning" ? { ...d, severity: "error" as const } : d
        )
        : result.diagnostics;

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
  .action(async (_options: { format?: string }, ...paths: string[]) => {
    await requireProjectConfig();

    const { compile, serializeCompileResult } = await import("./core/mod.ts");
    const result = await compile(paths);

    for (const diag of result.diagnostics) {
      const loc = diag.location
        ? `${diag.location.file}:${diag.location.line}`
        : "";
      console.error(`${diag.severity}[${diag.code}]: ${loc} ${diag.message}`);
    }

    if (_options.format === "json") {
      const output = serializeCompileResult(result);
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(
        `${result.entries.size} entries, ${result.links.length} links from ${paths.length} files`,
      );
    }
  })
  .command("export")
  .description("Compiled JSON → json, csv, reqif, yaml")
  .action(notImplemented("export"))
  .command("insert")
  .description("Insert a requirement block into a file")
  .action(notImplemented("insert"))
  .command("create")
  .description("Scaffold a new requirement block")
  .action(notImplemented("create"))
  .command("next-id")
  .description("Print the next available display ID for a type")
  .action(notImplemented("next-id"))
  .command("show <id:string> <paths...:string>")
  .description("Show details of a single entry by ID")
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .action(
    async (options: { format?: string }, id: string, ...paths: string[]) => {
      const result = await compileProject(paths);
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
        if (entry.entryType) {
          console.log(`  Type: ${entry.entryType}`);
        }
        for (const attr of entry.attributes) {
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
      const result = await compileProject(paths);
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
      const result = await compileProject(paths);
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

      const compiled = await compileProject(paths);
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
  .command("hook")
  .description("Run format + validate as a pre-commit hook")
  .action(notImplemented("hook"))
  // Nested commands
  .command("doc", docCmd)
  .command("book", bookCmd)
  .command("deck", deckCmd)
  // Server commands
  .command("lsp")
  .description("Start LSP server")
  .action(notImplemented("lsp"))
  .command("mcp")
  .description("Start MCP server")
  .action(notImplemented("mcp"))
  // Version subcommand (alias for --version)
  .command("version")
  .description("Print version")
  .action(() => {
    console.log(`markspec ${VERSION}`);
  });

if (import.meta.main) {
  await cli.parse(Deno.args);
}
