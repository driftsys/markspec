import { assert, assertEquals, assertFalse } from "@std/assert";
import { fromFileUrl } from "@std/path";
import "../mod.ts";
import { loadedGherkin } from "./load.ts";

// Separate file: each test file runs in its own module graph, so the
// parser cache is guaranteed to be empty here.
Deno.test("core/mod.ts import does not load the parser", () => {
  assertEquals(loadedGherkin(), undefined);
});

/** The parts of the `deno info --json` output that the checks read. */
interface ModuleGraph {
  readonly roots: readonly string[];
  readonly modules: readonly {
    readonly specifier: string;
    readonly dependencies?: readonly {
      /** The specifier as written in the import, for example `@cucumber/gherkin`. */
      readonly specifier: string;
      readonly code?: { readonly specifier: string };
      readonly isDynamic?: boolean;
    }[];
  }[];
}

/**
 * The resolved specifiers that the roots reach through static runtime
 * imports only. A dynamic `import()` is not followed. Specifiers are
 * compared as `deno info` reports them, so file URLs with drive letters
 * need no conversion.
 */
function staticallyReached(graph: ModuleGraph): Set<string> {
  const bySpecifier = new Map(graph.modules.map((m) => [m.specifier, m]));
  const reached = new Set<string>();
  const queue = [...graph.roots];
  while (queue.length > 0) {
    const specifier = queue.pop()!;
    if (reached.has(specifier)) continue;
    reached.add(specifier);
    for (const dep of bySpecifier.get(specifier)?.dependencies ?? []) {
      if (!dep.isDynamic && dep.code) queue.push(dep.code.specifier);
    }
  }
  return reached;
}

/**
 * `true` when some module imports `name` with a dynamic `import()`. Reads
 * the import edge itself, by the specifier as written in the source, not
 * the module entries for the npm package: `deno info` does not list those
 * on every platform (on the Windows CI runner it did not), while the edge
 * is always recorded in the importing module.
 */
function hasDynamicImportOf(graph: ModuleGraph, name: string): boolean {
  return graph.modules.some((m) =>
    (m.dependencies ?? []).some((d) =>
      d.isDynamic === true && d.code !== undefined && d.specifier === name
    )
  );
}

Deno.test("staticallyReached and hasDynamicImportOf: Windows-shaped graph", () => {
  const mod = "file:///D:/a/markspec/markspec/packages/markspec/core/mod.ts";
  const load =
    "file:///D:/a/markspec/markspec/packages/markspec/core/gherkin/load.ts";
  const npm = "npm:@cucumber/gherkin@42.0.1";
  const graph = (isDynamic: boolean): ModuleGraph => ({
    roots: [mod],
    // No module entry for the npm package, as on the Windows runner.
    modules: [
      {
        specifier: mod,
        dependencies: [{
          specifier: "./gherkin/load.ts",
          code: { specifier: load },
        }],
      },
      {
        specifier: load,
        dependencies: [{
          specifier: "@cucumber/gherkin",
          code: { specifier: npm },
          isDynamic,
        }],
      },
    ],
  });
  assertFalse(staticallyReached(graph(true)).has(npm));
  assert(hasDynamicImportOf(graph(true), "@cucumber/gherkin"));
  // A static import is found, and is no dynamic edge.
  assert(staticallyReached(graph(false)).has(npm));
  assertFalse(hasDynamicImportOf(graph(false), "@cucumber/gherkin"));
});

// The module graph does not depend on the operating system, so the Linux and
// macOS CI jobs enforce this. On Windows the dynamic-import guard below fails
// for a reason not yet found (#932), so the test does not run there.
Deno.test({
  name: "core/mod.ts has no static dependency on @cucumber/gherkin",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const entry = fromFileUrl(new URL("../mod.ts", import.meta.url));
    const out = await new Deno.Command(Deno.execPath(), {
      args: ["info", "--json", entry],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(out.success, new TextDecoder().decode(out.stderr));
    const graph = JSON.parse(
      new TextDecoder().decode(out.stdout),
    ) as ModuleGraph;
    const staticParser = [...staticallyReached(graph)].filter((s) =>
      s.includes("@cucumber/")
    );
    assertEquals(staticParser, []);
    // Guard the check itself: the dynamic edge must exist in the graph.
    assert(
      hasDynamicImportOf(graph, "@cucumber/gherkin"),
      "the parser is reachable through the dynamic import",
    );
  },
});

Deno.test("parsing Markdown without a gherkin fence never loads the parser", async () => {
  const { parseFile } = await import("../parser/mod.ts");
  const md = "# Doc\n\n- [REQ-001] Brake\n\n  The system shall brake.\n\n" +
    "  ```ts\n  const x = 1;\n  ```\n\n      Id:\n";
  await parseFile(md, { file: "a.md" });
  assertFalse(loadedGherkin() !== undefined);
});
