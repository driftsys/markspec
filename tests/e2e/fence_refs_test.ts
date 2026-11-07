/** CLI regression for trace healing inside nested fences (#705). */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

Deno.test("fmt: heals live references and preserves nested fenced examples", async () => {
  const target = [
    "- [SYS_OLD] Target",
    "",
    "  Body.",
    "",
    "      Id: 01SYS000000000000000000001",
    "",
  ].join("\n");
  const example = [
    "````markdown",
    "```text",
    "      Satisfies: SYS_OLD",
    "```",
    "````",
  ].join("\n");
  const source = [
    "- [SWE_0001] Source",
    "",
    "  Body.",
    "",
    "      Id: 01SWE000000000000000000001",
    "      Satisfies: SYS_OLD",
    "",
    example,
    "",
  ].join("\n");
  const permissions = ["--allow-env", "--allow-run"];
  const run = await markspecPersist(["lock"], {
    files: {
      "project.yaml": "name: fence-refs-e2e\nversion: 0.1.0\n",
      "sys.md": target,
      "swe.md": source,
    },
    permissions,
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    assertStringIncludes(
      await Deno.readTextFile(join(run.dir, "markspec.lock")),
      'authored-target = "SYS_OLD"',
    );
    await Deno.writeTextFile(
      join(run.dir, "sys.md"),
      target.replace("[SYS_OLD]", "[SYS_NEW]"),
    );
    const fmt = await markspecInDir(
      run.dir,
      ["fmt", "swe.md", "sys.md"],
      permissions,
    );
    assertEquals(fmt.code, 0, fmt.stderr);
    const output = await Deno.readTextFile(join(run.dir, "swe.md"));
    assertStringIncludes(output, "      Satisfies: SYS_NEW\n");
    assertStringIncludes(output, example);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});
