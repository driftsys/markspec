/**
 * @module cli/commands/desk_cmd
 *
 * `markspec desk --serve` — start the MarkDesk backend API (ADR-035).
 *
 * Hidden from `markspec --help` while it is a walking skeleton: the
 * MarkDesk shell is its only intended caller, and the API is not yet a
 * stable surface.
 */

import { Command } from "@cliffy/command";

export const deskCmd = new Command()
  .description("Serve the MarkDesk backend API on loopback")
  .hidden()
  .example("Serve on a free port", "markspec desk --serve --port 0")
  .option("--serve", "Start the HTTP API server")
  .option("--port <port:integer>", "TCP port; 0 picks a free one", {
    default: 0,
  })
  .option("--root <path:string>", "Project root (defaults to discovery)")
  .action(async function (
    options: { serve?: boolean; port: number; root?: string },
  ) {
    if (!options.serve) {
      this.showHelp();
      return;
    }
    if (options.port < 0 || options.port > 65535) {
      console.error(`error: --port must be 0–65535, got ${options.port}`);
      Deno.exit(1);
    }
    const { startDeskServer } = await import("../../desk/server.ts");
    await startDeskServer({ port: options.port, root: options.root });
  });
