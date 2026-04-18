/**
 * @module migrate/mod_test
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { migrateLegacyIds } from "./mod.ts";

Deno.test("migrate: Id line becomes Spec-id with TYPE prefix stripped", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body.

  Id: SRS_00000000000000000000000001\\
  Labels: ASIL-B
`;
  const result = migrateLegacyIds(md);
  assertEquals(result.migrations, 1);
  assertEquals(result.changed, true);
  assertStringIncludes(
    result.output,
    "Spec-id: 00000000000000000000000001\\",
  );
  assert(!result.output.includes("Id: SRS_"));
});

Deno.test("migrate: preserves indentation", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body.

    Id: SRS_00000000000000000000000001
`;
  const result = migrateLegacyIds(md);
  assertStringIncludes(
    result.output,
    "    Spec-id: 00000000000000000000000001",
  );
});

Deno.test("migrate: preserves trailing backslash continuation", () => {
  const md = "  Id: SRS_00000000000000000000000001\\\n  Labels: ASIL-B\n";
  const result = migrateLegacyIds(md);
  assertStringIncludes(
    result.output,
    "  Spec-id: 00000000000000000000000001\\",
  );
});

Deno.test("migrate: leaves other attributes untouched", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body.

  Id: SRS_00000000000000000000000001\\
  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B
`;
  const result = migrateLegacyIds(md);
  assertStringIncludes(result.output, "Satisfies: SYS_BRK_0042\\");
  assertStringIncludes(result.output, "Labels: ASIL-B");
});

Deno.test("migrate: idempotent on already-migrated input", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body.

  Spec-id: 00000000000000000000000001\\
  Labels: ASIL-B
`;
  const result = migrateLegacyIds(md);
  assertEquals(result.migrations, 0);
  assertEquals(result.changed, false);
  assertEquals(result.output, md);
});

Deno.test("migrate: ignores non-Id attribute lines that start with Id", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body.

  Identity: something
  Id-not-really: foo
  Id: SRS_00000000000000000000000001
`;
  const result = migrateLegacyIds(md);
  assertEquals(result.migrations, 1);
  assertStringIncludes(result.output, "Identity: something");
  assertStringIncludes(result.output, "Id-not-really: foo");
});

Deno.test("migrate: Crockford-invalid body (contains L) emits MSL-M001 warning", () => {
  // "LLLLLLLLLLLLLLLLLLLLLLLLLL" is 26 chars but violates Crockford alphabet.
  const md = `  Id: SRS_LLLLLLLLLLLLLLLLLLLLLLLLLL\n`;
  const result = migrateLegacyIds(md);
  const warn = result.diagnostics.find((d) => d.code === "MSL-M001");
  assert(warn !== undefined);
  assertEquals(warn!.severity, "warning");
  assertStringIncludes(warn!.message, "Crockford");
  // Still migrates — the validator catches the alphabet problem.
  assertStringIncludes(
    result.output,
    "Spec-id: LLLLLLLLLLLLLLLLLLLLLLLLLL",
  );
});

Deno.test("migrate: multiple entries in one file all rewrite", () => {
  const md = `# Test

- [SRS_BRK_0001] First

  Body one.

  Id: SRS_00000000000000000000000001

- [SRS_BRK_0002] Second

  Body two.

  Id: SRS_00000000000000000000000002
`;
  const result = migrateLegacyIds(md);
  assertEquals(result.migrations, 2);
  const specIdCount =
    result.output.split("\n").filter((l) => l.trim().startsWith("Spec-id:"))
      .length;
  assertEquals(specIdCount, 2);
});

Deno.test("migrate: no changes on a file without any Id: attribute", () => {
  const md = `# Just prose

No entries here.
`;
  const result = migrateLegacyIds(md);
  assertEquals(result.migrations, 0);
  assertEquals(result.changed, false);
  assertEquals(result.output, md);
});

Deno.test("migrate: legacy Id value with too-short body is NOT migrated", () => {
  // The regex requires exactly 26 chars — shorter bodies aren't legacy ULIDs
  // (they're illustrative shorthand used in README-style examples).
  const md = `  Id: SRS_01HGW2Q8MNP3\n`;
  const result = migrateLegacyIds(md);
  assertEquals(result.migrations, 0);
  assertEquals(result.output, md);
});
