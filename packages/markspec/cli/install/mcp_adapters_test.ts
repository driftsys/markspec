import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  cursorAdapter,
  vscodeMcpAdapter,
  type VscodeMcpAdapterEnv,
} from "./mcp_adapters.ts";

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
