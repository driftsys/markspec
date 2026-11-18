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

/** Number of reports of `code` (the I003 hint also names MSL-I009). */
const count = (text: string, code: string) =>
  text.match(new RegExp(`\\[${code}\\]`, "g"))?.length ?? 0;

// Markdown: `check` reports the line and `fmt` leaves the entry unchanged.
for (const spelling of SPELLINGS) {
  Deno.test(`id-like trailer: '${spelling.slice(0, 5)}' in Markdown`, async () => {
    const text = markdown(spelling);
    const run = await markspecPersist(["check", "doc.md"], {
      files: { ...PROJECT, "doc.md": text },
      permissions: PERMISSIONS,
    });
    try {
      assertEquals(run.code, 1);
      assertEquals(count(run.stderr, "MSL-I009"), 1);
      assertStringIncludes(run.stderr, "doc.md:5");
      assertStringIncludes(run.stderr, spelling.slice(0, 3));
      await markspecInDir(run.dir, ["fmt", "doc.md"], PERMISSIONS);
      const first = await Deno.readTextFile(join(run.dir, "doc.md"));
      assertEquals(first, text);
      await markspecInDir(run.dir, ["fmt", "doc.md"], PERMISSIONS);
      assertEquals(await Deno.readTextFile(join(run.dir, "doc.md")), first);
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  });

  // `fmt` never edits a source file, so only `check` is observable there.
  Deno.test(`id-like trailer: '${spelling.slice(0, 5)}' in a source doc comment`, async () => {
    const run = await markspecPersist(["check", "doc.rs"], {
      files: { ...PROJECT, "doc.rs": source(spelling) },
      permissions: PERMISSIONS,
    });
    try {
      assertEquals(run.code, 1);
      assertEquals(count(run.stderr, "MSL-I009"), 1);
      assertStringIncludes(run.stderr, "doc.rs:5");
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  });
}

// `ID:` is an attribute line in Markdown and source: never MSL-I009. In
// Markdown, `fmt` canonicalises the key and stamps no second Id.
const GIT_STYLE = (line: string) =>
  `- [STK_0001] Title\n\n  The system shall act.\n\n  ${line}\n  Labels: a\n`;
for (
  const [layout, build] of [
    ["indented", markdown],
    ["git-style", GIT_STYLE],
  ] as const
) {
  Deno.test(`id-like trailer: ${layout} 'ID:' in Markdown is canonicalised`, async () => {
    const text = build(`ID: ${ULID}`);
    const run = await markspecPersist(["check", "doc.md"], {
      files: { ...PROJECT, "doc.md": text },
      permissions: PERMISSIONS,
    });
    try {
      assertEquals(count(run.stderr, "MSL-I009"), 0);
      await markspecInDir(run.dir, ["fmt", "doc.md"], PERMISSIONS);
      const first = await Deno.readTextFile(join(run.dir, "doc.md"));
      assertEquals(first.match(/\bId: /g)?.length, 1);
      assertEquals(first.includes(`Id: ${ULID}`), true);
      assertEquals(first.includes("ID:"), false);
      await markspecInDir(run.dir, ["fmt", "doc.md"], PERMISSIONS);
      assertEquals(await Deno.readTextFile(join(run.dir, "doc.md")), first);
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  });
}

Deno.test("id-like trailer: 'ID:' in a source doc comment is not MSL-I009", async () => {
  const run = await markspecPersist(["check", "doc.rs"], {
    files: { ...PROJECT, "doc.rs": source(`ID: ${ULID}`) },
    permissions: PERMISSIONS,
  });
  try {
    assertEquals(count(run.stderr, "MSL-I009"), 0);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

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
      assertEquals(count(run.stderr, "MSL-I009"), 1);
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
