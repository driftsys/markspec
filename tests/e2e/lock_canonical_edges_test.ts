// tests/e2e/lock_canonical_edges_test.ts
import { assertEquals } from "@std/assert";
import { markspec } from "./helpers.ts";

/**
 * Smoke test: re-running `markspec lock` on the same logical entries in
 * different source order both succeed. Byte-equality of the canonical
 * edge hash is covered by the unit-level test in
 * `packages/markspec/core/lock/canonical_edges_test.ts`; this E2E test
 * exists to confirm the CLI surfaces the same property end-to-end.
 */
Deno.test("lock: succeeds regardless of source-entry order (smoke)", async () => {
  const fileA = `# Reqs

- [REQ-001] First

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Satisfies: STK-001

- [REQ-002] Second

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Satisfies: STK-002
`;
  const fileB = `# Reqs

- [REQ-002] Second

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Satisfies: STK-002

- [REQ-001] First

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Satisfies: STK-001
`;
  const a = await markspec(["lock", "--format", "json"], {
    "project.yaml": "name: test\nversion: '0.0.0'\n",
    "reqs.md": fileA,
  });
  const b = await markspec(["lock", "--format", "json"], {
    "project.yaml": "name: test\nversion: '0.0.0'\n",
    "reqs.md": fileB,
  });
  assertEquals(a.code, 0);
  assertEquals(b.code, 0);
  const pa = JSON.parse(a.stdout);
  const pb = JSON.parse(b.stdout);
  assertEquals(pa.command, "lock");
  assertEquals(pb.command, "lock");
  // Both projects have the same edge graph (REQ-001→STK-001,
  // REQ-002→STK-002) so the canonical edge count must match.
  assertEquals(
    pa.summary["canonical-edges"].count,
    pb.summary["canonical-edges"].count,
  );
});
