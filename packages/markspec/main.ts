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
import { VERSION } from "./core/mod.ts";

/** Print "not yet implemented" to stderr and exit 1. */
function notImplemented(name: string): () => void {
  return () => {
    console.error(`markspec ${name}: not yet implemented`);
    Deno.exit(1);
  };
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
  .command("format")
  .description("Stamp ULIDs, fix indentation, normalize attributes")
  .action(async () => {
    const { format } = await import("./core/mod.ts");
    const result = format("");
    if (!result.changed) {
      console.error("0 files formatted");
    }
  })
  .command("validate")
  .description("Check broken refs, missing Ids, duplicates")
  .action(notImplemented("validate"))
  .command("compile <paths...:string>")
  .description("Parse files, build traceability graph, output JSON")
  .action(notImplemented("compile"))
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
  .command("show")
  .description("Show details of a single entry by ID")
  .action(notImplemented("show"))
  .command("context")
  .description("Print context for an entry (parents, children, links)")
  .action(notImplemented("context"))
  .command("dependents")
  .description("List all entries that depend on a given entry")
  .action(notImplemented("dependents"))
  .command("report")
  .description("Generate traceability matrix or coverage report")
  .action(notImplemented("report"))
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
