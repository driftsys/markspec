/**
 * @module tests/e2e/lint_nested_test
 *
 * E2E: bare `markspec lint` treats a folder with its own `project.yaml` as a
 * separate project (ADR-028 section 7, #856): own profile, own corpus, one
 * scope header per project, one combined JSON object.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecPersist } from "./helpers.ts";
import {
  CLEAN_REQ_DOC,
  PARENT_FILES,
  SUB_FILES,
  VAGUE_REQ,
  VAGUE_WIDGET,
} from "./nested_fixtures.ts";

async function lint(
  files: Record<string, string>,
  args: string[] = ["lint"],
  cwd?: string,
) {
  const r = await markspecPersist(args, { files, cwd });
  await Deno.remove(r.dir, { recursive: true });
  return r;
}

Deno.test("lint nested: a finding inside sub is reported and sets the exit code", async () => {
  const r = await lint({
    ...PARENT_FILES,
    "docs/req.md": CLEAN_REQ_DOC,
    ...SUB_FILES,
    "sub/docs/wid.md": VAGUE_WIDGET,
  });
  const finding = r.stderr.split("\n").find((l) =>
    l.includes(join("sub", "docs", "wid.md")) && l.includes("warning")
  );
  assertEquals(finding !== undefined, true, r.stderr);
  assertEquals(r.code, 2, r.stderr);
});

Deno.test("lint nested: sub is linted with its own profile", async () => {
  // `widget` exists only in the sub profile. With the parent profile the
  // entry would carry an unknown-type error.
  const r = await lint({
    ...PARENT_FILES,
    "docs/req.md": CLEAN_REQ_DOC,
    ...SUB_FILES,
    "sub/docs/wid.md": VAGUE_WIDGET,
  });
  assertEquals(
    r.stderr.split("\n").some((l) => l.includes(" error ")),
    false,
    r.stderr,
  );
  assertEquals(r.stderr.includes("MSL-T"), false, r.stderr);
  assertEquals(r.code, 2, r.stderr);
});

Deno.test("lint nested: scope header once per project", async () => {
  const r = await lint({
    ...PARENT_FILES,
    "docs/req.md": CLEAN_REQ_DOC,
    ...SUB_FILES,
    "sub/docs/wid.md": VAGUE_WIDGET,
  });
  const headers = r.stderr.split("\n").filter((l) => l.startsWith("linting "));
  assertEquals(headers.length, 2, r.stderr);
  assertStringIncludes(headers[0], "1 file(s)");
  assertEquals(headers[0].endsWith("/sub"), false);
  assertEquals(headers[1].endsWith("sub"), true);
});

Deno.test("lint nested: one score summary per project in text output", async () => {
  const r = await lint({
    ...PARENT_FILES,
    "docs/req.md": CLEAN_REQ_DOC,
    ...SUB_FILES,
    "sub/docs/wid.md": VAGUE_WIDGET,
  });
  const scores = r.stderr.split("\n").filter((l) => l.startsWith("Score: "));
  assertEquals(scores.length, 2, r.stderr);
});

Deno.test("lint nested: --format json is one object with combined diagnostics and score", async () => {
  const files = {
    ...PARENT_FILES,
    "docs/req.md": VAGUE_REQ,
    ...SUB_FILES,
    "sub/docs/wid.md": VAGUE_WIDGET.replace(
      "as appropriate",
      "within 200 ms",
    ),
  };
  const both = JSON.parse(
    (await lint(files, ["lint", "--format", "json"])).stdout,
  );
  // Parent alone (a project without sub) and sub alone (run from sub/).
  const parentOnly = JSON.parse(
    (await lint(
      Object.fromEntries(
        Object.entries(files).filter(([k]) => !k.startsWith("sub/")),
      ),
      ["lint", "--format", "json"],
    )).stdout,
  );
  const subOnly = JSON.parse(
    (await lint(files, ["lint", "--format", "json"], "sub")).stdout,
  );

  assertEquals(Array.isArray(both.diagnostics), true);
  const diagFiles = new Set(
    both.diagnostics.map((d: { location: { file: string } }) =>
      d.location.file
    ),
  );
  assertEquals(
    [...diagFiles].some((f) => (f as string).endsWith(join("docs", "req.md"))),
    true,
  );
  assertEquals(
    both.diagnostics.length,
    parentOnly.diagnostics.length + subOnly.diagnostics.length,
  );

  const sum = (o: Record<string, number>) =>
    Object.values(o).reduce((a, b) => a + b, 0);
  const n1 = sum(parentOnly.score.rollup.bandCounts);
  const n2 = sum(subOnly.score.rollup.bandCounts);
  assertEquals(n1 > 0 && n2 > 0, true);
  for (const band of Object.keys(both.score.rollup.bandCounts)) {
    assertEquals(
      both.score.rollup.bandCounts[band],
      parentOnly.score.rollup.bandCounts[band] +
        subOnly.score.rollup.bandCounts[band],
      band,
    );
  }
  const expectedMean = Math.round(
    (parentOnly.score.rollup.mean * n1 + subOnly.score.rollup.mean * n2) /
      (n1 + n2) * 10,
  ) / 10;
  assertEquals(both.score.rollup.mean, expectedMean);
  assertEquals(both.score.antiPatternNote, parentOnly.score.antiPatternNote);
});
