/**
 * @module tests/e2e/display_id_trace_lock_test
 *
 * E2E tests for the edge ULID ledger written by `markspec lock`.
 * Verifies that trace relations between stamped entries are recorded
 * as `[[edge]]` blocks in markspec.lock, with ULIDs resolved from
 * the workspace index.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT_YAML = `name: lock-edge-e2e\nversion: 0.1.0\n`;

// Each Id is a 26-char Crockford-base32 string. Source Satisfies target by DISPLAY ID.
const SYS = `# System

- [SYS_0001] Target requirement

  Body text.

      Id: 01SYS000000000000000000001
`;
const SWE = `# Software

- [SWE_0001] Source requirement

  Body text.

      Id: 01SWE000000000000000000001
      Satisfies: SYS_0001
`;
const FILES = { "project.yaml": PROJECT_YAML, "sys.md": SYS, "swe.md": SWE };

Deno.test(
  "lock: persists target ULID per edge; never edits source; --check round-trips",
  async () => {
    const run = await markspecPersist(["lock"], {
      files: FILES,
      permissions: ["--allow-env", "--allow-run"],
    });
    try {
      assertEquals(run.code, 0, run.stderr);
      const lock = await Deno.readTextFile(join(run.dir, "markspec.lock"));
      assertStringIncludes(lock, "[[edge]]");
      assertStringIncludes(
        lock,
        'source-ulid     = "01SWE000000000000000000001"',
      );
      assertStringIncludes(lock, 'relation        = "Satisfies"');
      assertStringIncludes(
        lock,
        'target-ulid     = "01SYS000000000000000000001"',
      );
      assertStringIncludes(lock, 'authored-target = "SYS_0001"');
      // lock never edits source files.
      assertEquals(await Deno.readTextFile(join(run.dir, "swe.md")), SWE);
      assertEquals(await Deno.readTextFile(join(run.dir, "sys.md")), SYS);
      // --check immediately after lock → no drift (exit 0).
      const check = await markspecInDir(
        run.dir,
        ["lock", "--check"],
        ["--allow-env", "--allow-run"],
      );
      assertEquals(check.code, 0, check.stderr);
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  },
);

Deno.test(
  "lock: unresolved trace target omits target-ulid in the ledger",
  async () => {
    const SWE_DANGLING = `# Software

- [SWE_0002] Source with dangling ref

  Body text.

      Id: 01SWE000000000000000000002
      Satisfies: SYS_GONE_0001
`;
    const run = await markspecPersist(["lock"], {
      files: {
        "project.yaml": PROJECT_YAML,
        "swe.md": SWE_DANGLING,
      },
      permissions: ["--allow-env", "--allow-run"],
    });
    try {
      assertEquals(run.code, 0, run.stderr);
      const lock = await Deno.readTextFile(join(run.dir, "markspec.lock"));
      assertStringIncludes(lock, 'authored-target = "SYS_GONE_0001"');
      // target-ulid must NOT appear in the edge block for a dangling ref.
      const idx = lock.indexOf('authored-target = "SYS_GONE_0001"');
      const block = lock.slice(Math.max(0, idx - 200), idx);
      assertEquals(block.includes("target-ulid"), false);
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  },
);
