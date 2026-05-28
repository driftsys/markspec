import { assertEquals, assertStringIncludes } from "@std/assert";
import { createMemFs } from "../fake_fs.ts";
import { buildProjectYaml, scaffoldProjectYaml } from "./project_yaml.ts";

Deno.test("buildProjectYaml: stamps name from dirname", () => {
  const out = buildProjectYaml({ dirname: "my-project" });
  assertStringIncludes(out, 'name: "my-project"');
});

Deno.test("buildProjectYaml: stamps the schema URL and 0.1.0 version", () => {
  const out = buildProjectYaml({ dirname: "p" });
  assertStringIncludes(out, "$schema:");
  assertStringIncludes(out, 'version: "0.1.0"');
  assertStringIncludes(out, 'description: ""');
});

Deno.test("buildProjectYaml: sanitises a dirname with non-word chars", () => {
  const out = buildProjectYaml({ dirname: "../foo bar.tmp" });
  assertStringIncludes(out, 'name: "foo-bar-tmp"');
});

Deno.test("buildProjectYaml: falls back to 'project' when dirname sanitises to empty", () => {
  const out = buildProjectYaml({ dirname: "..." });
  assertStringIncludes(out, 'name: "project"');
});

Deno.test("scaffoldProjectYaml: writes the file when absent", async () => {
  const fs = createMemFs();
  await scaffoldProjectYaml(fs, "/repo", "repo");
  const written = await fs.read("/repo/project.yaml");
  assertEquals(written !== undefined, true);
  assertStringIncludes(written!, 'name: "repo"');
});

Deno.test("scaffoldProjectYaml: leaves existing file untouched", async () => {
  const fs = createMemFs();
  await fs.write("/repo/project.yaml", "user content");
  await scaffoldProjectYaml(fs, "/repo", "repo");
  assertEquals(await fs.read("/repo/project.yaml"), "user content");
});
