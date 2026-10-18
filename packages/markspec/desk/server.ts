/**
 * @module desk/server
 *
 * `markspec desk --serve` — the MarkDesk backend (ADR-035). Serves the
 * desk API (`schemas/desk-api.json`, handler in `desk/api.ts`) over HTTP on
 * loopback only, guarded by a per-launch nonce token.
 *
 * Dynamically imported by `cli/commands/desk_cmd.ts`, so no other
 * subcommand pays for it. Read endpoints only, no
 * WebSocket, no forge, no agents yet.
 *
 * Handshake: once listening, the server prints exactly one JSON line to
 * stdout — `{"url":"http://127.0.0.1:<port>","token":"<nonce>","apiVersion":3,"root":"<absolute product root>"}`
 * — which the MarkDesk shell (or a test) reads to connect. Everything else
 * goes to stderr (clig.dev: stdout for data).
 */

import { resolve } from "@std/path";
import { encodeBase64Url } from "@std/encoding/base64url";
import { createProject, defaultEnv } from "../mcp/project.ts";
import { createDeskHandler, DESK_API_VERSION } from "./api.ts";

/** Options for {@linkcode startDeskServer}. */
export interface DeskServerOptions {
  /** TCP port; `0` asks the OS for a free one. */
  readonly port: number;
  /** Explicit project root. Defaults to discovery from the cwd. */
  readonly root?: string;
  /** Extra browser origins (`URL.origin` form) added to the Tauri allowlist. */
  readonly allowedOrigins?: readonly string[];
  /** Stop the server when stdin reaches end of file (app-managed sidecars). */
  readonly exitOnStdinEof?: boolean;
}

/** The line printed to stdout once the server is listening. */
export interface DeskHandshake {
  readonly url: string;
  readonly token: string;
  readonly apiVersion: number;
  /** Absolute, symlink-resolved path of the discovered product root. */
  readonly root: string;
}

/** Generate a 256-bit, URL-safe nonce for this launch. */
function generateToken(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Discover the project, start the loopback listener, print the handshake,
 * and serve until the process is terminated. Exits 1 when no MarkSpec
 * project is found — there is nothing to serve.
 */
export async function startDeskServer(
  options: DeskServerOptions,
): Promise<void> {
  // Desk's root precedence is `--root` > cwd. It deliberately does not
  // inherit the MCP server's MARKSPEC_PROJECT_ROOT / CLAUDE_PROJECT_DIR
  // overrides (ADR-028): the shell always launches desk with `--root`.
  //
  // An explicit `--root` is strict: the process cwd is replaced as well, so a
  // folder outside any product fails instead of falling back to the cwd's
  // product. A subfolder of a product still opens the enclosing product,
  // because discovery walks upward from the given folder.
  const explicitRoot = options.root ? resolve(options.root) : undefined;
  const env = {
    ...defaultEnv(),
    rootOverrides: () => explicitRoot ? [explicitRoot] : [],
    ...(explicitRoot ? { cwd: () => explicitRoot } : {}),
  };
  const project = await createProject(env);
  if (!project.markspecDetected || project.projectRoot === undefined) {
    console.error(`error: ${project.softGateMessage}`);
    Deno.exit(1);
  }
  const projectRoot = project.projectRoot;

  const token = generateToken();
  const handler = createDeskHandler({
    token,
    allowedOrigins: options.allowedOrigins,
    source: {
      projectRoot,
      projectName: project.config?.name,
      profile: project.profile,
      getCompiled: () => project.getCompiled(),
      readFile: async (path) => {
        try {
          return await Deno.readTextFile(path);
        } catch {
          return undefined;
        }
      },
      realPath: async (path) => {
        try {
          return await Deno.realPath(path);
        } catch {
          return undefined;
        }
      },
    },
  });

  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: options.port,
    onListen: () => {},
  }, handler);

  const { port } = server.addr as Deno.NetAddr;
  const handshake: DeskHandshake = {
    url: `http://127.0.0.1:${port}`,
    token,
    apiVersion: DESK_API_VERSION,
    root: await Deno.realPath(projectRoot),
  };
  console.log(JSON.stringify(handshake));
  console.error(`markspec desk: serving ${projectRoot} at ${handshake.url}`);

  if (options.exitOnStdinEof) {
    // Read stdin to the end, then stop the server so the process exits 0.
    (async () => {
      try {
        for await (const _chunk of Deno.stdin.readable) { /* discard */ }
      } catch { /* a read error also means the parent is gone */ }
      try {
        await server.shutdown();
      } catch { /* the server may already be stopped */ }
    })();
  }

  await server.finished;
}
