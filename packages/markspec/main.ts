/**
 * @module main
 *
 * CLI entry point for MarkSpec. Subcommand dispatch via Cliffy.
 * Each subcommand is implemented in packages/markspec/cli/commands/.
 *
 * Compile targets:
 *   deno compile packages/markspec/main.ts  → markspec
 */

import { Command } from "@cliffy/command";
import { CompletionsCommand } from "@cliffy/command/completions";
import { CORE_SCHEMA_VERSION, VERSION } from "./core/mod.ts";
import {
  bookCmd,
  checkCmd,
  compileCmd,
  contextCmd,
  createCmd,
  deckCmd,
  dependentsCmd,
  docCmd,
  doctorCmd,
  exportCmd,
  fmtCmd,
  hookCmd,
  initCmd,
  insertCmd,
  lintCmd,
  lockCmd,
  lspCmd,
  mcpCmd,
  nextIdCmd,
  profileCmd,
  reportCmd,
  scoreCmd,
  selfUpgradeCmd,
  showCmd,
  syncCmd,
} from "./cli/commands/mod.ts";

// ── Root command ──────────────────────────────────────────────────────

const cli = new Command()
  .name("markspec")
  .version(`${VERSION} (core-schema ${CORE_SCHEMA_VERSION})`)
  .description(
    "Markdown flavor and toolchain for traceable industrial documentation",
  )
  .globalOption("-q, --quiet", "Suppress non-error output")
  // Core commands — implemented in cli/commands/
  .command("fmt", fmtCmd)
  .command("check", checkCmd)
  .command("compile", compileCmd)
  .command("export", exportCmd)
  .command("show", showCmd)
  .command("context", contextCmd)
  .command("dependents", dependentsCmd)
  .command("report", reportCmd)
  .command("lint", lintCmd)
  .command("score", scoreCmd)
  .command("self-upgrade", selfUpgradeCmd)
  .command("lock", lockCmd)
  .command("sync", syncCmd)
  .command("hook", hookCmd)
  .command("init", initCmd)
  .command("insert", insertCmd)
  .command("create", createCmd)
  .command("next-id", nextIdCmd)
  // Nested command groups
  .command("profile", profileCmd)
  .command("doctor", doctorCmd)
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
