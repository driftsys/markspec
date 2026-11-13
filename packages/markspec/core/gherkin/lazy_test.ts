import { assert, assertEquals, assertFalse } from "@std/assert";
import { fromFileUrl } from "@std/path";
import "../mod.ts";
import { loadedGherkin } from "./load.ts";

// Separate file: each test file runs in its own module graph, so the
// parser cache is guaranteed to be empty here.
Deno.test("core/mod.ts import does not load the parser", () => {
  assertEquals(loadedGherkin(), undefined);
});

Deno.test("core/mod.ts has no static dependency on @cucumber/gherkin", async () => {
  const entry = fromFileUrl(new URL("../mod.ts", import.meta.url));
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", entry],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(out.success, new TextDecoder().decode(out.stderr));
  const graph = JSON.parse(new TextDecoder().decode(out.stdout)) as {
    roots: string[];
    modules: {
      specifier: string;
      dependencies?: {
        code?: { specifier: string };
        isDynamic?: boolean;
      }[];
    }[];
  };
  const bySpecifier = new Map(graph.modules.map((m) => [m.specifier, m]));
  // Follow only static runtime imports; a dynamic `import()` is allowed.
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
  const staticParser = [...reached].filter((s) => s.includes("@cucumber/"));
  assertEquals(staticParser, []);
  // Guard the check itself: the dynamic edge must exist in the graph.
  assert(
    graph.modules.some((m) => m.specifier.includes("@cucumber/gherkin")),
    "the parser is reachable through the dynamic import",
  );
});

Deno.test("parsing Markdown without a gherkin fence never loads the parser", async () => {
  const { parseFile } = await import("../parser/mod.ts");
  const md = "# Doc\n\n- [REQ-001] Brake\n\n  The system shall brake.\n\n" +
    "  ```ts\n  const x = 1;\n  ```\n\n      Id:\n";
  await parseFile(md, { file: "a.md" });
  assertFalse(loadedGherkin() !== undefined);
});
