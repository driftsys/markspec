import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  claudeDesktopDescriptor,
  cursorAdapter,
  vscodeMcpAdapter,
  type VscodeMcpAdapterEnv,
} from "./mcp_adapters.ts";

// Normalise path separators so assertions are portable across POSIX and Windows.
function normalizePath(p: string): string {
  return p.replaceAll("\\", "/");
}

Deno.test("claudeDesktopDescriptor: id is claude-desktop", () => {
  assertEquals(claudeDesktopDescriptor.id, "claude-desktop");
});

Deno.test("claudeDesktopDescriptor: renderBlock returns command + args", () => {
  const block = claudeDesktopDescriptor.renderBlock({ binaryPath: "markspec" });
  assertEquals(block, { command: "markspec", args: ["mcp"] });
});

Deno.test("claudeDesktopDescriptor: renderBlock with absolute path", () => {
  const block = claudeDesktopDescriptor.renderBlock({
    binaryPath: "/opt/markspec/markspec",
  });
  assertEquals(block, { command: "/opt/markspec/markspec", args: ["mcp"] });
});

// resolveConfigPath calls into Deno.build.os, which we can't override at
// runtime without restructuring. Test the host platform; the other
// platforms are exercised via e2e tests with explicit HOME injection.
Deno.test("claudeDesktopDescriptor: user-scope path is host-platform-correct", () => {
  const path = claudeDesktopDescriptor.resolveConfigPath(
    "user",
    "/cwd",
    "/home/test",
    "/appdata",
  );
  const normalised = normalizePath(path);
  assertStringIncludes(normalised, "claude_desktop_config.json");
  assertStringIncludes(normalised, "/Claude/");
});

Deno.test("claudeDesktopDescriptor: workspace scope throws", () => {
  let threw = false;
  try {
    claudeDesktopDescriptor.resolveConfigPath("workspace", "/cwd", "/home", "");
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("cursorAdapter: stdout contains mcpServers; stderr mentions mcp.json", () => {
  const r = cursorAdapter();
  assertStringIncludes(r.stdout, "mcpServers");
  assertStringIncludes(r.stderr, "mcp.json");
  assertEquals(r.exitCode, 0);
});

const MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=driftsys.markspec-ide";
const EXTENSION_ID = "driftsys.markspec-ide";

function fakeMcpEnv(
  overrides: Partial<VscodeMcpAdapterEnv> = {},
): VscodeMcpAdapterEnv {
  return {
    listExtensions: () => Promise.resolve([]),
    ...overrides,
  };
}

Deno.test("vscodeMcpAdapter: extension not installed → marketplace URL, no `code --install-extension`", async () => {
  const r = await vscodeMcpAdapter({
    env: fakeMcpEnv({ listExtensions: () => Promise.resolve(["other.ext"]) }),
  });
  assertEquals(r.exitCode, 0);
  assertStringIncludes(r.stderr, MARKETPLACE_URL);
  assertEquals(
    r.stderr.includes("code --install-extension"),
    false,
    "stderr must not suggest `code --install-extension` (parity with spec §8 Q5)",
  );
});

Deno.test("vscodeMcpAdapter: `code` CLI absent → marketplace URL, no `code --install-extension`", async () => {
  const r = await vscodeMcpAdapter({
    env: fakeMcpEnv({ listExtensions: () => Promise.resolve(undefined) }),
  });
  assertEquals(r.exitCode, 0);
  assertStringIncludes(r.stderr, MARKETPLACE_URL);
  assertEquals(r.stderr.includes("code --install-extension"), false);
});

Deno.test("vscodeMcpAdapter: extension installed → success, mentions provider API", async () => {
  const r = await vscodeMcpAdapter({
    env: fakeMcpEnv({ listExtensions: () => Promise.resolve([EXTENSION_ID]) }),
  });
  assertEquals(r.exitCode, 0);
  assertStringIncludes(r.stderr, EXTENSION_ID);
  assertStringIncludes(r.stderr, "registerMcpServerDefinitionProvider");
  assertEquals(r.stderr.includes("code --install-extension"), false);
});
