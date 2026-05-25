// tests/e2e/lock_drift_test.ts
import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspecInDir, markspecPersist } from "./helpers.ts";

Deno.test("lock --check: missing lockfile → MSL-L201", async () => {
  const r = await markspecPersist(["lock", "--check"], {
    "project.yaml": "name: t\nversion: '0.0.0'\n",
    "reqs.md": "x\n",
  });
  try {
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "MSL-L201");
  } finally {
    await Deno.remove(r.dir, { recursive: true });
  }
});

Deno.test("lock --check: clean state passes", async () => {
  const r = await markspecPersist(["lock"], {
    "project.yaml": "name: t\nversion: '0.0.0'\n",
    "reqs.md": "x\n",
  });
  try {
    const r2 = await markspecInDir(r.dir, ["lock", "--check"]);
    assertEquals(r2.code, 0);
  } finally {
    await Deno.remove(r.dir, { recursive: true });
  }
});

Deno.test("lock --check: corrupted edge hash → MSL-L212", async () => {
  const r = await markspecPersist(["lock"], {
    "project.yaml": "name: t\nversion: '0.0.0'\n",
    "reqs.md": "- [REQ-001] x\n\n      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n",
  });
  try {
    const lockPath = `${r.dir}/markspec.lock`;
    let lock = await Deno.readTextFile(lockPath);
    lock = lock.replace(
      /edges-hash\s*=\s*"sha256:[^"]+"/,
      'edges-hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000"',
    );
    await Deno.writeTextFile(lockPath, lock);
    const r2 = await markspecInDir(r.dir, ["lock", "--check"]);
    assertEquals(r2.code, 1);
    assertStringIncludes(r2.stderr, "MSL-L212");
  } finally {
    await Deno.remove(r.dir, { recursive: true });
  }
});
