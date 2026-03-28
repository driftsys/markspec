import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

Deno.test("validate in nested dir finds files", async () => {
  const { code } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": "name: test-project\n",
      "req.md": `# Test

- [SRS_BRK_0001] Title

  Body.

  Id: SRS_01HGW2Q8MNP3
`,
    },
  });
  assertEquals(code, 0);
});

Deno.test("format outside project works with defaults", async () => {
  const { code, stderr } = await markspec(["format", "req.md"], {
    files: {
      "req.md": "# Test\n",
    },
    // No project.yaml — format should work anyway
  });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "0 file(s) formatted");
});

Deno.test("compile without project.yaml produces clear error", async () => {
  const { code, stderr } = await markspec(["compile", "**/*.md"], {
    files: {
      "req.md": "# Test\n",
    },
    // No project.yaml
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no project.yaml found");
});

Deno.test("invalid project.yaml produces actionable error on compile", async () => {
  const { code, stderr } = await markspec(["compile", "**/*.md"], {
    files: {
      "project.yaml": "domain: bad\n",
      "req.md": "# Test\n",
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "invalid project.yaml");
  assertStringIncludes(stderr, "name");
});
