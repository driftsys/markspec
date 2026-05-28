/**
 * @module cli/init/client_resolver
 *
 * Compose adapter `detect()` calls + `--client` + `--all-clients` +
 * `--no-mcp` into the final {@linkcode ClientSet} init will write
 * MCP configs for.
 *
 * Cursor and vscode are deliberately excluded from init — the vscode
 * extension is the canonical surface for vscode, cursor is not a
 * supported target.
 */

import { claudeCodeDescriptor } from "../install/mcp_adapters_claude_code.ts";
import { opencodeDescriptor } from "../install/mcp_adapters_opencode.ts";
import type { DetectEnv } from "../install/adapters.ts";
import { type ClientSet, INIT_CLIENT_IDS, type InitClientId } from "./types.ts";

export interface ResolveClientSetOptions {
  readonly env: DetectEnv;
  readonly forcedClients: readonly InitClientId[];
  readonly allClients: boolean;
  readonly noMcp: boolean;
}

export async function resolveClientSet(
  options: ResolveClientSetOptions,
): Promise<ClientSet> {
  if (options.noMcp) return { write: new Set() };

  const write = new Set<InitClientId>();

  if (options.allClients) {
    write.add("claude-code");
    write.add("opencode");
  } else {
    if ((await claudeCodeDescriptor.detect!(options.env)).detected) {
      write.add("claude-code");
    }
    if ((await opencodeDescriptor.detect!(options.env)).detected) {
      write.add("opencode");
    }
  }

  for (const c of options.forcedClients) {
    if (INIT_CLIENT_IDS.includes(c)) write.add(c);
  }

  return { write };
}
