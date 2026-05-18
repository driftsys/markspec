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
import { CORE_SCHEMA_VERSION, VERSION } from "../core/mod.ts";
import { createProject, defaultEnv } from "./project.ts";
import { registerResources } from "./resources/mod.ts";
import { registerTools } from "./tools/mod.ts";
import { ENTRIES_URI, entryUri, PROFILE_URI } from "./uri.ts";

/**
 * Top-level guidance shown to MCP clients on `initialize`. Teaches the agent
 * what this server is for, which surface to use for which intent, and what to
 * avoid. Clients typically inject this into the system prompt once per
 * session — keep it dense and stable.
 */
const SERVER_INSTRUCTIONS =
  `MarkSpec exposes a project's requirements, specifications, and tests as a typed traceability graph. Use it to answer questions about entries, their relationships, and validation status.

Pick the right surface per intent:
- Find entries by keyword → entry_search tool (scales to thousands of entries; preferred discovery path)
- Show one entry by display ID → resources/read markspec://entry/{displayId}
- Walk upward from an entry to see what it satisfies → entry_context tool
- See what depends on an entry → the "Incoming links" section in markspec://entry/{id}
- Check project health (broken refs, duplicates, rule violations) → validate tool
- Refresh after CLI/file edits → markspec_refresh tool

Avoid:
- Reading markspec://entries on projects with more than ~50 entries; use entry_search instead.
- Calling markspec_refresh between back-to-back reads — MCP reads are cache-coherent within a session.
- Using this server to edit entries. Writes are CLI-only (markspec format, markspec insert).

All resource bodies are Markdown with cross-references as markspec:// URIs you can follow with resources/read.`;

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
    {
      name: "markspec",
      version: VERSION,
      coreSchemaVersion: CORE_SCHEMA_VERSION,
    },
    {
      capabilities: {
        resources: { subscribe: true, listChanged: true },
        tools: { listChanged: false },
      },
      instructions: SERVER_INSTRUCTIONS,
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
