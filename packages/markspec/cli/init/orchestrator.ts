/**
 * @module cli/init/orchestrator
 *
 * `runInit(options)` — the 8-step sequencer. Composes the planner +
 * scaffolders + resolvers + G0's `runMcpInstall` + a generic exec
 * runner for `upskill add`. Pure boundary: returns an
 * {@linkcode InitResult}; the CLI action surfaces stdout/stderr/exit.
 */

import { basename, join, relative } from "@std/path";
import type { McpAdapter } from "../install/adapters.ts";
import type {
  McpInstallOptions,
  OrchestratorResult,
} from "../install/mcp_orchestrator.ts";
import { resolveBinaryRef } from "./binary_resolver.ts";
import { resolveClientSet } from "./client_resolver.ts";
import { computeWritePlan } from "./planner.ts";
import { scaffoldMarkspecLock } from "./scaffolders/markspec_lock.ts";
import { scaffoldMarkspecYaml } from "./scaffolders/markspec_yaml.ts";
import { scaffoldProjectYaml } from "./scaffolders/project_yaml.ts";
import { scaffoldVscodeExtensions } from "./scaffolders/vscode_extensions.ts";
import type { MemFs } from "./fake_fs.ts";
import type {
  Action,
  InitClientId,
  InitResult,
  ProfileChoice,
  Warning,
} from "./types.ts";

/** Test-seam type for invoking the MCP orchestrator. */
export type McpRunner = (
  options: McpInstallOptions,
) => Promise<OrchestratorResult>;

/** Test-seam type for invoking subprocesses (upskill). */
export type ExecRunner = (
  command: string,
  args: readonly string[],
  options?: { readonly cwd?: string },
) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface RunInitOptions {
  readonly targetDir: string;
  readonly profileChoice: ProfileChoice;
  readonly forcedClients: readonly InitClientId[];
  readonly allClients: boolean;
  readonly noMcp: boolean;
  readonly noSkills: boolean;
  readonly binaryPathFlag: string | undefined;
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly fs: MemFs;
  readonly detectEnv: {
    whichCommand: (n: string) => Promise<string | undefined>;
    pathExists: (p: string) => Promise<boolean>;
    projectRoot: string;
    homeDir: string;
  };
  readonly binaryEnv: {
    whichCommand: (n: string) => Promise<string | undefined>;
    execPath: () => string;
    pathExists: (p: string) => Promise<boolean>;
  };
  readonly mcpRunner: McpRunner;
  readonly execRunner: ExecRunner;
  /**
   * Per-client MCP adapter descriptors. Threaded through to the
   * planner (for `adapter.resolveConfigPath` lookups) and used here
   * to map the planner's emitted file paths back to client IDs at
   * execute time. Production wires `claudeCodeDescriptor` +
   * `opencodeDescriptor`; tests inject stubs.
   */
  readonly mcpAdapters: ReadonlyMap<InitClientId, McpAdapter>;
  readonly now: () => string;
  readonly version: string;
}

const SKILLS_BUNDLE_SOURCE =
  "driftsys/markspec:skills/markspec-core.bundle.yaml";

export async function runInit(options: RunInitOptions): Promise<InitResult> {
  // Step 1+2: resolve client set and binary ref in parallel.
  const [clientSet, binaryRef] = await Promise.all([
    resolveClientSet({
      env: options.detectEnv,
      forcedClients: options.forcedClients,
      allClients: options.allClients,
      noMcp: options.noMcp,
    }),
    resolveBinaryRef({
      env: options.binaryEnv,
      binaryPathFlag: options.binaryPathFlag,
    }),
  ]);

  // Step 3: compute the write plan (pure, uses fs.exists only).
  const plan = await computeWritePlan({
    targetDir: options.targetDir,
    fs: options.fs,
    profileChoice: options.profileChoice,
    clientSet,
    force: options.force,
    mcpAdapters: options.mcpAdapters,
  });

  // Reverse-lookup for the executor: relative config path → client ID.
  // Built once from the same adapters the planner used so the executor
  // and planner agree on filenames without duplicating any literal.
  const mcpFileToClient = new Map<string, InitClientId>();
  for (const [clientId, adapter] of options.mcpAdapters) {
    const abs = adapter.resolveConfigPath(
      "workspace",
      options.targetDir,
      "",
      undefined,
      options.targetDir,
    );
    mcpFileToClient.set(relative(options.targetDir, abs), clientId);
  }

  // Spec §3 step 1: refuse non-empty target without --force.
  // Whitelist = pre-existing project files (static) ∪ top-level
  // entries the planner intends to write this run (dynamic).
  // Deriving the dynamic half from `plan.actions` means a future
  // scaffolder output is recognised automatically — no manual
  // sync of the static set required.
  if (!options.force) {
    const planOutputs = new Set(
      plan.actions.map((a) => a.file.split("/")[0]),
    );
    const entries = await options.fs.listEntries(options.targetDir);
    const unexpected = entries.filter(
      (name) => !isWhitelistedEntry(name, planOutputs),
    );
    if (unexpected.length > 0) {
      return {
        ok: false,
        exitCode: 1,
        target: options.targetDir,
        profile: options.profileChoice,
        clientsWritten: [],
        actions: [],
        warnings: [],
        skills: { installed: false, attempted: false },
        error: {
          code: "TARGET_NOT_EMPTY",
          message:
            `target directory not empty: ${options.targetDir} (unexpected: ${
              unexpected.join(", ")
            })`,
          details: { unexpectedEntries: unexpected },
        },
      };
    }
  }

  const warnings: Warning[] = [];
  // The binary reference is only written into MCP `command:` fields, so a
  // path warning is only meaningful when at least one MCP client will be
  // written. Under `--no-mcp` (or when no client is detected) `clientSet.write`
  // is empty and the warning is spurious — gating it here keeps init from
  // flipping the exit code to 2 for an unused binary path (#575).
  if (binaryRef.warning && clientSet.write.size > 0) {
    warnings.push({ code: "BINARY_PATH_WARNING", message: binaryRef.warning });
  }

  const executedActions: Action[] = [];
  let skillsAttempted = false;
  let skillsInstalled = false;

  if (!options.dryRun) {
    const dirName = basename(options.targetDir);
    const minVersion = toolchainMinVersion(options.version);

    // Steps 4–7: execute file writes per plan. Each branch reports
    // whether the action actually completed; only successes land in
    // executedActions so the InitResult does not advertise writes
    // that an MCP failure silently rolled back.
    for (const a of plan.actions) {
      let ok = true;
      switch (a.file) {
        case "project.yaml":
          if (a.kind === "create" || a.kind === "overwrite") {
            await forceWrite(
              options.fs,
              join(options.targetDir, "project.yaml"),
              a.kind === "overwrite",
              () => scaffoldProjectYaml(options.fs, options.targetDir, dirName),
            );
          }
          break;
        case ".markspec.yaml":
          if (a.kind === "create" || a.kind === "overwrite") {
            await forceWrite(
              options.fs,
              join(options.targetDir, ".markspec.yaml"),
              a.kind === "overwrite",
              () =>
                scaffoldMarkspecYaml(
                  options.fs,
                  options.targetDir,
                  options.profileChoice,
                ),
            );
          }
          break;
        case "markspec.lock":
          if (a.kind === "create" || a.kind === "overwrite") {
            await forceWrite(
              options.fs,
              join(options.targetDir, "markspec.lock"),
              a.kind === "overwrite",
              () =>
                scaffoldMarkspecLock(options.fs, options.targetDir, {
                  toolchainMinVersion: minVersion,
                  lockedAt: options.now(),
                }),
            );
          }
          break;
        case ".vscode/extensions.json":
          if (a.kind === "create" || a.kind === "merge") {
            await scaffoldVscodeExtensions(options.fs, options.targetDir);
          }
          break;
        default: {
          // Adapter-driven MCP branch. The planner emitted this file
          // path via `adapter.resolveConfigPath`; the reverse lookup
          // tells us which client it belongs to. Non-MCP files that
          // don't match the static cases above are skipped silently —
          // the planner does not emit any today.
          const client = mcpFileToClient.get(a.file);
          if (client === undefined) break;
          // Defensive guard. The planner only emits `create` or
          // `merge` for MCP files today, so this gate is a no-op
          // against the current planner. It exists so a future
          // planner change that emits `skip`/`no-op` for MCP files
          // cannot silently invoke the runner — matching the gates
          // on the other file branches.
          if (
            a.kind !== "create" && a.kind !== "merge" &&
            a.kind !== "overwrite"
          ) break;
          const r = await options.mcpRunner({
            client,
            scope: "workspace",
            binaryPath: binaryRef.command,
            force: options.force,
            env: { cwd: options.targetDir },
          });
          if (r.exitCode !== 0) {
            warnings.push({
              code: "MCP_INSTALL_FAILED",
              message:
                `runMcpInstall(${client}) exit=${r.exitCode}: ${r.stderr}`,
            });
            ok = false;
          }
          break;
        }
      }
      if (ok) executedActions.push(a);
    }

    // Step 8: install skills bundle via upskill.
    if (!options.noSkills) {
      skillsAttempted = true;
      const r = await options.execRunner(
        "upskill",
        ["add", SKILLS_BUNDLE_SOURCE],
        { cwd: options.targetDir },
      );
      // POSIX shells emit code 127 + "not found". cmd.exe emits
      // code 9009 + "is not recognized as an internal or external
      // command". Match both so Windows users see UPSKILL_NOT_FOUND
      // instead of the less-helpful UPSKILL_FAILED.
      const notFound = r.code === 127 || r.code === 9009 ||
        r.stderr.includes("not found") ||
        r.stderr.includes("not recognized");
      if (notFound) {
        warnings.push({
          code: "UPSKILL_NOT_FOUND",
          message:
            `'upskill' not on PATH. To install the markspec-core skills bundle later: upskill add ${SKILLS_BUNDLE_SOURCE}`,
        });
      } else if (r.code !== 0) {
        warnings.push({
          code: "UPSKILL_FAILED",
          message: `upskill add exit=${r.code}: ${r.stderr}`,
        });
      } else {
        skillsInstalled = true;
      }
    }
  } else {
    // Dry-run: report what would happen without executing any side effects.
    executedActions.push(...plan.actions);
  }

  // A non-bundled (git/local) profile may pin upstreams, but `init` writes a
  // stub `markspec.lock` with zero upstreams — it does not resolve the profile
  // chain (no network I/O at init time). Surface a warning pointing at
  // `markspec lock` so the stub is intentional and visible rather than a
  // silent inconsistency with the `.markspec.yaml` profile (#581). Gated on a
  // fresh lock actually being written (create/overwrite) so a re-run that
  // skips an existing lock stays quiet.
  const writesLockStub = (options.profileChoice.kind === "git" ||
    options.profileChoice.kind === "local") &&
    plan.actions.some((a) =>
      a.file === "markspec.lock" &&
      (a.kind === "create" || a.kind === "overwrite")
    );
  if (writesLockStub) {
    warnings.push({
      code: "LOCKFILE_STUB_NEEDS_PIN",
      message:
        `markspec.lock was written with no upstreams. Run \`markspec lock\` to resolve and pin the ${options.profileChoice.kind} profile chain.`,
    });
  }

  const hasSkip = executedActions.some((a) => a.kind === "skip");
  const exitCode: 0 | 1 | 2 = warnings.length > 0 || hasSkip ? 2 : 0;
  // Report only the clients whose MCP config actually landed. Deriving this
  // from `executedActions` (not the planned `clientSet.write`) means a client
  // whose MCP install failed — and was therefore excluded from
  // `executedActions` — is not advertised as written, matching the
  // "only successes land in the result" design (#575).
  const clientsWritten: InitClientId[] = executedActions
    .map((a) => mcpFileToClient.get(a.file))
    .filter((c): c is InitClientId => c !== undefined);

  return {
    ok: true,
    exitCode,
    target: options.targetDir,
    profile: options.profileChoice,
    clientsWritten,
    actions: executedActions,
    warnings,
    skills: { installed: skillsInstalled, attempted: skillsAttempted },
  };
}

/**
 * Common pre-existing project files that should not block init.
 *
 * Init's own scaffolder outputs are NOT listed here — they are derived
 * per-run from the planner's actions in `runInit`, so adding a new
 * scaffolder requires no manual sync with this set.
 */
const TARGET_WHITELIST = new Set([
  ".git",
  ".gitignore",
  "README.md",
  "LICENSE",
  ".editorconfig",
  ".vscode",
]);

function isWhitelistedEntry(
  name: string,
  planOutputs: ReadonlySet<string>,
): boolean {
  if (TARGET_WHITELIST.has(name)) return true;
  if (planOutputs.has(name)) return true;
  if (name.startsWith("LICENSE.")) return true;
  return false;
}

/** Convert "0.6.3" → "0.6" for the lockfile toolchain floor. */
function toolchainMinVersion(version: string): string {
  const m = version.match(/^(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}` : version;
}

/**
 * Remove `path` if `overwrite` is true, then invoke the supplied
 * scaffolder. Lets the executor handle every per-file write with one
 * call shape — `create` (overwrite=false) goes straight to the
 * scaffolder; `overwrite` clears the existing file first.
 */
async function forceWrite(
  fs: MemFs,
  path: string,
  overwrite: boolean,
  scaffold: () => Promise<unknown>,
): Promise<void> {
  if (overwrite) await fs.remove(path);
  await scaffold();
}
