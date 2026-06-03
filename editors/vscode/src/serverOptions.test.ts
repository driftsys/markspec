import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as path from "node:path";
import * as fs from "node:fs";
import { expandVariables, resolveServerOptions } from "./serverOptions";

const EXT_PATH = "/fake/extensions/driftsys.markspec-ide-0.0.1";
const WORKSPACE = "/fake/workspace/markspec";

// Regression guard for #588 — the LSP failed to start on a fresh
// marketplace install with `spawn markspec ENOENT`. Root cause: the
// shipped `markspec.server.path` default was the bare command
// "markspec", which `config.get("server.path") || undefined` in
// extension.ts can never reduce to `undefined`, so the bundled-binary
// fallback was dead code and a bare PATH command was always spawned.
// The fix is the policy "bundled-first": an UNSET server.path must
// resolve to the bundled binary, never PATH. These tests pin that
// policy at the package.json boundary, which the pure-function tests
// above do not cover.
test("resolveServerOptions: shipped server.path default resolves to bundled binary (#588)", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );
  const shippedDefault: unknown = pkg.contributes.configuration
    .properties["markspec.server.path"].default;
  // Mirror extension.ts: `config.get<string>("server.path") || undefined`.
  const configuredServerPath = (shippedDefault as string) || undefined;
  const opts = resolveServerOptions({
    extensionPath: EXT_PATH,
    workspaceFolder: WORKSPACE,
    configuredServerPath,
    configuredServerArgs: undefined,
    logPath: undefined,
    platform: "linux",
  }) as { command: string; args: string[] };
  assert.equal(
    opts.command,
    path.join(EXT_PATH, "bin", "markspec"),
    "unset server.path must spawn the bundled binary, not a bare PATH command",
  );
  assert.notEqual(
    opts.command,
    "markspec",
    "a bare `markspec` command is the #588 ENOENT regression",
  );
});

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
