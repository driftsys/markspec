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
import {
  ENTRIES_URI,
  entryUri,
  isEntryUri,
  parseEntryUri,
  PROFILE_URI,
} from "../uri.ts";
import { buildProfileView, renderProfile } from "./profile.ts";
import { renderEntriesIndex } from "./entries.ts";
import { renderEntry } from "./entry.ts";

/** A resource descriptor as returned by resources/list. */
export interface ResourceDescriptor {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
}

/** Build the resources/list payload from a compiled project. */
export async function listResourceDescriptors(
  project: Project,
): Promise<ResourceDescriptor[]> {
  const result = await project.getCompiled();
  const out: ResourceDescriptor[] = [
    {
      uri: PROFILE_URI,
      name: "Active profile",
      description: "Distilled profile manifest for this project",
      mimeType: "text/markdown",
    },
    {
      uri: ENTRIES_URI,
      name: "Entry index",
      description: "All entries grouped by type",
      mimeType: "text/markdown",
    },
  ];
  const ids = [...result.entries.keys()].sort();
  for (const id of ids) {
    const entry = result.entries.get(id)!;
    out.push({
      uri: entryUri(id),
      name: id,
      description: entry.title,
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

/** Read a single resource by URI. Throws on unrecognized URIs. */
export async function readResource(
  uri: string,
  project: Project,
): Promise<ReadResourceResult> {
  if (uri === PROFILE_URI) {
    const view = buildProfileView(project.profileChain);
    return {
      uri,
      mimeType: "text/markdown",
      text: renderProfile(view),
    };
  }

  if (uri === ENTRIES_URI) {
    const result = await project.getCompiled();
    return {
      uri,
      mimeType: "text/markdown",
      text: renderEntriesIndex([...result.entries.values()]),
    };
  }

  if (isEntryUri(uri)) {
    const displayId = parseEntryUri(uri)!;
    const result = await project.getCompiled();
    const entry = result.entries.get(displayId);
    if (!entry) {
      throw new Error(`entry not found: ${displayId}`);
    }
    const titles = new Map<string, string>();
    for (const [id, e] of result.entries) titles.set(id, e.title);
    return {
      uri,
      mimeType: "text/markdown",
      text: renderEntry(
        entry,
        result.forward.get(displayId) ?? [],
        result.reverse.get(displayId) ?? [],
        titles,
      ),
    };
  }

  throw new Error(`unknown resource URI: ${uri}`);
}

/** Attach resources/list and resources/read handlers to a Server. */
export function registerResources(server: Server, project: Project): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: await listResourceDescriptors(project),
  }));

  server.setRequestHandler(
    ReadResourceRequestSchema,
    async (req: ReadResourceRequest) => {
      const uri = req.params.uri;
      const result = await readResource(uri, project);
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
