/**
 * @module mcp/tools/mod
 *
 * Registers `tools/list` and `tools/call` handlers on the MCP Server.
 * Each tool lives in its own file and exposes a descriptor + pure
 * rendering helpers. This module is the dispatch layer.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  type CallToolRequest,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Project } from "../project.ts";
import {
  ENTRY_SEARCH_DESCRIPTOR,
  renderSearchResults,
  scoreEntries,
} from "./search.ts";
import {
  ENTRY_CONTEXT_DESCRIPTOR,
  renderContext,
  walkContext,
} from "./context.ts";
import {
  filterDiagnostics,
  renderDiagnosticsReport,
  VALIDATE_DESCRIPTOR,
} from "./validate.ts";
import { REFRESH_DESCRIPTOR, renderRefresh } from "./refresh.ts";
import {
  dispatchProfileDescribe,
  PROFILE_DESCRIBE_DESCRIPTOR,
} from "./profile_describe.ts";
import { buildProfileView } from "../resources/profile.ts";

/** All tool descriptors, in `tools/list` order. */
export const TOOL_DESCRIPTORS = [
  ENTRY_SEARCH_DESCRIPTOR,
  ENTRY_CONTEXT_DESCRIPTOR,
  VALIDATE_DESCRIPTOR,
  REFRESH_DESCRIPTOR,
  PROFILE_DESCRIBE_DESCRIPTOR,
];

/** Tool dispatch entry — takes raw arguments and the project context. */
interface ToolHandler {
  // deno-lint-ignore no-explicit-any
  (args: any, project: Project): Promise<string>;
}

const HANDLERS: Record<string, ToolHandler> = {
  // deno-lint-ignore no-explicit-any
  entry_search: async (args: any, project) => {
    const query = String(args?.query ?? "");
    const limit = Math.min(100, Math.max(1, Number(args?.limit ?? 20)));
    const result = await project.getCompiled();
    const hits = scoreEntries(
      [...result.entries.values()],
      query,
      limit,
    );
    return renderSearchResults(hits, query);
  },

  // deno-lint-ignore no-explicit-any
  entry_context: async (args: any, project) => {
    const id = String(args?.id ?? "");
    const depth = Math.min(50, Math.max(0, Number(args?.depth ?? 10)));
    const result = await project.getCompiled();
    const chain = walkContext(result, id, depth);
    return renderContext(chain, id);
  },

  // deno-lint-ignore no-explicit-any
  validate: async (args: any, project) => {
    const files: readonly string[] | undefined = Array.isArray(args?.files)
      ? args.files.map((f: unknown) => String(f))
      : undefined;
    const result = await project.getCompiled();
    const filtered = filterDiagnostics(
      result.diagnostics,
      files,
      project.projectRoot ?? "",
    );
    const leafTier = project.profileChain
      ? project.profileChain
        .tiers[project.profileChain.tiers.length - 1]
      : null;
    const profileLabel = leafTier ? `${leafTier.id}@${leafTier.version}` : null;
    return renderDiagnosticsReport(
      filtered,
      profileLabel,
      result.entries.size,
      project.projectRoot,
    );
  },

  markspec_refresh: async (_args, project) => {
    const result = await project.forceRefresh();
    return renderRefresh(result.entries.size, result.links.length);
  },

  // deno-lint-ignore no-explicit-any
  profile_describe: (args: any, project) => {
    const intro = buildProfileView(project.profileChain);
    return Promise.resolve(dispatchProfileDescribe(intro, args));
  },
};

/** Attach `tools/list` and `tools/call` handlers to a Server instance. */
export function registerTools(server: Server, project: Project): void {
  server.setRequestHandler(ListToolsRequestSchema, () =>
    Promise.resolve({
      tools: TOOL_DESCRIPTORS,
    }));

  server.setRequestHandler(
    CallToolRequestSchema,
    async (req: CallToolRequest) => {
      const name = req.params.name;
      const handler = HANDLERS[name];
      if (!handler) {
        return {
          isError: true,
          content: [{ type: "text", text: `unknown tool: ${name}` }],
        };
      }
      try {
        const text = await handler(req.params.arguments ?? {}, project);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: (err as Error).message }],
        };
      }
    },
  );
}
