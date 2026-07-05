import { assertEquals, assertStringIncludes } from "@std/assert";
import { compileAcquiredTree } from "./acquire_compile.ts";

// Build an in-memory tree fixture: project.yaml + one or more requirements
// files. `enumOrder` picks the order the fake `readDir` yields the entries of
// each directory: "forward" walks `Object.keys` as declared, "reverse" walks
// them reversed. This lets a test model two machines whose filesystems
// enumerate a directory in opposite orders — the snapshot must not depend on
// which one ran.
function fixtureIO(
  files: Record<string, string>,
  enumOrder: "forward" | "reverse" = "forward",
) {
  // Normalize `\`→`/` AND strip a leading drive letter. The fake tree is
  // keyed on a Unix-style `/dep` root, but `compileAcquiredTree` runs the
  // real `loadConfig`, whose `discoverProjectRoot` calls `resolve()` — on
  // Windows that turns `/dep` into `C:\dep`, so a candidate path arrives
  // here as `C:/dep/project.yaml`. Dropping the `C:` makes it match the
  // `/dep`-rooted fixture keys on every platform (no-op on POSIX).
  const norm = (p: string) => p.replaceAll("\\", "/").replace(/^[a-zA-Z]:/, "");
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
        const keys = Object.keys(files);
        if (enumOrder === "reverse") keys.reverse();
        for (const path of keys) {
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

/** One entry block, keyed by display ID. Each gets a distinct valid ULID so
 * no duplicate-Id diagnostic muddies the compiled output. */
function entryDoc(displayId: string, ulid: string): string {
  return [
    `- [${displayId}] Brake torque interface`,
    "",
    "  The interface shall carry brake torque within 5 ms.",
    "",
    `      Id: ${ulid}`,
    "",
  ].join("\n");
}

// A two-file tree whose files sit at DIFFERENT directory depths — a file
// `docs/b.md` next to a subdirectory `docs/b/` holding `docs/b/a.md`. The
// discovery walker's depth-first yield order (subdir `b/` before the sibling
// file `b.md`) differs from the full-relative-path lexicographic order
// (`docs/b.md` < `docs/b/a.md`, because '.' < '/'). `compileAcquiredTree`
// re-sorts the relative paths before compiling, so the entry order — and the
// resulting `compiled.json` bytes — is the lexicographic one regardless of
// walk order. Drop that `.sort()` and STK_ICD_0002 (from `docs/b/a.md`) leads
// STK_ICD_0001 (from `docs/b.md`), flipping the bytes and the snapshot hash.
const NESTED = {
  "/dep/project.yaml": "name: aeb-icd\nversion: 1.2.0\n",
  "/dep/docs/b.md": entryDoc("STK_ICD_0001", "01HGW2Q8MNP3RSTVWXYZABCDEF"),
  "/dep/docs/b/a.md": entryDoc("STK_ICD_0002", "01HGW2Q8MNP3RSTVWXYZABCDEG"),
};

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

Deno.test(
  "compileAcquiredTree: snapshot is byte-reproducible across discovery orders",
  async () => {
    // Two "machines" enumerate the tree's directories in opposite orders.
    // The shared snapshot pin in markspec.lock must be identical on both, so
    // the compiled bytes must not depend on filesystem enumeration order.
    const a = await compileAcquiredTree(
      "/dep",
      fixtureIO(NESTED, "forward"),
      "0.0.0-test",
    );
    const b = await compileAcquiredTree(
      "/dep",
      fixtureIO(NESTED, "reverse"),
      "0.0.0-test",
    );
    if ("error" in a || "error" in b) throw new Error("unexpected error");
    assertEquals(a.snapshot, b.snapshot);

    // The load-bearing guard on the `.sort()` in compileAcquiredTree: entries
    // are emitted in sorted tree-relative path order (`docs/b.md` before
    // `docs/b/a.md`), NOT the walker's depth-first order (`docs/b/a.md`
    // first). Without the sort, STK_ICD_0002 would lead STK_ICD_0001 and this
    // assertion — and the two snapshots above — would diverge.
    const json = new TextDecoder().decode(a.compiledBytes);
    const first = json.indexOf('"STK_ICD_0001"');
    const second = json.indexOf('"STK_ICD_0002"');
    assertEquals(
      first >= 0 && second >= 0 && first < second,
      true,
      "entries must be ordered by sorted tree-relative path (STK_ICD_0001 first)",
    );
  },
);

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
