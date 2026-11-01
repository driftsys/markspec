/**
 * @module mcp/tools/mod
 *
 * Registers `tools/list` and `tools/call` handlers on the MCP Server.
 * Each tool lives in its own file and exposes a descriptor + pure
 * rendering helpers. This module is the dispatch layer: every handler
 * answers across the projects of the {@linkcode McpWorkspace} that the
 * call selects (see {@linkcode perProject}).
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  type CallToolRequest,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { isAbsolute, join } from "@std/path";
import {
  type McpWorkspace,
  resolveWorkspace,
  type WorkspaceProject,
  type WorkspaceSource,
} from "../workspace.ts";
import { perProject, projectArgOf } from "./fan_out.ts";
import { PROJECT_LIST_DESCRIPTOR, renderProjectList } from "./project_list.ts";
import {
  ENTRY_SEARCH_DESCRIPTOR,
  rankAcrossProjects,
  renderProjectSearchResults,
  renderSearchResults,
  scoreEntries,
} from "./search.ts";
import { ENTRY_SHOW_DESCRIPTOR, renderShow } from "./show.ts";
import { makeDisplayId } from "../../core/mod.ts";
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
  noProfileMatchText,
  PROFILE_DESCRIBE_DESCRIPTOR,
} from "./profile_describe.ts";
import { buildProfileView } from "../resources/profile.ts";
import { ENTRY_LIST_DESCRIPTOR, renderList } from "./list.ts";
import {
  ENTRY_NEIGHBORHOOD_DESCRIPTOR,
  renderNeighborhood,
} from "./neighborhood.ts";

/** All tool descriptors, in `tools/list` order. */
export const TOOL_DESCRIPTORS = [
  ENTRY_SEARCH_DESCRIPTOR,
  ENTRY_SHOW_DESCRIPTOR,
  ENTRY_LIST_DESCRIPTOR,
  ENTRY_CONTEXT_DESCRIPTOR,
  ENTRY_NEIGHBORHOOD_DESCRIPTOR,
  VALIDATE_DESCRIPTOR,
  REFRESH_DESCRIPTOR,
  PROFILE_DESCRIBE_DESCRIPTOR,
  PROJECT_LIST_DESCRIPTOR,
];

/** Tool dispatch entry — takes raw arguments and the workspace. */
export interface ToolHandler {
  // deno-lint-ignore no-explicit-any
  (args: any, workspace: McpWorkspace): Promise<string>;
}

/**
 * Route each `validate` `files` path to the project that owns it. Relative
 * paths resolve against the workspace start root; every path is
 * canonicalised before the ownership lookup. Returns the canonical paths
 * per project label; paths no project owns are dropped.
 */
async function routeFiles(
  workspace: McpWorkspace,
  files: readonly string[],
): Promise<Map<string, string[]>> {
  const byLabel = new Map<string, string[]>();
  for (const file of files) {
    const absolute = isAbsolute(file) ? file : join(workspace.startRoot, file);
    const path = await workspace.canonicalPath(absolute);
    const owner = workspace.ownerOf(path);
    if (owner === undefined) continue;
    const list = byLabel.get(owner.label) ?? [];
    list.push(path);
    byLabel.set(owner.label, list);
  }
  return byLabel;
}

const HANDLERS: Record<string, ToolHandler> = {
  // deno-lint-ignore no-explicit-any
  entry_search: async (args: any, workspace) => {
    const query = String(args?.query ?? "");
    const limit = Math.min(100, Math.max(1, Number(args?.limit ?? 20)));
    const selected = workspace.select(projectArgOf(args));
    if (typeof selected === "string") return selected;
    const scoreProject = async ({ project }: WorkspaceProject) => {
      const result = await project.getCompiled();
      return scoreEntries([...result.entries.values()], query, limit);
    };
    if (selected.length === 1) {
      return renderSearchResults(await scoreProject(selected[0]), query);
    }
    // Several projects (#851): score every project at the same time, then
    // apply `limit` once to one list ranked across all of them. A failing
    // project is listed after the hits and uses no part of the limit.
    const outcomes = await Promise.all(selected.map(async (wp) => {
      try {
        return { label: wp.label, hits: await scoreProject(wp) };
      } catch (err) {
        return {
          label: wp.label,
          hits: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }));
    const errors = outcomes.flatMap(({ label, error }) =>
      error === undefined ? [] : [{ label, message: error }]
    );
    return renderProjectSearchResults(
      rankAcrossProjects(outcomes, limit),
      query,
      errors,
    );
  },

  // deno-lint-ignore no-explicit-any
  entry_show: (args: any, workspace) => {
    const id = String(args?.id ?? "");
    return perProject(
      workspace,
      projectArgOf(args),
      async ({ project }) => {
        const result = await project.getCompiled();
        if (!result.entries.has(makeDisplayId(id))) return undefined;
        return renderShow(result, id, project.projectRoot);
      },
      `No entry with display ID ${id}.\n`,
    );
  },

  // deno-lint-ignore no-explicit-any
  entry_context: (args: any, workspace) => {
    const id = String(args?.id ?? "");
    const depth = Math.min(50, Math.max(0, Number(args?.depth ?? 10)));
    return perProject(
      workspace,
      projectArgOf(args),
      async ({ project }) => {
        const result = await project.getCompiled();
        const chain = walkContext(result, id, depth);
        return chain.length === 0 ? undefined : renderContext(chain, id);
      },
      renderContext([], id),
    );
  },

  // deno-lint-ignore no-explicit-any
  entry_neighborhood: (args: any, workspace) => {
    const id = String(args?.id ?? "");
    const depth = Math.min(50, Math.max(0, Number(args?.depth ?? 3)));
    return perProject(
      workspace,
      projectArgOf(args),
      async ({ project }) => {
        const result = await project.getCompiled();
        if (!result.entries.has(makeDisplayId(id))) return undefined;
        return renderNeighborhood(result, id, depth);
      },
      `No entry with display ID ${id}.\n`,
    );
  },

  // deno-lint-ignore no-explicit-any
  validate: async (args: any, workspace) => {
    const files: readonly string[] | undefined = Array.isArray(args?.files)
      ? args.files.map((f: unknown) => String(f))
      : undefined;
    // An empty `files` list means every file, as before.
    const routed = files && files.length > 0
      ? await routeFiles(workspace, files)
      : undefined;
    const projectArg = projectArgOf(args);
    const selected = workspace.select(projectArg);
    // With one selected project, files it does not own still go to it as
    // given, so a single-project server answers exactly as before.
    const single = typeof selected !== "string" && selected.length === 1;
    return perProject(
      workspace,
      projectArg,
      async ({ label, project }) => {
        let owned: readonly string[] | undefined = routed?.get(label);
        if (routed && owned === undefined) {
          if (!single) return undefined;
          owned = files;
        }
        const result = await project.getCompiled();
        const filtered = filterDiagnostics(
          result.diagnostics,
          owned,
          project.projectRoot ?? "",
        );
        const leafTier = project.profileChain
          ? project.profileChain
            .tiers[project.profileChain.tiers.length - 1]
          : null;
        const profileLabel = leafTier
          ? `${leafTier.id}@${leafTier.version}`
          : null;
        return renderDiagnosticsReport(
          filtered,
          profileLabel,
          result.entries.size,
          project.projectRoot,
        );
      },
      // Reached only when several projects are selected.
      "None of the given files belongs to a selected MarkSpec project.\n",
    );
  },

  // deno-lint-ignore no-explicit-any
  entry_list: (args: any, workspace) => {
    const mode = args?.mode === "full" ? "full" : "summary";
    return perProject(
      workspace,
      projectArgOf(args),
      async ({ project }) => {
        const result = await project.getCompiled();
        return renderList([...result.entries.values()], {
          mode,
          type: args?.type !== undefined ? String(args.type) : undefined,
          label: args?.label !== undefined ? String(args.label) : undefined,
          page: args?.page !== undefined ? Number(args.page) : undefined,
        });
      },
      "",
    );
  },

  // deno-lint-ignore no-explicit-any
  markspec_refresh: async (args: any, workspace) => {
    // Pick up projects added or removed since the last discovery first.
    await workspace.rediscover();
    // Still no project: the soft-gate text, whatever `project` names.
    if (workspace.softGateMessage !== undefined) {
      return workspace.softGateMessage;
    }
    return perProject(
      workspace,
      projectArgOf(args),
      async ({ project }) => {
        const result = await project.forceRefresh();
        return renderRefresh(result.entries.size, result.links.length);
      },
      "",
    );
  },

  // deno-lint-ignore no-explicit-any
  profile_describe: (args: any, workspace) => {
    const noMatch = noProfileMatchText(String(args?.name ?? "").trim());
    return perProject(
      workspace,
      projectArgOf(args),
      ({ project }) => {
        const intro = buildProfileView(project.profileChain);
        const text = dispatchProfileDescribe(intro, args);
        return Promise.resolve(text === noMatch ? undefined : text);
      },
      noMatch,
    );
  },

  project_list: (_args, workspace) => renderProjectList(workspace),
};

/**
 * Dispatch a tool call by name. Soft-gates per ADR-023 §6 — when no
 * MarkSpec project was found, every tool returns the canonical soft-gate
 * message as normal content (not isError) so the agent's SKIP rule fires.
 * `markspec_refresh` re-runs discovery before that check, so it can find a
 * project created after the server started.
 *
 * Throws on unknown tool names so callers (the MCP request handler) can
 * map that to an isError response.
 */
export async function dispatchTool(
  name: string,
  // deno-lint-ignore no-explicit-any
  args: any,
  workspace: McpWorkspace,
): Promise<string> {
  const handler = HANDLERS[name];
  if (!handler) {
    throw new Error(`unknown tool: ${name}`);
  }
  // Soft gate — every known tool short-circuits, except markspec_refresh:
  // it re-runs discovery first and returns the soft-gate text itself when
  // there is still no project.
  if (
    workspace.softGateMessage !== undefined && name !== "markspec_refresh"
  ) {
    return workspace.softGateMessage;
  }
  return await handler(args ?? {}, workspace);
}

/**
 * Attach `tools/list` and `tools/call` handlers to a Server instance. When
 * `workspace` is a loader, each tool call waits for its current discovery
 * attempt, or starts a new one after a failure; `tools/list` does not.
 */
export function registerTools(
  server: Server,
  workspace: WorkspaceSource,
): void {
  server.setRequestHandler(ListToolsRequestSchema, () =>
    Promise.resolve({
      tools: TOOL_DESCRIPTORS,
    }));

  server.setRequestHandler(
    CallToolRequestSchema,
    async (req: CallToolRequest) => {
      try {
        const text = await dispatchTool(
          req.params.name,
          req.params.arguments,
          await resolveWorkspace(workspace),
        );
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
