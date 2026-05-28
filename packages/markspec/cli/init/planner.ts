/**
 * @module cli/init/planner
 *
 * Pure planner — no I/O beyond what the supplied {@linkcode MemFs}
 * does for existence checks. Produces a {@linkcode WritePlan} the
 * orchestrator (or `--dry-run` printer) consumes. This is where the
 * spec §4 idempotency table becomes code.
 */

import { join } from "@std/path";
import type { MemFs } from "./fake_fs.ts";
import {
  EXTENSION_ID,
  mergeVscodeExtensions,
} from "./scaffolders/vscode_extensions.ts";
import type { Action, ClientSet, ProfileChoice, WritePlan } from "./types.ts";

export interface PlanInputs {
  readonly targetDir: string;
  readonly fs: MemFs;
  readonly profileChoice: ProfileChoice;
  readonly clientSet: ClientSet;
  readonly force: boolean;
}

const SKIP_HINT = "rerun with --force to overwrite";

export async function computeWritePlan(inputs: PlanInputs): Promise<WritePlan> {
  const actions: Action[] = [];

  for (const file of ["project.yaml", ".markspec.yaml", "markspec.lock"]) {
    actions.push(await singleFileAction(inputs, file));
  }

  for (const client of inputs.clientSet.write) {
    const file = client === "opencode" ? "opencode.json" : ".mcp.json";
    const exists = await inputs.fs.exists(join(inputs.targetDir, file));
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
