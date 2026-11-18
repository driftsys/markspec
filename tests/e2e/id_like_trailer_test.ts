/**
 * @module tests/e2e/id_like_trailer_test
 *
 * E2E: a trailer line that reads as `Id:` but is not read as one (`id:`,
 * `Id :`, #935) gets MSL-I009 from `check`, and `fmt` stamps no second
 * `Id:` on the entry, also when run twice.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT = {
  "project.yaml": "name: id-like-e2e\nversion: 0.1.0\n",
  ".markspec.yaml": "{}\n",
};
const ULID = "01HGW2Q8MNP3RSTVWXYZABCDEF";
const SPELLINGS = [`id: ${ULID}`, `Id : ${ULID}`];
const PERMISSIONS = ["--allow-ffi", "--allow-env", "--allow-run"];

const markdown = (line: string) =>
  `- [STK_0001] Title\n\n  The system shall act.\n\n      ${line}\n      Labels: a\n`;
const source = (line: string) =>
  `/// [STK_0001] Title\n///\n/// The system shall act.\n///\n///     ${line}\n///     Labels: a\nfn act() {}\n`;

for (
  const [file, build] of [["doc.md", markdown], ["doc.rs", source]] as const
) {
  for (const spelling of SPELLINGS) {
    Deno.test(`id-like trailer: '${spelling.slice(0, 5)}' in ${file}`, async () => {
      const text = build(spelling);
      const run = await markspecPersist(["check", file], {
        files: { ...PROJECT, [file]: text },
        permissions: PERMISSIONS,
      });
      try {
        assertEquals(run.code, 1);
        assertStringIncludes(run.stderr, "MSL-I009");
        assertStringIncludes(run.stderr, spelling.slice(0, 3));
        await markspecInDir(run.dir, ["fmt", file], PERMISSIONS);
        const first = await Deno.readTextFile(join(run.dir, file));
        assertEquals(first.match(/\bId: /g)?.length ?? 0, 0);
        assertEquals(first, text);
        await markspecInDir(run.dir, ["fmt", file], PERMISSIONS);
        assertEquals(await Deno.readTextFile(join(run.dir, file)), first);
      } finally {
        await Deno.remove(run.dir, { recursive: true });
      }
    });
  }
}

for (const file of ["doc.md", "doc.rs"]) {
  Deno.test(`id-like trailer: 'ID:' in ${file} is canonicalised, no second Id`, async () => {
    const text = file === "doc.md"
      ? markdown(`ID: ${ULID}`)
      : source(`ID: ${ULID}`);
    const run = await markspecPersist(["fmt", file], {
      files: { ...PROJECT, [file]: text },
      permissions: PERMISSIONS,
    });
    try {
      const first = await Deno.readTextFile(join(run.dir, file));
      assertEquals(
        first.match(/\bId: /g)?.length ?? 0,
        file === "doc.md" ? 1 : 0,
      );
      assertEquals(first.includes(`Id: ${ULID}`), file === "doc.md");
      await markspecInDir(run.dir, ["fmt", file], PERMISSIONS);
      assertEquals(await Deno.readTextFile(join(run.dir, file)), first);
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  });
}

const FEATURE_ULID = "01HGW2Q8MNP3RSTVWXYZABCDEF";
for (
  const header of [
    `# [STK_0001] A\n# id: ${FEATURE_ULID}`,
    `# [STK_0001] A\n#\n# Id : ${FEATURE_ULID}`,
  ]
) {
  Deno.test(`id-like trailer: ${JSON.stringify(header.split("\n").at(-1))} in a .feature header`, async () => {
    const text = `${header}\nFeature: A\n  Scenario: s\n    Given x\n`;
    const run = await markspecPersist(["check", "a.feature"], {
      files: { ...PROJECT, "a.feature": text },
      permissions: PERMISSIONS,
    });
    try {
      assertEquals(run.code, 1);
      assertStringIncludes(run.stderr, "MSL-I009");
      assertStringIncludes(run.stderr, "correct the Id-like line");
      await markspecInDir(run.dir, ["fmt", "a.feature"], PERMISSIONS);
      const first = await Deno.readTextFile(join(run.dir, "a.feature"));
      assertEquals(first, text);
      await markspecInDir(run.dir, ["fmt", "a.feature"], PERMISSIONS);
      assertEquals(await Deno.readTextFile(join(run.dir, "a.feature")), first);
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  });
}

Deno.test("id-like trailer: '# id:' above Feature and '# Id :' above a Scenario, fmt twice (#935)", async () => {
  const text =
    `# [STK_0001] A\n# id: ${FEATURE_ULID}\nFeature: A\n  Scenario: s\n    Given x\n\n# [STK_0002] B\n# Id : ${FEATURE_ULID}\n  Scenario: t\n    Given y\n`;
  const run = await markspecPersist(["fmt", "a.feature"], {
    files: { ...PROJECT, "a.feature": text },
    permissions: PERMISSIONS,
  });
  try {
    assertEquals(await Deno.readTextFile(join(run.dir, "a.feature")), text);
    await markspecInDir(run.dir, ["fmt", "a.feature"], PERMISSIONS);
    assertEquals(await Deno.readTextFile(join(run.dir, "a.feature")), text);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});
