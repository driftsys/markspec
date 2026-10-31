// tests/e2e/lock_nested_project_test.ts
import { assertEquals } from "@std/assert";
import { markspecPersist } from "./helpers.ts";

const ENTRY = (id: string, ulid: string, target: string) =>
  `# Reqs

- [${id}] Entry ${id}

      Id: ${ulid}
      Satisfies: ${target}
`;

Deno.test("lock: bare lock at a parent does not pin entries of a nested project", async () => {
  const run = await markspecPersist(["lock"], {
    files: {
      "project.yaml": "name: parent\nversion: '0.0.0'\n",
      "reqs.md": ENTRY("REQ-001", "01HGW2Q8MNP3RSTVWXYZABCDEF", "STK-001"),
      "sub/project.yaml": "name: sub\nversion: '0.0.0'\n",
      "sub/reqs.md": ENTRY(
        "SUBREQ-001",
        "01HGW2Q8MNP3RSTVWXYZABCDEG",
        "SUBSTK-001",
      ),
    },
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    const lock = await Deno.readTextFile(`${run.dir}/markspec.lock`);
    // The edge ledger is keyed by source ULID and authored target.
    assertEquals(lock.includes("01HGW2Q8MNP3RSTVWXYZABCDEG"), false, lock);
    assertEquals(lock.includes("SUBSTK-001"), false, lock);
    assertEquals(lock.includes("01HGW2Q8MNP3RSTVWXYZABCDEF"), true, lock);
    assertEquals(lock.includes("edges-count = 1"), true, lock);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});
