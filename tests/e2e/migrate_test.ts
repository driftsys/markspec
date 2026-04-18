import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

Deno.test("migrate: rewrites legacy Id: to Spec-id: in place", async () => {
  const input = `# Test

- [SRS_BRK_0001] Title

  Body.

  Id: SRS_00000000000000000000000001\\
  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B
`;
  const { code, stderr } = await markspec(
    ["migrate", "req.md"],
    { "req.md": input },
  );
  assertEquals(code, 0);
  assertStringIncludes(stderr, "1 file(s) migrated");
});

Deno.test("migrate --check: fails when changes would be made", async () => {
  const input = `# Test

- [SRS_BRK_0001] Title

  Body.

  Id: SRS_00000000000000000000000001
`;
  const { code } = await markspec(
    ["migrate", "--check", "req.md"],
    { "req.md": input },
  );
  assertEquals(code, 1);
});

Deno.test("migrate --check: succeeds when nothing to change", async () => {
  const input = `# Test

- [SRS_BRK_0001] Title

  Body.

  Spec-id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const { code, stderr } = await markspec(
    ["migrate", "--check", "req.md"],
    { "req.md": input },
  );
  assertEquals(code, 0);
  assertStringIncludes(stderr, "0 file(s) migrated");
});

Deno.test("migrate: no files → error", async () => {
  const { code, stderr } = await markspec(["migrate"], {});
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no files specified");
});
