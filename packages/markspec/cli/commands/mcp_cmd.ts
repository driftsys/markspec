/**
 * @module cli/commands/mcp_cmd
 *
 * `markspec mcp` — start the MCP server or install its configuration.
 */

import { Command } from "@cliffy/command";

export const mcpCmd = new Command()
  .description("Start MCP server or install its configuration")
  .action(async () => {
    const { startServer } = await import("../../mcp/server.ts");
    await startServer();
  })
  .command("install")
  .description("Print MCP server configuration for a client")
  .option(
    "--client <client:string>",
    "Client ID (claude-desktop|cursor|vscode)",
    { required: true },
  )
  .option(
    "--scope <scope:string>",
    "Config scope: user|workspace (reserved for Tier 3)",
  )
  .action(
    async (options: { client: string; scope?: string }) => {
      const { MCP_CLIENT_IDS, suggestId } = await import(
        "../install/adapters.ts"
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
          `error: unknown client '${clientId}' (known: ${
            MCP_CLIENT_IDS.join(", ")
          })${hint}`,
        );
        Deno.exit(1);
      }
      const { claudeDesktopAdapter, cursorAdapter, vscodeMcpAdapter } =
        await import("../install/mcp_adapters.ts");
      const result = clientId === "claude-desktop"
        ? claudeDesktopAdapter()
        : clientId === "cursor"
        ? cursorAdapter()
        : await vscodeMcpAdapter();
      if (result.stdout) console.log(result.stdout);
      if (result.stderr) console.error(result.stderr);
      Deno.exit(result.exitCode);
    },
  );
