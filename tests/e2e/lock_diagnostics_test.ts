import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspecInDir, markspecPersist } from "./helpers.ts";

Deno.test("edge drift: check, lock --check, compile --frozen and doctor give the same remedy", async () => {
  const run = await markspecPersist(["lock"], {
    "project.yaml": "name: lock-diagnostics\nversion: '0.0.0'\n",
    "reqs.md": "# Requirements\n",
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    const lockPath = `${run.dir}/markspec.lock`;
    const raw = await Deno.readTextFile(lockPath);
    const stale = raw.replace(
      /edges-hash\s*=\s*"sha256:[^"]+"/,
      `edges-hash = "sha256:${"0".repeat(64)}"`,
    );
    assertEquals(stale === raw, false, "fixture must change the pinned hash");
    await Deno.writeTextFile(lockPath, stale);

    const expected =
      "traceability edges drifted from markspec.lock: locked 0 edge(s), current 0 — run `markspec lock` to refresh. (After upgrading MarkSpec this can also fire once because traceability inputs now include source-file doc comments; re-running `markspec lock` clears it.)";
    for (
      const args of [
        ["check"],
        ["lock", "--check"],
        ["compile", "--frozen", "reqs.md"],
        ["doctor"],
      ]
    ) {
      const result = await markspecInDir(run.dir, args);
      assertEquals(result.code, args[0] === "doctor" ? 2 : 1, result.stderr);
      assertStringIncludes(result.stderr, expected, args.join(" "));
      if (args[0] !== "doctor") {
        assertStringIncludes(result.stderr, "MSL-L212");
      }
    }
    const json = await markspecInDir(run.dir, ["doctor", "--format", "json"]);
    assertEquals(json.code, 2, json.stderr);
    const output = JSON.parse(json.stdout);
    assertEquals(output.lockfile, {
      present: true,
      edgeDrift: true,
      lockedEdges: 0,
      currentEdges: 0,
    });
    assertEquals(
      output.diagnostics.find((d: { code: string }) =>
        d.code === "lockfile-edge-drift"
      ),
      {
        severity: "warning",
        code: "lockfile-edge-drift",
        message: expected,
      },
    );
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});
