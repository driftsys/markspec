/**
 * @module tests/e2e/lock_test
 *
 * E2E tests for `markspec lock`: basic lockfile write and MSL-L010 emission.
 *
 * These tests exercise the blackbox CLI surface only — no imports from
 * source modules. All interaction is through the `markspec()` helper.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = "name: test\nversion: '0.0.0'\n";

Deno.test("lock: empty project produces minimal lockfile", async () => {
  const { code, stderr } = await markspec(["lock"], {
    "project.yaml": PROJECT_YAML,
    "reqs.md": "# Requirements\n",
  });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "wrote markspec.lock");
});

Deno.test("lock: two runs on the same input both succeed", async () => {
  const files = {
    "project.yaml": PROJECT_YAML,
    "reqs.md":
      `# Reqs\n\n- [REQ-001] Test\n\n      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n`,
  };
  const first = await markspec(["lock"], files);
  assertEquals(first.code, 0);
  const second = await markspec(["lock"], files);
  assertEquals(second.code, 0);
});

Deno.test("lock: --format json emits structured output to stdout", async () => {
  const { code, stdout } = await markspec(["lock", "--format", "json"], {
    "project.yaml": PROJECT_YAML,
    "reqs.md": "# x\n",
  });
  assertEquals(code, 0);
  const parsed = JSON.parse(stdout);
  assertEquals(parsed.command, "lock");
  assertEquals(parsed.wrote, true);
});

Deno.test("lock: Reference without Reference-url emits MSL-L010 info", async () => {
  const { code, stderr } = await markspec(["lock"], {
    "project.yaml": PROJECT_YAML,
    "reqs.md":
      `# Refs\n\n- [serde] Rust serialization\n\n      Id: pkg:cargo/serde@1.0.0\n`,
  });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "MSL-L010");
});
