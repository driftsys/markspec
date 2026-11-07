/**
 * @module tests/e2e/collect_unreadable_test
 *
 * Project collection must fail when a discovered file cannot be read.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

const skipDeniedRead = Deno.build.os === "windows" ||
  new TextDecoder().decode(
      new Deno.Command("id", { args: ["-u"], stdout: "piped" }).outputSync()
        .stdout,
    ).trim() === "0";

for (
  const args of [
    ["lock"],
    ["lock", "--check"],
    ["compile", "--frozen", "req.md"],
    ["fmt", "req.md"],
    ["fmt", "--check", "req.md"],
    ["doctor"],
  ]
) {
  Deno.test({
    name: `${args.join(" ")}: rejects an unreadable discovered file`,
    ignore: skipDeniedRead,
    fn: async () => {
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
        assertEquals(result.stderr.includes("Uncaught"), false, result.stderr);
        assertEquals(result.stderr.includes("    at "), false, result.stderr);
        assertEquals(result.stderr.trim().split("\n").length, 1, result.stderr);
        assertEquals(result.stdout, "");
        assertEquals(await Deno.readTextFile(lockPath), lockBefore);
        assertEquals(await Deno.readTextFile(join(run.dir, "req.md")), source);
      } finally {
        await Deno.remove(run.dir, { recursive: true });
      }
    },
  });
}
