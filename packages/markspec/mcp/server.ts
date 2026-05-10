/**
 * @module mcp/server
 *
 * MCP server entry point. Constructs a `Server` over stdio, initializes the
 * project context, registers resources + tools, and wires resource-change
 * notifications to the cache invalidation hook.
 *
 * This module is dynamically imported by `main.ts` when the user runs
 * `markspec mcp` — never loaded by other subcommands.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import process from "node:process";
import { VERSION } from "../core/mod.ts";
import { createProject, defaultEnv } from "./project.ts";
import { registerResources } from "./resources/mod.ts";
import { registerTools } from "./tools/mod.ts";
import { ENTRIES_URI, entryUri, PROFILE_URI } from "./uri.ts";

/**
 * Start the MarkSpec MCP server.
 *
 * Builds the project context, registers resources + tools, hooks the
 * cache-invalidation signal to MCP `resources/updated` and
 * `resources/list_changed` notifications, then opens a stdio transport
 * and blocks until stdin closes.
 */
export async function startServer(): Promise<void> {
  const server = new Server(
    { name: "markspec", version: VERSION },
    {
      capabilities: {
        resources: { subscribe: true, listChanged: true },
        tools: { listChanged: false },
      },
    },
  );

  const project = await createProject(defaultEnv());

  registerResources(server, project);
  registerTools(server, project);

  // Fire resource list / profile / entries-index change notifications on
  // every cache invalidation. The SDK's typed helpers wrap the protocol
  // `notifications/resources/list_changed` and `.../updated` messages.
  project.subscribeInvalidation(() => {
    void server.sendResourceListChanged();
    void server.sendResourceUpdated({ uri: PROFILE_URI });
    void server.sendResourceUpdated({ uri: ENTRIES_URI });
  });

  // Per-entry resource updates on every recompile — best effort. Failures
  // are swallowed because resource notifications are advisory; the client
  // will re-fetch on its own.
  project.subscribeInvalidation(async () => {
    try {
      const result = await project.getCompiled();
      for (const id of result.entries.keys()) {
        void server.sendResourceUpdated({ uri: entryUri(id) });
      }
    } catch {
      // Recompile failed — skip notifications.
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep the process alive until stdin closes.
  process.stdin.on("end", () => {
    server.close().finally(() => process.exit(0));
  });
}

if (import.meta.main) {
  await startServer();
}
