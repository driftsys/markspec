import { assertEquals, assertStringIncludes } from "@std/assert";
import { compileAcquiredTree } from "./acquire_compile.ts";

// Build an in-memory tree fixture: project.yaml + one requirements file.
function fixtureIO(files: Record<string, string>) {
  const norm = (p: string) => p.replaceAll("\\", "/");
  return {
    readFile: (p: string) => Promise.resolve(files[norm(p)]),
    readText: (p: string) => {
      const c = files[norm(p)];
      if (c === undefined) return Promise.reject(new Error("ENOENT"));
      return Promise.resolve(c);
    },
    discovery: {
      async *readDir(dir: string) {
        const prefix = norm(dir).replace(/\/$/, "") + "/";
        const seen = new Set<string>();
        for (const path of Object.keys(files)) {
          if (!path.startsWith(prefix)) continue;
          const rest = path.slice(prefix.length);
          const seg = rest.split("/")[0];
          if (seen.has(seg)) continue;
          seen.add(seg);
          yield {
            name: seg,
            isFile: !rest.includes("/"),
            isDirectory: rest.includes("/"),
            isSymlink: false,
          };
        }
      },
      readFile: (p: string) => Promise.resolve(files[norm(p)]),
    },
  };
}

const PROJECT = {
  "/dep/project.yaml": "name: aeb-icd\nversion: 1.2.0\n",
  "/dep/docs/reqs.md": [
    "# Reqs",
    "",
    "- [STK_ICD_0001] Brake torque interface",
    "",
    "  The interface shall carry brake torque within 5 ms.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
    "",
  ].join("\n"),
};

Deno.test("compileAcquiredTree: byte-reproducible snapshot", async () => {
  const a = await compileAcquiredTree("/dep", fixtureIO(PROJECT), "0.0.0-test");
  const b = await compileAcquiredTree("/dep", fixtureIO(PROJECT), "0.0.0-test");
  if ("error" in a || "error" in b) throw new Error("unexpected error");
  assertEquals(a.snapshot, b.snapshot);
});

Deno.test("compileAcquiredTree: location.file is tree-relative", async () => {
  const r = await compileAcquiredTree("/dep", fixtureIO(PROJECT), "0.0.0-test");
  if ("error" in r) throw new Error(r.error);
  const json = new TextDecoder().decode(r.compiledBytes);
  assertStringIncludes(json, '"file":"docs/reqs.md"');
  // No absolute temp path leaked in.
  assertEquals(json.includes("/dep/docs/reqs.md"), false);
});

Deno.test("compileAcquiredTree: no project.yaml → error", async () => {
  const r = await compileAcquiredTree(
    "/dep",
    fixtureIO({ "/dep/docs/x.md": "# x\n" }),
    "0.0.0-test",
  );
  assertEquals("error" in r, true);
});
