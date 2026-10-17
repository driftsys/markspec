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

/**
 * Return the `URL.origin` form of one `--allow-origin` value, or `undefined`
 * when the value is not a bare http(s) origin in canonical spelling. A single
 * trailing `/` is removed. Any other non-canonical spelling is rejected, not
 * normalised: a path, query, fragment, credentials, an uppercase host, or an
 * explicit default port.
 */
export function parseAllowOrigin(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const withoutSlash = value.endsWith("/") ? value.slice(0, -1) : value;
  return url.origin === withoutSlash ? url.origin : undefined;
}

export const deskCmd = new Command()
  .description("Serve the MarkDesk backend API on loopback")
  .hidden()
  .example("Serve on a free port", "markspec desk --serve --port 0")
  .example(
    "Allow the Vite dev server origin",
    "markspec desk --serve --port 0 --allow-origin http://localhost:5173",
  )
  .option("--serve", "Start the HTTP API server")
  .option("--port <port:integer>", "TCP port; 0 picks a free one", {
    default: 0,
  })
  .option("--root <path:string>", "Project root (defaults to discovery)")
  .option(
    "--allow-origin <origin:string>",
    "Extra browser origin allowed to call the API (repeatable), e.g. the Vite dev server",
    { collect: true },
  )
  .option(
    "--exit-on-stdin-eof",
    "Exit when stdin closes (for app-managed sidecars)",
  )
  .action(async function (
    options: {
      serve?: boolean;
      port: number;
      root?: string;
      allowOrigin?: string[];
      exitOnStdinEof?: boolean;
    },
  ) {
    if (!options.serve) {
      this.showHelp();
      return;
    }
    if (options.port < 0 || options.port > 65535) {
      console.error(`error: --port must be 0–65535, got ${options.port}`);
      Deno.exit(1);
    }
    const allowedOrigins: string[] = [];
    for (const value of options.allowOrigin ?? []) {
      const origin = parseAllowOrigin(value);
      if (origin === undefined) {
        console.error(
          `error: --allow-origin must be an origin like http://localhost:5173, got ${value}`,
        );
        Deno.exit(1);
      }
      allowedOrigins.push(origin);
    }
    const { startDeskServer } = await import("../../desk/server.ts");
    await startDeskServer({
      port: options.port,
      root: options.root,
      allowedOrigins,
      exitOnStdinEof: options.exitOnStdinEof,
    });
  });
