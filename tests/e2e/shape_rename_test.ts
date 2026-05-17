import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT = {
  "project.yaml": "name: shape-rename-acceptance\nversion: 0.0.0\n",
  "reqs.md": `- [REQ-1] Authored entry

  The system shall do the thing.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [@ISO-9001] Cited standard

      Id: urn:iso:std:iso:9001
`,
};

Deno.test("compile --format json reports Authored/Reference shapes", async () => {
  const { code, stdout } = await markspec(
    ["compile", "--format", "json", "reqs.md"],
    PROJECT,
  );
  assertEquals(code, 0);
  const out = JSON.parse(stdout) as {
    entries: Record<string, { shape: string }>;
  };
  const shapes = Object.values(out.entries).map((e) => e.shape).sort();
  assertEquals(shapes, ["Authored", "Reference"]);
});

Deno.test("show text output prints the Authored shape", async () => {
  const { stdout } = await markspec(
    ["show", "REQ-1", "reqs.md"],
    PROJECT,
  );
  assertStringIncludes(stdout, "Shape: Authored");
});
