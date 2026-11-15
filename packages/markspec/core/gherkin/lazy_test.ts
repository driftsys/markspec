import { assert, assertEquals, assertFalse } from "@std/assert";
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
    /** For example `esm` (a loaded JavaScript or TypeScript module), `npm`,
     * or `external` (a specifier Deno did not load). */
    readonly kind?: string;
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
 * the import edge itself, by the specifier as written in the source, so
 * the check does not depend on how the npm package's own module entries
 * are reported.
 */
function hasDynamicImportOf(graph: ModuleGraph, name: string): boolean {
  return graph.modules.some((m) =>
    (m.dependencies ?? []).some((d) =>
      d.isDynamic === true && d.code !== undefined && d.specifier === name
    )
  );
}

Deno.test("staticallyReached and hasDynamicImportOf: graph with no npm module entry", () => {
  const mod = "file:///D:/a/markspec/markspec/packages/markspec/core/mod.ts";
  const load =
    "file:///D:/a/markspec/markspec/packages/markspec/core/gherkin/load.ts";
  const npm = "npm:@cucumber/gherkin@42.0.1";
  const graph = (isDynamic: boolean): ModuleGraph => ({
    roots: [mod],
    // No module entry for the npm package: the checks read the import edges.
    modules: [
      {
        specifier: mod,
        dependencies: [
          { specifier: "./gherkin/load.ts", code: { specifier: load } },
          // Other dynamic imports, which must not count as the parser's.
          {
            specifier: "./other.ts",
            code: { specifier: "file:///D:/other.ts" },
            isDynamic: true,
          },
          // An unresolved dynamic import of the parser has no `code`.
          { specifier: "@cucumber/gherkin", isDynamic: true },
        ],
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

Deno.test({
  name: "core/mod.ts has no static dependency on @cucumber/gherkin",
  fn: async () => {
    // Pass a file URL, not a path: on Windows `deno info` reads the drive
    // letter of `d:\...` as a URL scheme and reports one external module
    // with no dependencies (#932).
    const entry = new URL("../mod.ts", import.meta.url).href;
    const out = await new Deno.Command(Deno.execPath(), {
      args: ["info", "--json", entry],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(out.success, new TextDecoder().decode(out.stderr));
    const graph = JSON.parse(
      new TextDecoder().decode(out.stdout),
    ) as ModuleGraph;
    // Guard the graph itself: the entry must resolve to a local module and
    // its static imports must be followed, or the checks below would pass
    // without reading any import.
    const root = graph.modules.find((m) => m.specifier === graph.roots[0]);
    assertEquals(root?.kind, "esm", "the entry resolves to a local module");
    const loader = new URL("./load.ts", import.meta.url).href;
    assert(
      staticallyReached(graph).has(loader),
      "the static walk reaches core/gherkin/load.ts",
    );
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
