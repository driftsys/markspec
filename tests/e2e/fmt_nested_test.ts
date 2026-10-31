/**
 * @module tests/e2e/fmt_nested_test
 *
 * E2E: bare `markspec fmt` treats a folder with its own `project.yaml` as a
 * separate project (ADR-028 section 7, #856): own profile, own reference
 * index, one summary line per project, worst-of exit code.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspecPersist } from "./helpers.ts";
import {
  CLEAN_REQ_DOC,
  PARENT_FILES,
  SUB_FILES,
  VAGUE_WIDGET,
} from "./nested_fixtures.ts";

/** A widget entry with no `Id:` stamp, so `fmt` has work to do. */
const UNSTAMPED_WIDGET = VAGUE_WIDGET.replace(
  "      Id: 01WDG000000000000000000001\n",
  "",
);

/** Widget document: WID-0002 cites WID-0001 by ULID. */
const WIDGET_REF_DOC = `# Widgets

- [WID-0001] First widget

  The widget shall respond within 200 ms.

      Id: 01WDG000000000000000000001
      Type: widget

- [WID-0002] Second widget

  The widget shall report within 300 ms.

      Id: 01WDG000000000000000000002
      Type: widget
      Satisfies: 01WDG000000000000000000001
`;

async function run(
  files: Record<string, string>,
  args: string[] = ["fmt"],
) {
  const r = await markspecPersist(args, { files });
  const read = async (p: string) => await Deno.readTextFile(`${r.dir}/${p}`);
  const out = {
    code: r.code,
    stderr: r.stderr,
    sub: await read("sub/docs/wid.md").catch(() => ""),
    parent: await read("docs/req.md").catch(() => ""),
  };
  await Deno.remove(r.dir, { recursive: true });
  return out;
}

Deno.test("fmt nested: a file inside sub is formatted", async () => {
  const r = await run({
    ...PARENT_FILES,
    "docs/req.md": CLEAN_REQ_DOC,
    ...SUB_FILES,
    "sub/docs/wid.md": UNSTAMPED_WIDGET,
  });
  assertEquals(r.code, 0, r.stderr);
  assertEquals(/^ {6}Id: 01[0-9A-Z]{24}$/m.test(r.sub), true, r.sub);
});

Deno.test("fmt nested: one summary line per project", async () => {
  const r = await run({
    ...PARENT_FILES,
    "docs/req.md": CLEAN_REQ_DOC,
    ...SUB_FILES,
    "sub/docs/wid.md": UNSTAMPED_WIDGET,
  });
  const summaries = r.stderr.split("\n").filter((l) =>
    l.includes("file(s) formatted")
  );
  assertEquals(summaries.length, 2, r.stderr);
  assertEquals(
    summaries[0],
    "0 file(s) formatted, 1 unchanged (1 total)",
  );
  assertEquals(
    summaries[1],
    "1 file(s) formatted, 0 unchanged (1 total)",
  );
  const headers = r.stderr.split("\n").filter((l) =>
    l.startsWith("formatting ")
  );
  assertEquals(headers.length, 2, r.stderr);
});

Deno.test("fmt nested: --check exits 1 when only sub has drift", async () => {
  const r = await run({
    ...PARENT_FILES,
    "docs/req.md": CLEAN_REQ_DOC,
    ...SUB_FILES,
    "sub/docs/wid.md": UNSTAMPED_WIDGET,
  }, ["fmt", "--check"]);
  assertEquals(r.code, 1, r.stderr);
  // --check writes nothing.
  assertEquals(r.sub, UNSTAMPED_WIDGET);
});

Deno.test("fmt nested: --check exits 0 when both projects are clean", async () => {
  const r = await run({
    ...PARENT_FILES,
    "docs/req.md": CLEAN_REQ_DOC,
    ...SUB_FILES,
    "sub/docs/wid.md": WIDGET_REF_DOC.replace(
      "      Satisfies: 01WDG000000000000000000001\n",
      "      Satisfies: WID-0001\n",
    ),
  }, ["fmt", "--check"]);
  assertEquals(r.code, 0, r.stderr);
});

Deno.test("fmt nested: sub canonicalises references with its own index", async () => {
  const r = await run({
    ...PARENT_FILES,
    "docs/req.md": CLEAN_REQ_DOC,
    ...SUB_FILES,
    "sub/docs/wid.md": WIDGET_REF_DOC,
  });
  assertEquals(r.code, 0, r.stderr);
  assertStringIncludes(r.sub, "Satisfies: WID-0001");
  assertEquals(r.sub.includes("Satisfies: 01WDG"), false, r.sub);
});

Deno.test("fmt nested: sub does not resolve references into the parent index", async () => {
  // The ULID belongs to REQ-0001 in the parent project; sub has no such
  // entry, so the value must stay as written.
  const r = await run({
    ...PARENT_FILES,
    "docs/req.md": CLEAN_REQ_DOC,
    ...SUB_FILES,
    "sub/docs/wid.md": WIDGET_REF_DOC.replace(
      "Satisfies: 01WDG000000000000000000001",
      "Satisfies: 01REQ000000000000000000001",
    ),
  });
  assertStringIncludes(r.sub, "Satisfies: 01REQ000000000000000000001");
});
