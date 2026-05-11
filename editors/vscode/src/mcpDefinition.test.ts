import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as path from "node:path";
import { resolveMcpDefinition } from "./mcpDefinition";

const EXT_PATH = "/fake/extensions/driftsys.markspec-ide-0.5.0";
const WORKSPACE = "/fake/workspace/markspec";
const VERSION = "0.5.0";

function base() {
  return {
    extensionPath: EXT_PATH,
    workspaceFolder: WORKSPACE,
    enabled: true,
    configuredServerPath: undefined,
    configuredMcpArgs: undefined,
    platform: "linux" as NodeJS.Platform,
    extensionVersion: VERSION,
  };
}

test("resolveMcpDefinition: bundled binary by default (linux)", () => {
  const def = resolveMcpDefinition(base());
  assert.ok(def, "expected a definition");
  assert.equal(def!.command, path.join(EXT_PATH, "bin", "markspec"));
  assert.deepEqual(def!.args, ["mcp"]);
  assert.equal(def!.cwd, WORKSPACE);
  assert.equal(def!.label, "MarkSpec");
  assert.equal(def!.version, VERSION);
});

test("resolveMcpDefinition: bundled binary uses .exe on win32", () => {
  const def = resolveMcpDefinition({ ...base(), platform: "win32" });
  assert.ok(def);
  assert.equal(def!.command, path.join(EXT_PATH, "bin", "markspec.exe"));
});

test("resolveMcpDefinition: configured path overrides bundled binary", () => {
  const def = resolveMcpDefinition({
    ...base(),
    configuredServerPath: "/usr/local/bin/markspec",
  });
  assert.ok(def);
  assert.equal(def!.command, "/usr/local/bin/markspec");
  assert.deepEqual(def!.args, ["mcp"]);
});

test("resolveMcpDefinition: dev-mode deno path with custom mcp args", () => {
  const def = resolveMcpDefinition({
    ...base(),
    configuredServerPath: "deno",
    configuredMcpArgs: [
      "run",
      "--allow-read",
      "${workspaceFolder}/packages/markspec/main.ts",
      "mcp",
    ],
  });
  assert.ok(def);
  assert.equal(def!.command, "deno");
  assert.deepEqual(def!.args, [
    "run",
    "--allow-read",
    `${WORKSPACE}/packages/markspec/main.ts`,
    "mcp",
  ]);
});

test("resolveMcpDefinition: custom args work with bundled binary too", () => {
  const def = resolveMcpDefinition({
    ...base(),
    configuredMcpArgs: ["mcp", "--verbose"],
  });
  assert.ok(def);
  assert.equal(def!.command, path.join(EXT_PATH, "bin", "markspec"));
  assert.deepEqual(def!.args, ["mcp", "--verbose"]);
});

test("resolveMcpDefinition: ${workspaceFolder} is expanded in args", () => {
  const def = resolveMcpDefinition({
    ...base(),
    configuredServerPath: "deno",
    configuredMcpArgs: ["run", "${workspaceFolder}/main.ts", "mcp"],
  });
  assert.ok(def);
  assert.deepEqual(def!.args, ["run", `${WORKSPACE}/main.ts`, "mcp"]);
});

test("resolveMcpDefinition: returns undefined when disabled", () => {
  const def = resolveMcpDefinition({ ...base(), enabled: false });
  assert.equal(def, undefined);
});

test("resolveMcpDefinition: disabled wins over configured path", () => {
  const def = resolveMcpDefinition({
    ...base(),
    enabled: false,
    configuredServerPath: "/usr/local/bin/markspec",
    configuredMcpArgs: ["mcp"],
  });
  assert.equal(def, undefined);
});

test("resolveMcpDefinition: configured path with empty args defaults to ['mcp']", () => {
  const def = resolveMcpDefinition({
    ...base(),
    configuredServerPath: "/usr/local/bin/markspec",
    configuredMcpArgs: undefined,
  });
  assert.ok(def);
  assert.deepEqual(def!.args, ["mcp"]);
});

test("resolveMcpDefinition: workspaceFolder undefined leaves variables untouched", () => {
  const def = resolveMcpDefinition({
    ...base(),
    workspaceFolder: undefined,
    configuredServerPath: "deno",
    configuredMcpArgs: ["run", "${workspaceFolder}/main.ts", "mcp"],
  });
  assert.ok(def);
  assert.equal(def!.cwd, undefined);
  assert.deepEqual(def!.args, ["run", "${workspaceFolder}/main.ts", "mcp"]);
});
