/**
 * @module tests/e2e/display_id_trace_fmt_test
 *
 * E2E tests for project-aware `markspec fmt`:
 *   - canonicalises a ULID trace value → target's current display ID
 *   - heals a stale display-ID reference via the markspec.lock edge ledger
 *   - leaves orphan references untouched
 *   - file-local fmt (no project.yaml) does NOT canonicalise
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspec, markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT_YAML = `name: fmt-canon-e2e\nversion: 0.1.0\n`;

// Each Id is a 26-char Crockford-base32 string (Crockford charset:
// 0-9 A-Z minus I, L, O, U). These fixture ULIDs are synthetic — the
// parser checks the format but does not validate the timestamp prefix.
const SYS = `# System

- [SYS_0001] Target

  Body.

      Id: 01SYS000000000000000000001
`;
// SWE_ULID references the target by its ULID instead of its display ID.
// The pure formatter must be a no-op on this file (indentation is already
// canonical: 6-space trailer), so --check exit 0 in file-local mode proves
// canonicalisation was skipped, not that the pure formatter found nothing.
const SWE_ULID = `# Software

- [SWE_0001] Source

  Body.

      Id: 01SWE000000000000000000001
      Satisfies: 01SYS000000000000000000001
`;

Deno.test(
  "fmt: canonicalises a ULID trace value to the target display ID",
  async () => {
    const run = await markspecPersist(["fmt", "swe.md", "sys.md"], {
      files: {
        "project.yaml": PROJECT_YAML,
        "sys.md": SYS,
        "swe.md": SWE_ULID,
      },
      permissions: ["--allow-env", "--allow-run"],
    });
    try {
      assertEquals(run.code, 0, run.stderr);
      const swe = await Deno.readTextFile(join(run.dir, "swe.md"));
      assertStringIncludes(swe, "Satisfies: SYS_0001");
      assertEquals(
        swe.includes("Satisfies: 01SYS000000000000000000001"),
        false,
      );
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  },
);

Deno.test(
  "fmt --check: exit 1 when a ULID trace value needs canonicalisation",
  async () => {
    const { code } = await markspec(
      ["fmt", "--check", "swe.md", "sys.md"],
      {
        files: {
          "project.yaml": PROJECT_YAML,
          "sys.md": SYS,
          "swe.md": SWE_ULID,
        },
        permissions: ["--allow-env", "--allow-run"],
      },
    );
    assertEquals(code, 1);
  },
);

Deno.test(
  "fmt: heals a renamed-target reference via the lock ledger",
  async () => {
    const sysOld = `# System

- [SYS_OLD] Target

  Body.

      Id: 01SYS000000000000000000001
`;
    const sweOld = `# Software

- [SWE_0001] Source

  Body.

      Id: 01SWE000000000000000000001
      Satisfies: SYS_OLD
`;
    // Step 1: lock with SYS_OLD present → ledger records the edge.
    const run = await markspecPersist(["lock"], {
      files: {
        "project.yaml": PROJECT_YAML,
        "sys.md": sysOld,
        "swe.md": sweOld,
      },
      permissions: ["--allow-env", "--allow-run"],
    });
    try {
      assertEquals(run.code, 0, run.stderr);
      // Verify the ledger captured the edge before renaming.
      const lock = await Deno.readTextFile(join(run.dir, "markspec.lock"));
      assertStringIncludes(lock, 'authored-target = "SYS_OLD"');

      // Step 2: rename the target display ID (ULID unchanged).
      const sysNew = sysOld.replace("[SYS_OLD]", "[SYS_NEW]");
      await Deno.writeTextFile(join(run.dir, "sys.md"), sysNew);

      // Step 3: fmt heals the stale reference SYS_OLD → SYS_NEW.
      const fmt = await markspecInDir(
        run.dir,
        ["fmt", "swe.md", "sys.md"],
        ["--allow-env", "--allow-run"],
      );
      assertEquals(fmt.code, 0, fmt.stderr);
      const healed = await Deno.readTextFile(join(run.dir, "swe.md"));
      assertStringIncludes(healed, "Satisfies: SYS_NEW");
      assertEquals(healed.includes("Satisfies: SYS_OLD"), false);
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  },
);

Deno.test(
  "fmt: leaves an orphan reference untouched",
  async () => {
    const sweOrphan = `# Software

- [SWE_0001] Source

  Body.

      Id: 01SWE000000000000000000001
      Satisfies: SYS_GONE
`;
    const run = await markspecPersist(["fmt", "swe.md"], {
      files: { "project.yaml": PROJECT_YAML, "swe.md": sweOrphan },
      permissions: ["--allow-env", "--allow-run"],
    });
    try {
      assertEquals(run.code, 0, run.stderr);
      const out = await Deno.readTextFile(join(run.dir, "swe.md"));
      assertStringIncludes(out, "Satisfies: SYS_GONE");
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  },
);

Deno.test(
  "fmt --check: CRLF file with a ULID trace value still needs canonicalisation (#610)",
  async () => {
    // Regression for #610: a CRLF file must not silently pass --check while
    // its LF twin (the test above) exits 1.
    const { code } = await markspec(
      ["fmt", "--check", "swe.md", "sys.md"],
      {
        files: {
          "project.yaml": PROJECT_YAML,
          "sys.md": SYS.replace(/\n/g, "\r\n"),
          "swe.md": SWE_ULID.replace(/\n/g, "\r\n"),
        },
        permissions: ["--allow-env", "--allow-run"],
      },
    );
    assertEquals(code, 1);
  },
);

Deno.test(
  "fmt: CRLF file canonicalises a ULID trace value and preserves CRLF (#610)",
  async () => {
    const run = await markspecPersist(["fmt", "swe.md", "sys.md"], {
      files: {
        "project.yaml": PROJECT_YAML,
        "sys.md": SYS.replace(/\n/g, "\r\n"),
        "swe.md": SWE_ULID.replace(/\n/g, "\r\n"),
      },
      permissions: ["--allow-env", "--allow-run"],
    });
    try {
      assertEquals(run.code, 0, run.stderr);
      const swe = await Deno.readTextFile(join(run.dir, "swe.md"));
      // Canonicalised, and the CRLF line ending on the rewritten line survives.
      assertStringIncludes(swe, "Satisfies: SYS_0001\r\n");
      assertEquals(
        swe.includes("Satisfies: 01SYS000000000000000000001"),
        false,
      );
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  },
);

Deno.test(
  "fmt: file-local (no project root) does NOT canonicalise a ULID trace value",
  async () => {
    // No project.yaml → file-local fmt. The ULID reference must be left as
    // authored. SWE_ULID's trailer is already canonical (6-space indent,
    // no missing ULID to stamp), so the pure formatter is a no-op and
    // --check exits 0 — proving canonicalisation was skipped.
    const { code } = await markspec(
      ["fmt", "--check", "swe.md"],
      {
        files: { "swe.md": SWE_ULID },
        permissions: ["--allow-env", "--allow-run"],
      },
    );
    assertEquals(code, 0);
  },
);
