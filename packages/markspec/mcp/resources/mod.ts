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
import { type Project, SOFT_GATE_MESSAGE } from "../project.ts";
import {
  ENTRIES_URI,
  entryUri,
  isEntryUri,
  isProfileDetailUri,
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
  if (!project.markspecDetected) return [];
  const result = await project.getCompiled();
  const out: ResourceDescriptor[] = [
    {
      uri: PROFILE_URI,
      name: "Active profile",
      description:
        "Distilled profile manifest: declared entry types, attribute definitions, link relations, validation rules. Read once to understand the project's domain vocabulary.",
      mimeType: "text/markdown",
    },
  ];
  // Profile detail URIs — one per element in the active profile.
  const intro = buildProfileView(project.profileChain);
  const overview = intro.overview();
  for (const ref of overview.elements) {
    const uri = profileDetailUri(ref.kind, ref.name);
    out.push({
      uri,
      name: `${ref.kind}: ${ref.name}`,
      description: ref.summary,
      mimeType: "text/markdown",
    });
  }
  out.push({
    uri: ENTRIES_URI,
    name: "Entry index",
    description:
      "All entries grouped by type. Read for an overview of a small project (<50 entries); for larger projects use the entry_search tool instead.",
    mimeType: "text/markdown",
  });
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
  if (!project.markspecDetected) {
    return {
      uri,
      mimeType: "text/plain",
      text: SOFT_GATE_MESSAGE,
    };
  }
  if (uri === PROFILE_URI) {
    const intro = buildProfileView(project.profileChain);
    return {
      uri,
      mimeType: "text/markdown",
      text: renderProfile(intro),
    };
  }

  if (isProfileDetailUri(uri)) {
    const parsed = parseProfileDetailUri(uri)!;
    const intro = buildProfileView(project.profileChain);
    const detail = intro.describe(parsed.kind, parsed.name);
    if (!detail) {
      throw new Error(
        `profile element not found: ${parsed.kind}/${parsed.name}`,
      );
    }
    return {
      uri,
      mimeType: "text/markdown",
      text: renderProfileDetail(detail),
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
    const rawDisplayId = parseEntryUri(uri)!;
    const displayId = makeDisplayId(rawDisplayId);
    const result = await project.getCompiled();
    const entry = result.entries.get(displayId);
    if (!entry) {
      throw new Error(`entry not found: ${rawDisplayId}`);
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
        project.projectRoot,
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
