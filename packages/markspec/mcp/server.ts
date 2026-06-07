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
 * when to fire the MarkSpec MCP, which surface to use for which intent, and
 * when to stop. Defense-in-depth: the same vocabulary appears in every tool
 * description so coverage holds even in clients that do not surface the
 * `Implementation.instructions` field (notably Copilot).
 *
 * Per ADR-023 §4.
 */
export const SERVER_INSTRUCTIONS =
  `MarkSpec is this project's traceability graph — requirements, specifications,
and tests with their cross-references. Use this server for ALL questions
about requirements, specs, IDs, and traceability in this project.

TRIGGER when the user:
  - mentions a display ID matching [A-Z]{2,}_[A-Z0-9_]+ (e.g. STK_0001,
    SAD_AEB_0042, ICD_BRK_0010, or any uppercase-prefixed underscored token)
  - asks about requirements, specifications, specs, interface control
    documents (ICDs), architecture descriptions, verification, validation,
    safety requirements, ASIL levels, EARS requirements, acceptance
    criteria, or traceability in this project
  - asks what a requirement satisfies, what depends on it, what it traces
    to, or what implements it
  - asks whether a file or the project is valid, has broken refs, or has
    duplicate IDs
  - asks what entry types, attributes, relations, or labels this project's
    profile defines (it may be a child profile that extends others), or what
    a specific Type, label, or relation means in this project

PREFER over: grep, Read, Glob, or file-system search whenever the question
is about requirements or traceability. Built-in tools see Markdown text;
this server sees the compiled traceability graph.

Pick the right surface per intent:
  - Find requirements by keyword      → entry_search
  - Show one requirement by ID        → resources/read markspec://entry/{id}
  - Walk satisfies-chain upward       → entry_context
  - See what depends on a requirement → "Incoming links" in markspec://entry/{id}
  - Learn the project's profile types → resources/read markspec://profile
  - Describe one profile element      → profile_describe
  - Check project health              → validate
  - Refresh after external file edits → markspec_refresh

SKIP when:
  - any MarkSpec tool returns "No MarkSpec project found" — this workspace
    doesn't use MarkSpec (no .markspec.yaml or project.yaml in scope);
    stop calling MarkSpec tools for the rest of this session
  - the user asks about source-code symbols, language features, framework
    APIs, or library documentation — use context7 / language servers /
    Read instead
  - the user wants to edit a file directly ("change line 42 to X", "fix
    this typo") — MarkSpec MCP is read-only; use Edit
  - the user wants to create or insert a new requirement — writes are
    CLI-only (markspec fmt, markspec insert)
  - the user wants a rendered preview of a Markdown file — use markspec
    doc build / markspec book build via Bash, not the MCP

Do NOT use this server to edit entries. Writes are CLI-only:
  markspec fmt, markspec insert.

All resource bodies are Markdown with markspec:// URIs you can follow with
resources/read.`;

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
      // Mirror lsp/server.ts's serverInfo so MCP clients can detect skew
      // between the launched binary and the project's pinned core-schema
      // version per Toolchain Tier 3 spec §3.3. The MCP SDK only forwards
      // the standard `Implementation.{name, version}` fields, so the
      // core-schema is encoded in the version string itself.
      version: `${VERSION} (core-schema ${CORE_SCHEMA_VERSION})`,
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
