// packages/markspec/cli/init/orchestrator_test.ts

import { assertEquals } from "@std/assert";
import { createMemFs } from "./fake_fs.ts";
import { type ExecRunner, type McpRunner, runInit } from "./orchestrator.ts";
import { claudeCodeDescriptor } from "../install/mcp_adapters_claude_code.ts";
import { opencodeDescriptor } from "../install/mcp_adapters_opencode.ts";

const adapters = new Map([
  ["claude-code" as const, claudeCodeDescriptor],
  ["opencode" as const, opencodeDescriptor],
]);

const FROZEN_TIME = "2026-05-28T12:00:00Z";

function fakeNow(): string {
  return FROZEN_TIME;
}

const allDetectedEnv = {
  whichCommand: (name: string) =>
    Promise.resolve(name === "markspec" ? "/abs/markspec" : "/abs/x"),
  execPath: () => "/abs/markspec",
  pathExists: () => Promise.resolve(true),
  projectRoot: "/repo",
  homeDir: "/h",
};

const noClientEnv = {
  whichCommand: (n: string) =>
    Promise.resolve(n === "markspec" ? "/abs/markspec" : undefined),
  execPath: () => "/abs/markspec",
  pathExists: () => Promise.resolve(false),
  projectRoot: "/repo",
  homeDir: "/h",
};

const okMcpRunner: McpRunner = () =>
  Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });

const okExec: ExecRunner = () =>
  Promise.resolve({ code: 0, stdout: "", stderr: "" });

const missingExec: ExecRunner = (cmd) =>
  Promise.resolve({
    code: 127,
    stdout: "",
    stderr: `${cmd}: not found`,
  });

Deno.test("runInit: empty target, no clients, ok path", async () => {
  const fs = createMemFs();
  const result = await runInit({
    targetDir: "/repo",
    profileChoice: { kind: "bundled" },
    forcedClients: [],
    allClients: false,
    noMcp: false,
    noSkills: false,
    binaryPathFlag: undefined,
    force: false,
    dryRun: false,
    fs,
    detectEnv: noClientEnv,
    binaryEnv: noClientEnv,
    mcpRunner: okMcpRunner,
    execRunner: okExec,
    now: fakeNow,
    version: "0.6.0",
    mcpAdapters: adapters,
  });
  assertEquals(result.ok, true);
  assertEquals(result.exitCode, 0);
  assertEquals((await fs.read("/repo/project.yaml")) !== undefined, true);
  assertEquals((await fs.read("/repo/.markspec.yaml")) !== undefined, true);
  assertEquals((await fs.read("/repo/markspec.lock")) !== undefined, true);
  assertEquals(
    (await fs.read("/repo/.vscode/extensions.json")) !== undefined,
    true,
  );
});

Deno.test("runInit: --dry-run writes no files", async () => {
  const fs = createMemFs();
  const result = await runInit({
    targetDir: "/repo",
    profileChoice: { kind: "bundled" },
    forcedClients: [],
    allClients: false,
    noMcp: false,
    noSkills: false,
    binaryPathFlag: undefined,
    force: false,
    dryRun: true,
    fs,
    detectEnv: noClientEnv,
    binaryEnv: noClientEnv,
    mcpRunner: okMcpRunner,
    execRunner: okExec,
    now: fakeNow,
    version: "0.6.0",
    mcpAdapters: adapters,
  });
  assertEquals(result.ok, true);
  assertEquals(await fs.read("/repo/project.yaml"), undefined);
  assertEquals(result.actions.length > 0, true);
});

Deno.test("runInit: clients detected → mcpRunner invoked per client", async () => {
  const calls: string[] = [];
  const fs = createMemFs();
  const mcp: McpRunner = (opts) => {
    calls.push(opts.client);
    return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
  };
  await runInit({
    targetDir: "/repo",
    profileChoice: { kind: "bundled" },
    forcedClients: [],
    allClients: false,
    noMcp: false,
    noSkills: false,
    binaryPathFlag: undefined,
    force: false,
    dryRun: false,
    fs,
    detectEnv: allDetectedEnv,
    binaryEnv: allDetectedEnv,
    mcpRunner: mcp,
    execRunner: okExec,
    now: fakeNow,
    version: "0.6.0",
    mcpAdapters: adapters,
  });
  assertEquals(calls.sort(), ["claude-code", "opencode"]);
});

Deno.test("runInit: --no-skills skips upskill", async () => {
  const calls: string[] = [];
  const fs = createMemFs();
  const exec: ExecRunner = (cmd) => {
    calls.push(cmd);
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };
  await runInit({
    targetDir: "/repo",
    profileChoice: { kind: "bundled" },
    forcedClients: [],
    allClients: false,
    noMcp: false,
    noSkills: true,
    binaryPathFlag: undefined,
    force: false,
    dryRun: false,
    fs,
    detectEnv: noClientEnv,
    binaryEnv: noClientEnv,
    mcpRunner: okMcpRunner,
    execRunner: exec,
    now: fakeNow,
    version: "0.6.0",
    mcpAdapters: adapters,
  });
  assertEquals(calls.includes("upskill"), false);
});

Deno.test("runInit: upskill missing → warning + exit 2", async () => {
  const fs = createMemFs();
  const result = await runInit({
    targetDir: "/repo",
    profileChoice: { kind: "bundled" },
    forcedClients: [],
    allClients: false,
    noMcp: false,
    noSkills: false,
    binaryPathFlag: undefined,
    force: false,
    dryRun: false,
    fs,
    detectEnv: noClientEnv,
    binaryEnv: noClientEnv,
    mcpRunner: okMcpRunner,
    execRunner: missingExec,
    now: fakeNow,
    version: "0.6.0",
    mcpAdapters: adapters,
  });
  assertEquals(result.exitCode, 2);
  const upskillWarn = result.warnings.find((w) =>
    w.code === "UPSKILL_NOT_FOUND"
  );
  assertEquals(upskillWarn !== undefined, true);
});

Deno.test("runInit: upskill missing on Windows (exit 9009 / not recognized) → UPSKILL_NOT_FOUND", async () => {
  // cmd.exe returns exit code 9009 with stderr containing 'is not
  // recognized as an internal or external command' when the binary
  // is not on PATH. Neither matches the POSIX `code === 127` /
  // `'not found'` checks, so without this branch Windows users
  // would see the less-helpful UPSKILL_FAILED warning.
  const fs = createMemFs();
  const windowsMissingExec: ExecRunner = () =>
    Promise.resolve({
      code: 9009,
      stdout: "",
      stderr:
        "'upskill' is not recognized as an internal or external command, operable program or batch file.",
    });
  const result = await runInit({
    targetDir: "/repo",
    profileChoice: { kind: "bundled" },
    forcedClients: [],
    allClients: false,
    noMcp: false,
    noSkills: false,
    binaryPathFlag: undefined,
    force: false,
    dryRun: false,
    fs,
    detectEnv: noClientEnv,
    binaryEnv: noClientEnv,
    mcpRunner: okMcpRunner,
    execRunner: windowsMissingExec,
    now: fakeNow,
    version: "0.6.0",
    mcpAdapters: adapters,
  });
  const upskillNotFound = result.warnings.find((w) =>
    w.code === "UPSKILL_NOT_FOUND"
  );
  const upskillFailed = result.warnings.find((w) =>
    w.code === "UPSKILL_FAILED"
  );
  assertEquals(upskillNotFound !== undefined, true);
  assertEquals(upskillFailed, undefined);
});

Deno.test("runInit: non-whitelisted content (src/) → TARGET_NOT_EMPTY error + exit 1", async () => {
  const fs = createMemFs();
  await fs.write("/repo/src/x.txt", "user code");
  const result = await runInit({
    targetDir: "/repo",
    profileChoice: { kind: "bundled" },
    forcedClients: [],
    allClients: false,
    noMcp: false,
    noSkills: true,
    binaryPathFlag: undefined,
    force: false,
    dryRun: false,
    fs,
    detectEnv: noClientEnv,
    binaryEnv: noClientEnv,
    mcpRunner: okMcpRunner,
    execRunner: okExec,
    now: fakeNow,
    version: "0.6.0",
    mcpAdapters: adapters,
  });
  assertEquals(result.ok, false);
  assertEquals(result.exitCode, 1);
  assertEquals(result.error?.code, "TARGET_NOT_EMPTY");
});

Deno.test("runInit: plan outputs are dynamically whitelisted for TARGET_NOT_EMPTY", async () => {
  // The static TARGET_WHITELIST covers only pre-existing project
  // files. Multiple init outputs in the target should still pass
  // the empty-check via the per-run plan-derived whitelist —
  // regression test for finding #6.
  const fs = createMemFs();
  await fs.write("/repo/project.yaml", "user content");
  await fs.write("/repo/markspec.lock", "older lock");
  await fs.write("/repo/.markspec.yaml", "older profile config");
  const result = await runInit({
    targetDir: "/repo",
    profileChoice: { kind: "bundled" },
    forcedClients: [],
    allClients: false,
    noMcp: false,
    noSkills: true,
    binaryPathFlag: undefined,
    force: false,
    dryRun: false,
    fs,
    detectEnv: noClientEnv,
    binaryEnv: noClientEnv,
    mcpRunner: okMcpRunner,
    execRunner: okExec,
    now: fakeNow,
    version: "0.6.0",
    mcpAdapters: adapters,
  });
  assertEquals(result.ok, true);
  assertEquals(result.error, undefined);
});

Deno.test("runInit: existing project.yaml only → skip + exit 2 (whitelisted output)", async () => {
  const fs = createMemFs();
  await fs.write("/repo/project.yaml", "user content");
  const result = await runInit({
    targetDir: "/repo",
    profileChoice: { kind: "bundled" },
    forcedClients: [],
    allClients: false,
    noMcp: false,
    noSkills: true,
    binaryPathFlag: undefined,
    force: false,
    dryRun: false,
    fs,
    detectEnv: noClientEnv,
    binaryEnv: noClientEnv,
    mcpRunner: okMcpRunner,
    execRunner: okExec,
    now: fakeNow,
    version: "0.6.0",
    mcpAdapters: adapters,
  });
  assertEquals(result.exitCode, 2);
  const skip = result.actions.find((a) => a.file === "project.yaml");
  assertEquals(skip?.kind, "skip");
});

Deno.test("runInit: mcpRunner failure → MCP_INSTALL_FAILED warning + exit 2", async () => {
  const fs = createMemFs();
  const failingMcp: McpRunner = () =>
    Promise.resolve({ stdout: "", stderr: "boom", exitCode: 1 });
  const result = await runInit({
    targetDir: "/repo",
    profileChoice: { kind: "bundled" },
    forcedClients: ["claude-code"],
    allClients: false,
    noMcp: false,
    noSkills: true,
    binaryPathFlag: undefined,
    force: false,
    dryRun: false,
    fs,
    detectEnv: noClientEnv,
    binaryEnv: noClientEnv,
    mcpRunner: failingMcp,
    execRunner: okExec,
    now: fakeNow,
    version: "0.6.0",
    mcpAdapters: adapters,
  });
  assertEquals(result.exitCode, 2);
  const warn = result.warnings.find((w) => w.code === "MCP_INSTALL_FAILED");
  assertEquals(warn !== undefined, true);
  assertEquals(warn!.message.includes("claude-code"), true);
  // The failed write must not appear in actions — otherwise the
  // summary advertises a config that was never written.
  const mcpAction = result.actions.find((a) => a.file === ".mcp.json");
  assertEquals(mcpAction, undefined);
});
