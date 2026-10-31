/**
 * @module mcp/resources/mod
 *
 * Wires MCP resource handlers. Exposes:
 *
 * - {@linkcode listResourceDescriptors} — pure function returning the
 *   resources/list payload for unit-test verification.
 * - {@linkcode readResource} — pure function returning the resources/read
 *   payload for a given URI.
 * - {@linkcode registerResources} — attaches both handlers to a Server
 *   instance.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  type ReadResourceRequest,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Project } from "../project.ts";
import type { McpWorkspace } from "../workspace.ts";
import { perProject } from "../tools/fan_out.ts";
import {
  deliveredUri,
  ENTRIES_URI,
  entryUri,
  isDeliveredUri,
  isEntryUri,
  isProfileDetailUri,
  parseDeliveredUri,
  parseEntryUri,
  parseProfileDetailUri,
  PROFILE_URI,
  profileDetailUri,
} from "../uri.ts";
import {
  buildProfileView,
  renderProfile,
  renderProfileDetail,
} from "./profile.ts";
import { renderEntriesIndex } from "./entries.ts";
import { renderEntry } from "./entry.ts";
import { makeDisplayId } from "../../core/mod.ts";
import { extname } from "@std/path";

/**
 * Map a delivered document's file extension to a MIME type. Delivered
 * documents (ADR-030) can be any readable file — not just Markdown — so the
 * `markspec://delivered/...` resource reports the file's actual type rather
 * than a blanket `text/markdown`. Unknown extensions fall back to
 * `text/plain`.
 */
function mimeTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".md":
    case ".markdown":
      return "text/markdown";
    case ".json":
      return "application/json";
    case ".yaml":
    case ".yml":
      return "application/yaml";
    case ".csv":
      return "text/csv";
    case ".html":
    case ".htm":
      return "text/html";
    default:
      return "text/plain";
  }
}

/** A resource descriptor as returned by resources/list. */
export interface ResourceDescriptor {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
}

/**
 * Build the resources/list payload across every project of the workspace.
 * Each URI appears once; when several projects provide the same URI, the
 * descriptor comes from the first one in label order. With one project the
 * list is that project's list.
 */
export async function listResourceDescriptors(
  workspace: McpWorkspace,
): Promise<ResourceDescriptor[]> {
  const projects = workspace.projects();
  if (projects.length === 0) return [];
  const seen = new Set<string>();
  const add = (list: ResourceDescriptor[], d: ResourceDescriptor) => {
    if (seen.has(d.uri)) return;
    seen.add(d.uri);
    list.push(d);
  };
  const out: ResourceDescriptor[] = [];
  add(out, {
    uri: PROFILE_URI,
    name: "Active profile",
    description:
      "Distilled profile manifest: declared entry types, attribute definitions, link relations, validation rules. Read once to understand the project's domain vocabulary.",
    mimeType: "text/markdown",
  });
  // Profile detail URIs — one per element in each project's profile.
  for (const { project } of projects) {
    const overview = buildProfileView(project.profileChain).overview();
    for (const ref of overview.elements) {
      add(out, {
        uri: profileDetailUri(ref.kind, ref.name),
        name: `${ref.kind}: ${ref.name}`,
        description: ref.summary,
        mimeType: "text/markdown",
      });
    }
  }
  // Delivered documents (ADR-030) — one descriptor per profile-delivered
  // file, whether or not its entries join the graph.
  for (const { project } of projects) {
    for (const doc of project.delivers) {
      add(out, {
        uri: deliveredUri(doc.profileId, doc.path),
        name: `delivered: ${doc.path}`,
        description: doc.description ??
          (doc.corpus
            ? `Corpus document delivered by ${doc.profileId} — its entries are in the graph`
            : `Reference document delivered by ${doc.profileId}`),
        mimeType: "text/markdown",
      });
    }
  }
  add(out, {
    uri: ENTRIES_URI,
    name: "Entry index",
    description:
      "All entries grouped by type. Read for an overview of a small project (<50 entries); for larger projects use the entry_search tool instead.",
    mimeType: "text/markdown",
  });
  // Entry URIs — each distinct display ID once, sorted.
  const titles = new Map<string, string>();
  for (const { project } of projects) {
    const result = await project.getCompiled();
    for (const [id, entry] of result.entries) {
      if (!titles.has(id)) titles.set(id, entry.title);
    }
  }
  for (const id of [...titles.keys()].sort()) {
    add(out, {
      uri: entryUri(id),
      name: id,
      description: titles.get(id)!,
      mimeType: "text/markdown",
    });
  }
  return out;
}

/** Result of reading a resource. */
export interface ReadResourceResult {
  readonly uri: string;
  readonly mimeType: string;
  readonly text: string;
}

/** `true` when `project`'s active profile chain includes `profileId`. */
function chainIncludes(project: Project, profileId: string): boolean {
  return (project.profileChain?.tiers ?? []).some((t) => t.id === profileId) ||
    project.delivers.some((d) => d.profileId === profileId);
}

/**
 * Read a single resource by URI across the workspace. Throws on
 * unrecognized URIs.
 *
 * Profile, profile-element, entries-index and entry URIs read every project
 * that provides them: one project gives its text unchanged, several give
 * one `## Project: <label>` section each. A delivered document is read from
 * the first project, in label order, whose profile chain includes the
 * delivering profile.
 */
export async function readResource(
  uri: string,
  workspace: McpWorkspace,
): Promise<ReadResourceResult> {
  if (workspace.softGateMessage !== undefined) {
    return {
      uri,
      mimeType: "text/plain",
      text: workspace.softGateMessage,
    };
  }
  const markdown = (text: string): ReadResourceResult => ({
    uri,
    mimeType: "text/markdown",
    text,
  });

  if (uri === PROFILE_URI) {
    return markdown(
      await perProject(
        workspace,
        undefined,
        ({ project }) =>
          Promise.resolve(
            renderProfile(
              buildProfileView(project.profileChain),
              project.delivers,
            ),
          ),
        "",
      ),
    );
  }

  if (isProfileDetailUri(uri)) {
    const parsed = parseProfileDetailUri(uri)!;
    const text = await perProject(
      workspace,
      undefined,
      ({ project }) => {
        const detail = buildProfileView(project.profileChain).describe(
          parsed.kind,
          parsed.name,
        );
        return Promise.resolve(detail && renderProfileDetail(detail));
      },
      "",
    );
    if (text === "") {
      throw new Error(
        `profile element not found: ${parsed.kind}/${parsed.name}`,
      );
    }
    return markdown(text);
  }

  if (uri === ENTRIES_URI) {
    return markdown(
      await perProject(
        workspace,
        undefined,
        async ({ project }) => {
          const result = await project.getCompiled();
          return renderEntriesIndex([...result.entries.values()]);
        },
        "",
      ),
    );
  }

  if (isEntryUri(uri)) {
    const rawDisplayId = parseEntryUri(uri)!;
    const displayId = makeDisplayId(rawDisplayId);
    const text = await perProject(
      workspace,
      undefined,
      async ({ project }) => {
        const result = await project.getCompiled();
        const entry = result.entries.get(displayId);
        if (!entry) return undefined;
        const titles = new Map<string, string>();
        for (const [id, e] of result.entries) titles.set(id, e.title);
        return renderEntry(
          entry,
          result.forward.get(displayId) ?? [],
          result.reverse.get(displayId) ?? [],
          titles,
          project.projectRoot,
        );
      },
      "",
    );
    if (text === "") {
      throw new Error(`entry not found: ${rawDisplayId}`);
    }
    return markdown(text);
  }

  if (isDeliveredUri(uri)) {
    const parsed = parseDeliveredUri(uri)!;
    const holder = workspace.projects().find(({ project }) =>
      chainIncludes(project, parsed.profileId)
    );
    const text = await holder?.project.readDeliveredDocument(
      parsed.profileId,
      parsed.path,
    );
    if (text === undefined) {
      throw new Error(
        `delivered document not found: ${parsed.profileId}/${parsed.path}`,
      );
    }
    return { uri, mimeType: mimeTypeForPath(parsed.path), text };
  }

  throw new Error(`unknown resource URI: ${uri}`);
}

/** Attach resources/list and resources/read handlers to a Server. */
export function registerResources(
  server: Server,
  workspace: McpWorkspace,
): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: await listResourceDescriptors(workspace),
  }));

  server.setRequestHandler(
    ReadResourceRequestSchema,
    async (req: ReadResourceRequest) => {
      const uri = req.params.uri;
      const result = await readResource(uri, workspace);
      return {
        contents: [
          {
            uri: result.uri,
            mimeType: result.mimeType,
            text: result.text,
          },
        ],
      };
    },
  );
}
