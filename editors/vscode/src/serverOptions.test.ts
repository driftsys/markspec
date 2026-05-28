import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as path from "node:path";
import { expandVariables, resolveServerOptions } from "./serverOptions";

const EXT_PATH = "/fake/extensions/driftsys.markspec-ide-0.0.1";
const WORKSPACE = "/fake/workspace/markspec";

test("resolveServerOptions: bundled binary by default (linux)", () => {
  const opts = resolveServerOptions({
    extensionPath: EXT_PATH,
    workspaceFolder: WORKSPACE,
    configuredServerPath: undefined,
    configuredServerArgs: undefined,
    logPath: undefined,
    platform: "linux",
  }) as { command: string; args: string[] };
  assert.equal(opts.command, path.join(EXT_PATH, "bin", "markspec"));
  assert.deepEqual(opts.args, ["lsp"]);
});

test("resolveServerOptions: bundled binary uses .exe on win32", () => {
  const opts = resolveServerOptions({
    extensionPath: EXT_PATH,
    workspaceFolder: WORKSPACE,
    configuredServerPath: undefined,
    configuredServerArgs: undefined,
    logPath: undefined,
    platform: "win32",
  }) as { command: string };
  assert.equal(opts.command, path.join(EXT_PATH, "bin", "markspec.exe"));
});

test("resolveServerOptions: configured path overrides bundled binary", () => {
  const opts = resolveServerOptions({
    extensionPath: EXT_PATH,
    workspaceFolder: WORKSPACE,
    configuredServerPath: "deno",
    configuredServerArgs: ["run", "--allow-read", "main.ts", "lsp"],
    logPath: undefined,
    platform: "linux",
  }) as { command: string; args: string[] };
  assert.equal(opts.command, "deno");
  assert.deepEqual(opts.args, ["run", "--allow-read", "main.ts", "lsp"]);
});

test("resolveServerOptions: ${workspaceFolder} is expanded in args", () => {
  const opts = resolveServerOptions({
    extensionPath: EXT_PATH,
    workspaceFolder: WORKSPACE,
    configuredServerPath: "deno",
    configuredServerArgs: [
      "run",
      "${workspaceFolder}/packages/markspec/main.ts",
      "lsp",
    ],
    logPath: undefined,
    platform: "linux",
  }) as { args: string[] };
  assert.deepEqual(opts.args, [
    "run",
    `${WORKSPACE}/packages/markspec/main.ts`,
    "lsp",
  ]);
});

test("resolveServerOptions: configured path with empty args defaults to ['lsp']", () => {
  const opts = resolveServerOptions({
    extensionPath: EXT_PATH,
    workspaceFolder: WORKSPACE,
    configuredServerPath: "/usr/local/bin/markspec",
    configuredServerArgs: undefined,
    logPath: undefined,
    platform: "linux",
  }) as { args: string[] };
  assert.deepEqual(opts.args, ["lsp"]);
});

test("resolveServerOptions: logPath sets MARKSPEC_LSP_LOG env", () => {
  // Renamed from markspec.trace.debugLog; now drives MARKSPEC_LSP_LOG
  // (the unified event log) instead of the removed
  // MARKSPEC_LSP_DEBUG_LOG.
  const opts = resolveServerOptions({
    extensionPath: EXT_PATH,
    workspaceFolder: WORKSPACE,
    configuredServerPath: undefined,
    configuredServerArgs: undefined,
    logPath: "/tmp/markspec-lsp.log",
    platform: "linux",
  }) as { options: { env: Record<string, string | undefined> } };
  assert.equal(
    opts.options.env.MARKSPEC_LSP_LOG,
    "/tmp/markspec-lsp.log",
  );
});

test("resolveServerOptions: ${workspaceFolder} is expanded in logPath", () => {
  const opts = resolveServerOptions({
    extensionPath: EXT_PATH,
    workspaceFolder: WORKSPACE,
    configuredServerPath: undefined,
    configuredServerArgs: undefined,
    logPath: "${workspaceFolder}/.markspec-lsp.log",
    platform: "linux",
  }) as { options: { env: Record<string, string | undefined> } };
  assert.equal(
    opts.options.env.MARKSPEC_LSP_LOG,
    `${WORKSPACE}/.markspec-lsp.log`,
  );
});

test("expandVariables: leaves args untouched when workspaceFolder is undefined", () => {
  const result = expandVariables(
    ["${workspaceFolder}/main.ts"],
    undefined,
  );
  assert.deepEqual(result, ["${workspaceFolder}/main.ts"]);
});

test("expandVariables: expands multiple occurrences in one arg", () => {
  const result = expandVariables(
    ["${workspaceFolder}/a:${workspaceFolder}/b"],
    "/ws",
  );
  assert.deepEqual(result, ["/ws/a:/ws/b"]);
});
