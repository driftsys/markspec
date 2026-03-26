import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

Deno.test("validate in nested dir finds project.yaml two levels up", async () => {
  const { code, stderr } = await markspec(["validate"], {
    files: {
      "project.yaml": "name: test-project\n",
      "a/b/req.md": "# Reqs\n",
    },
    cwd: "a/b",
  });
  // validate is still "not yet implemented" but it should find the config
  // and NOT print "no project.yaml found"
  assertEquals(stderr.includes("no project.yaml found"), false);
  // It will print "not yet implemented" since the command logic is stubbed
  assertStringIncludes(stderr, "not yet implemented");
  assertEquals(code, 1);
});

Deno.test("format outside project works with defaults", async () => {
  const { code, stderr } = await markspec(["format"], {
    files: {
      "req.md": "# Test\n",
    },
    // No project.yaml — format should work anyway
  });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "0 files formatted");
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

Deno.test("invalid project.yaml produces actionable error", async () => {
  const { code, stderr } = await markspec(["validate"], {
    files: {
      "project.yaml": "domain: bad\n",
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "invalid project.yaml");
  assertStringIncludes(stderr, "name");
});
