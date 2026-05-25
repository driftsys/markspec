/**
 * @module cli/commands/mcp_cmd
 *
 * `markspec mcp` — start the MCP server or install its configuration.
 *
 * Slice C: claude-desktop runs through the full `runMcpInstall`
 * orchestrator — JSON managed-block, timestamped sidecar backup,
 * diff preview, atomic write. vscode remains verify-only (parity
 * with Slice B's LSP vscode adapter). Cursor remains print-only.
 */

import { Command } from "@cliffy/command";

export const mcpCmd = new Command()
  .description("Start MCP server or install its configuration")
  .action(async () => {
    const { startServer } = await import("../../mcp/server.ts");
    await startServer();
  })
  .command("install")
  .description("Install or print MCP server configuration for a client")
  .option(
    "--client <client:string>",
    "Client ID (claude-desktop|cursor|vscode)",
    { required: true },
  )
  .option("--scope <scope:string>", "Config scope: user|workspace")
  .option(
    "--binary-path <path:string>",
    "Path or invoked name written into config",
    { default: "markspec" },
  )
  .option(
    "--print",
    "Write the new file contents to stdout; do not write to disk",
  )
  .option("--force", "Apply without TTY confirmation; required in non-TTY")
  .option("--no-color", "Disable color output")
  .option("--remove", "Remove the managed entry from the config file")
  .action(
    async (
      options: {
        client: string;
        scope?: string;
        binaryPath: string;
        print?: boolean;
        force?: boolean;
        color?: boolean;
        remove?: boolean;
      },
    ) => {
      const { runMcpInstall } = await import(
        "../install/mcp_orchestrator.ts"
      );
      const result = await runMcpInstall({
        client: options.client,
        scope: options.scope,
        binaryPath: options.binaryPath,
        print: options.print,
        force: options.force,
        noColor: options.color === false,
        remove: options.remove,
      });
      if (result.stdout) {
        await Deno.stdout.write(new TextEncoder().encode(result.stdout));
      }
      if (result.stderr) {
        await Deno.stderr.write(new TextEncoder().encode(result.stderr));
      }
      Deno.exit(result.exitCode);
    },
  );
