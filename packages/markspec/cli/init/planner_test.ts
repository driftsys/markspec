import { assertEquals } from "@std/assert";
import { createMemFs } from "./fake_fs.ts";
import { computeWritePlan, type PlanInputs } from "./planner.ts";
import { claudeCodeDescriptor } from "../install/mcp_adapters_claude_code.ts";
import { opencodeDescriptor } from "../install/mcp_adapters_opencode.ts";

const adapters = new Map([
  ["claude" as const, claudeCodeDescriptor],
  ["opencode" as const, opencodeDescriptor],
]);

const baseInputs = (overrides: Partial<PlanInputs> = {}): PlanInputs => ({
  targetDir: "/r",
  fs: createMemFs(),
  profileChoice: { kind: "bundled" },
  clientSet: { write: new Set() },
  force: false,
  mcpAdapters: adapters,
  ...overrides,
});

Deno.test("planner: empty target → 4 creates (no MCP, no clients)", async () => {
  const plan = await computeWritePlan(baseInputs());
  const kinds = plan.actions.map((a) => `${a.kind}:${a.file}`).sort();
  assertEquals(kinds.length, 4);
  assertEquals(plan.actions.every((a) => a.kind === "create"), true);
});

Deno.test("planner: existing project.yaml → skip", async () => {
  const fs = createMemFs();
  await fs.write("/r/project.yaml", "user content");
  const plan = await computeWritePlan(baseInputs({ fs }));
  const projectYamlAction = plan.actions.find((a) => a.file === "project.yaml");
  assertEquals(projectYamlAction?.kind, "skip");
});

Deno.test("planner: existing project.yaml + --force → overwrite", async () => {
  const fs = createMemFs();
  await fs.write("/r/project.yaml", "user");
  const plan = await computeWritePlan(baseInputs({ fs, force: true }));
  const action = plan.actions.find((a) => a.file === "project.yaml");
  assertEquals(action?.kind, "overwrite");
});

Deno.test("planner: clients in set → one action per client", async () => {
  const plan = await computeWritePlan(baseInputs({
    clientSet: { write: new Set(["claude", "opencode"]) },
  }));
  const mcpActions = plan.actions.filter((a) =>
    a.file === ".mcp.json" || a.file === "opencode.json"
  );
  assertEquals(mcpActions.length, 2);
  assertEquals(mcpActions.every((a) => a.kind === "create"), true);
});

Deno.test("planner: existing .vscode/extensions.json with our id → no-op", async () => {
  const fs = createMemFs();
  await fs.write(
    "/r/.vscode/extensions.json",
    JSON.stringify({ recommendations: ["driftsys.markspec-ide"] }, null, 2),
  );
  const plan = await computeWritePlan(baseInputs({ fs }));
  const action = plan.actions.find((a) => a.file === ".vscode/extensions.json");
  assertEquals(action?.kind, "no-op");
});

Deno.test("planner: existing .vscode/extensions.json without our id → merge", async () => {
  const fs = createMemFs();
  await fs.write(
    "/r/.vscode/extensions.json",
    JSON.stringify({ recommendations: ["other.ext"] }, null, 2),
  );
  const plan = await computeWritePlan(baseInputs({ fs }));
  const action = plan.actions.find((a) => a.file === ".vscode/extensions.json");
  assertEquals(action?.kind, "merge");
});

Deno.test("planner: MCP filename comes from adapter.resolveConfigPath (no hardcoded mapping)", async () => {
  // Wire a stub adapter that uses a non-default filename. The planner
  // must surface it verbatim; if it ever reverts to a hardcoded
  // client → filename map this test fails.
  const stubAdapter = {
    id: "claude" as const,
    jsonPath: ["mcpServers", "markspec"] as const,
    resolveConfigPath: () => "/r/.stub-mcp.json",
    renderBlock: () => ({}),
  };
  const stubAdapters = new Map([["claude" as const, stubAdapter]]);
  const plan = await computeWritePlan(baseInputs({
    clientSet: { write: new Set(["claude"]) },
    mcpAdapters: stubAdapters,
  }));
  const stubAction = plan.actions.find((a) => a.file === ".stub-mcp.json");
  assertEquals(stubAction?.kind, "create");
});
