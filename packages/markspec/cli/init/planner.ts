/**
 * @module cli/init/planner
 *
 * Pure planner — no I/O beyond what the supplied {@linkcode MemFs}
 * does for existence checks. Produces a {@linkcode WritePlan} the
 * orchestrator (or `--dry-run` printer) consumes. This is where the
 * spec §4 idempotency table becomes code.
 */

import { join, relative } from "@std/path";
import type { MemFs } from "./fake_fs.ts";
import type { McpAdapter } from "../install/adapters.ts";
import {
  EXTENSION_ID,
  mergeVscodeExtensions,
} from "./scaffolders/vscode_extensions.ts";
import type {
  Action,
  ClientSet,
  InitClientId,
  ProfileChoice,
  WritePlan,
} from "./types.ts";

export interface PlanInputs {
  readonly targetDir: string;
  readonly fs: MemFs;
  readonly profileChoice: ProfileChoice;
  readonly clientSet: ClientSet;
  readonly force: boolean;
  /**
   * Per-client adapter descriptors. The planner calls
   * `adapter.resolveConfigPath("workspace", ...)` for each client in
   * `clientSet.write` to discover where the client expects its config,
   * so the planner does not hardcode client → filename mappings.
   * Keyed by {@linkcode InitClientId}.
   */
  readonly mcpAdapters: ReadonlyMap<InitClientId, McpAdapter>;
}

const SKIP_HINT = "rerun with --force to overwrite";

export async function computeWritePlan(inputs: PlanInputs): Promise<WritePlan> {
  const actions: Action[] = [];

  for (const file of ["project.yaml", ".markspec.yaml", "markspec.lock"]) {
    actions.push(await singleFileAction(inputs, file));
  }

  for (const client of inputs.clientSet.write) {
    const adapter = inputs.mcpAdapters.get(client);
    if (!adapter) {
      // Defensive: clientSet.write should only contain IDs the
      // orchestrator has an adapter for. Skip rather than throw so a
      // misconfigured wiring surfaces as a missing action, not a crash.
      continue;
    }
    const absPath = adapter.resolveConfigPath(
      "workspace",
      inputs.targetDir,
      "",
      undefined,
      inputs.targetDir,
    );
    const file = relative(inputs.targetDir, absPath);
    const exists = await inputs.fs.exists(absPath);
    actions.push(
      exists ? { kind: "merge", file } : { kind: "create", file },
    );
  }

  actions.push(await vscodeAction(inputs));

  return { actions };
}

async function singleFileAction(
  inputs: PlanInputs,
  file: string,
): Promise<Action> {
  const path = join(inputs.targetDir, file);
  const exists = await inputs.fs.exists(path);
  if (!exists) return { kind: "create", file };
  if (inputs.force) return { kind: "overwrite", file, reason: "force" };
  return { kind: "skip", file, reason: SKIP_HINT };
}

async function vscodeAction(inputs: PlanInputs): Promise<Action> {
  const file = ".vscode/extensions.json";
  const path = join(inputs.targetDir, file);
  const existing = await inputs.fs.read(path);
  if (existing === undefined) return { kind: "create", file };
  try {
    const merged = mergeVscodeExtensions(existing);
    return merged === null ? { kind: "no-op", file } : { kind: "merge", file };
  } catch {
    return { kind: "skip", file, reason: "malformed JSON" };
  }
}

export { EXTENSION_ID };
