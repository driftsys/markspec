/**
 * @module tests/e2e/collect_unreadable_test
 *
 * Project collection must fail when a discovered file cannot be read.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

for (
  const args of [
    ["lock"],
    ["compile", "--frozen", "req.md"],
    ["fmt", "req.md"],
    ["doctor"],
  ]
) {
  Deno.test(`${args[0]}: rejects an unreadable discovered file`, async () => {
    const source = "# Requirements\n";
    const run = await markspecPersist(["lock"], {
      "project.yaml": "name: unreadable-test\nversion: 0.1.0\n",
      ".markspec.yaml": "profiles: []\ndefault-profile: false\n",
      "req.md": source,
      "unreadable.md": "# Other requirements\n",
    });
    try {
      assertEquals(run.code, 0, run.stderr);
      const lockPath = join(run.dir, "markspec.lock");
      const lockBefore = await Deno.readTextFile(lockPath);
      const unreadablePath = await Deno.realPath(
        join(run.dir, "unreadable.md"),
      );
      // Directory listing remains allowed, but reading this file is denied.
      const result = await markspecInDir(run.dir, args, [
        `--deny-read=${unreadablePath}`,
      ]);

      assertEquals(result.code, 1, result.stderr);
      assertStringIncludes(result.stderr, unreadablePath);
      assertEquals(await Deno.readTextFile(lockPath), lockBefore);
      assertEquals(await Deno.readTextFile(join(run.dir, "req.md")), source);
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  });
}
