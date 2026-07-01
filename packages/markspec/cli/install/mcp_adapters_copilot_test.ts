import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { copilotDescriptor } from "./mcp_adapters_copilot.ts";

Deno.test("copilotDescriptor: id and jsonPath", () => {
  assertEquals(copilotDescriptor.id, "copilot");
  assertEquals(copilotDescriptor.jsonPath, ["mcpServers", "markspec"]);
});

Deno.test("copilotDescriptor: workspace scope → <root>/.github/mcp.json", () => {
  const path = copilotDescriptor.resolveConfigPath(
    "workspace",
    "/tmp/cwd",
    "/home/u",
    undefined,
    "/tmp/repo",
  );
  assertEquals(path, join("/tmp/repo", ".github", "mcp.json"));
});

Deno.test("copilotDescriptor: workspace scope falls back to cwd when no workspaceRoot", () => {
  const path = copilotDescriptor.resolveConfigPath(
    "workspace",
    "/tmp/cwd",
    "/home/u",
    undefined,
    undefined,
  );
  assertEquals(path, join("/tmp/cwd", ".github", "mcp.json"));
});

Deno.test("copilotDescriptor: user scope → ~/.copilot/mcp-config.json", () => {
  const path = copilotDescriptor.resolveConfigPath(
    "user",
    "/tmp/cwd",
    "/home/u",
    undefined,
    "/tmp/repo",
  );
  assertEquals(path, join("/home/u", ".copilot", "mcp-config.json"));
});

Deno.test("copilotDescriptor: renderBlock is Copilot local schema with type + tools", () => {
  const block = copilotDescriptor.renderBlock({ binaryPath: "markspec" });
  assertEquals(block, {
    type: "local",
    command: "markspec",
    args: ["mcp"],
    tools: ["*"],
  });
});

Deno.test("copilotDescriptor: renderBlock honors an explicit binary path", () => {
  const block = copilotDescriptor.renderBlock({
    binaryPath: "/opt/markspec/bin/markspec",
  });
  assertEquals(block, {
    type: "local",
    command: "/opt/markspec/bin/markspec",
    args: ["mcp"],
    tools: ["*"],
  });
});
