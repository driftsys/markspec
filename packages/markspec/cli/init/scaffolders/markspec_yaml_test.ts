import { assertEquals, assertStringIncludes } from "@std/assert";
import { createMemFs } from "../fake_fs.ts";
import { buildMarkspecYaml, scaffoldMarkspecYaml } from "./markspec_yaml.ts";

Deno.test("buildMarkspecYaml: bundled writes the header comment + nothing else", () => {
  const out = buildMarkspecYaml({ kind: "bundled" });
  assertStringIncludes(
    out,
    "Profile chain — bundled default active implicitly",
  );
  assertStringIncludes(out, "https://markspec.dev/profiles/");
  assertEquals(out.includes("profiles:"), false);
  assertEquals(out.includes("default-profile:"), false);
});

Deno.test("buildMarkspecYaml: git URL writes profiles array", () => {
  const out = buildMarkspecYaml({
    kind: "git",
    spec: "git+https://github.com/org/p.git",
  });
  assertStringIncludes(out, "profiles:");
  assertStringIncludes(out, "  - git+https://github.com/org/p.git");
});

Deno.test("buildMarkspecYaml: local path writes profiles array", () => {
  const out = buildMarkspecYaml({ kind: "local", spec: "./profiles/aspice" });
  assertStringIncludes(out, "profiles:");
  assertStringIncludes(out, "  - ./profiles/aspice");
});

Deno.test("buildMarkspecYaml: core-only writes default-profile: false", () => {
  const out = buildMarkspecYaml({ kind: "none" });
  assertStringIncludes(out, "default-profile: false");
});

Deno.test("scaffoldMarkspecYaml: writes when absent", async () => {
  const fs = createMemFs();
  const wrote = await scaffoldMarkspecYaml(fs, "/r", { kind: "bundled" });
  assertEquals(wrote, true);
  const out = await fs.read("/r/.markspec.yaml");
  assertEquals(out !== undefined, true);
});

Deno.test("scaffoldMarkspecYaml: skips when present", async () => {
  const fs = createMemFs();
  await fs.write("/r/.markspec.yaml", "existing");
  const wrote = await scaffoldMarkspecYaml(fs, "/r", { kind: "bundled" });
  assertEquals(wrote, false);
  assertEquals(await fs.read("/r/.markspec.yaml"), "existing");
});

Deno.test("buildMarkspecYaml: every branch emits the $schema key", () => {
  const url =
    "$schema: https://driftsys.github.io/markspec/schemas/markspec/v1.json";
  for (
    const choice of [
      { kind: "bundled" } as const,
      { kind: "git", spec: "github:org/repo@1.0.0" } as const,
      { kind: "local", spec: "./profiles/base" } as const,
      { kind: "none" } as const,
    ]
  ) {
    const out = buildMarkspecYaml(choice);
    assertStringIncludes(out, url);
  }
});
