/**
 * @module cli/commands/mcp_cmd
 *
 * `markspec mcp` — start the MCP server or install its configuration.
 *
 * claude, opencode, and copilot run through the full `runMcpInstall`
 * orchestrator — JSON managed-block, timestamped sidecar backup,
 * diff preview, atomic write. vscode remains verify-only (parity
 * with Slice B's LSP vscode adapter). Cursor remains print-only.
 */

import { Command } from "@cliffy/command";

export const mcpCmd = new Command()
  .description("Start MCP server or install its configuration")
  .option(
    "--root <path:string>",
    "Project root to serve (repeatable). Overrides cwd/env discovery.",
    { collect: true },
  )
  .action(async (options: { root?: string[] }) => {
    const { startServer } = await import("../../mcp/server.ts");
    await startServer({ rootFlags: options.root ?? [] });
  })
  .command("install")
  .description("Install or print MCP server configuration for a client")
  .option(
    "--client <client:string>",
    "Client ID (claude|cursor|opencode|vscode|copilot)",
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
      const {
        DeadlineExceeded,
        resolveInstallDeadlineMs,
        withDeadline,
      } = await import("../install/deadline.ts");
      const { runMcpInstall } = await import(
        "../install/mcp_orchestrator.ts"
      );
      const deadlineMs = resolveInstallDeadlineMs();
      let result;
      try {
        // Never hang (#634): a config read wedged under host load trips
        // the watchdog into a fast diagnostic + non-zero exit instead of
        // an uninterruptible silent stall.
        result = await withDeadline(
          runMcpInstall({
            client: options.client,
            scope: options.scope,
            binaryPath: options.binaryPath,
            print: options.print,
            force: options.force,
            noColor: options.color === false,
            remove: options.remove,
          }),
          deadlineMs,
        );
      } catch (err) {
        if (err instanceof DeadlineExceeded) {
          await Deno.stderr.write(
            new TextEncoder().encode(
              `error: mcp install for client '${options.client}' timed out after ${deadlineMs}ms ` +
                `(host IO/lock contention?). Raise MARKSPEC_INSTALL_TIMEOUT_MS to wait longer, ` +
                `or register through Claude Code directly: claude mcp add markspec -- markspec mcp\n`,
            ),
          );
          Deno.exit(1);
        }
        throw err;
      }
      if (result.stdout) {
        await Deno.stdout.write(new TextEncoder().encode(result.stdout));
      }
      if (result.stderr) {
        await Deno.stderr.write(new TextEncoder().encode(result.stderr));
      }
      Deno.exit(result.exitCode);
    },
  );
