/**
 * @module tests/e2e/nested_entry_test
 *
 * E2E: an entry-shaped list item nested in an entry (#928) is not an entry.
 * `check` reports one MSL-P024 per nested item, the parent keeps its own Id,
 * and `fmt` leaves the file byte for byte unchanged, also when run twice.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspec, markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT = {
  "project.yaml": "name: nested-e2e\nversion: 0.1.0\n",
  ".markspec.yaml": "{}\n",
};

const PARENT_ID = "01HGW2Q8MNP3RSTVWXYZABCDEF";
const CHILD_ID = "01HGW2Q8MNP3RSTVWXYZABCDEG";
const OTHER_CHILD_ID = "01HGW2Q8MNP3RSTVWXYZABCDEH";

const PARENT = "- [REQ-001] Parent\n\n  The system shall keep its own Id.\n\n";
const CHILD = `  - [REQ-003] Child\n\n    Child body.\n\n`;

interface Case {
  readonly name: string;
  readonly text: string;
  /** Parent Id the compiled entry must have, or `undefined` for none. */
  readonly parentId: string | undefined;
  /** File lines of the MSL-P024 diagnostics. */
  readonly nestedLines: number[];
  /** Diagnostic codes that must not be reported. */
  readonly absent?: string[];
}

const CASES: Case[] = [
  {
    name: "canonical child trailer, parent trailer below the child",
    text:
      `${PARENT}${CHILD}        Id: ${CHILD_ID}\n\n      Id: ${PARENT_ID}\n`,
    parentId: PARENT_ID,
    nestedLines: [5],
    absent: ["MSL-P020", "MSL-I003", "MSL-R003"],
  },
  {
    name: "parent trailer above the child, child git-style trailer",
    text:
      `${PARENT}      Id: ${PARENT_ID}\n\n  - [REQ-003] Child\n\n    Child body.\n    Id: ${CHILD_ID}\n`,
    parentId: PARENT_ID,
    nestedLines: [7],
    absent: ["MSL-P020", "MSL-I003", "MSL-R003"],
  },
  {
    name: "parent trailer directly above the child",
    text:
      `- [REQ-001] Parent\n\n  The system shall keep its own Id.\n  Id: ${PARENT_ID}\n${CHILD}        Id: ${CHILD_ID}\n`
        .replace("Id.\n  Id:", "Id.\n\n      Id:"),
    parentId: PARENT_ID,
    nestedLines: [6],
    absent: ["MSL-I003", "MSL-R003"],
  },
  {
    name: "parent trailer above the child, child paragraph after its trailer",
    text:
      `${PARENT}      Id: ${PARENT_ID}\n\n${CHILD}        Id: ${CHILD_ID}\n\n    Satisfies: REQ-009\n`,
    parentId: PARENT_ID,
    nestedLines: [7],
    absent: ["MSL-P020", "MSL-P023", "MSL-I003", "MSL-R003"],
  },
  {
    name: "parent trailer above, paragraph at the parent trailer indent below",
    text:
      `${PARENT}      Id: ${PARENT_ID}\n\n${CHILD}        Id: ${CHILD_ID}\n\n      Satisfies: REQ-009\n`,
    parentId: PARENT_ID,
    nestedLines: [7],
    absent: ["MSL-P020", "MSL-I003", "MSL-R003"],
  },
  {
    name: "same at depth 2",
    text:
      `${PARENT}      Id: ${PARENT_ID}\n\n  - note\n\n    - [REQ-003] Child\n\n      Child body.\n\n          Id: ${CHILD_ID}\n\n      Satisfies: REQ-009\n`,
    parentId: PARENT_ID,
    nestedLines: [9],
    absent: ["MSL-P020", "MSL-I003", "MSL-R003"],
  },
  {
    name: "parent without an Id, child canonical trailer",
    text: `${PARENT}${CHILD}        Id: ${CHILD_ID}\n`,
    parentId: undefined,
    nestedLines: [5],
    absent: ["MSL-P020"],
  },
  {
    name: "parent without an Id, child git-style trailer",
    text: `${PARENT}${CHILD.trimEnd()}\n    Id: ${CHILD_ID}\n`,
    parentId: undefined,
    nestedLines: [5],
    absent: ["MSL-P020"],
  },
  {
    name: "parent without an Id, child tab-indented trailer",
    text: `${PARENT}${CHILD}    \tId: ${CHILD_ID}\n`,
    parentId: undefined,
    nestedLines: [5],
    absent: ["MSL-P020"],
  },
  {
    name: "two nested entries",
    text:
      `${PARENT}${CHILD}        Id: ${CHILD_ID}\n\n  - [REQ-004] Other\n\n    Other body.\n\n        Id: ${OTHER_CHILD_ID}\n`,
    parentId: undefined,
    nestedLines: [5, 11],
    absent: ["MSL-P020"],
  },
  {
    name: "two nested entries, parent trailer above them",
    text:
      `${PARENT}      Id: ${PARENT_ID}\n\n${CHILD}        Id: ${CHILD_ID}\n\n  - [REQ-004] Other\n\n    Other body.\n\n        Id: ${OTHER_CHILD_ID}\n`,
    parentId: PARENT_ID,
    nestedLines: [7, 13],
    absent: ["MSL-P020", "MSL-I003", "MSL-R003"],
  },
  {
    name: "nested entry at depth 2",
    text:
      `${PARENT}  - note\n\n    - [REQ-003] Child\n\n      Child body.\n\n          Id: ${CHILD_ID}\n`,
    parentId: undefined,
    nestedLines: [7],
    absent: ["MSL-P020"],
  },
];

for (const lineEnding of ["\n", "\r\n"]) {
  const label = lineEnding === "\n" ? "LF" : "CRLF";
  for (const testCase of CASES) {
    const text = testCase.text.replaceAll("\n", lineEnding);

    Deno.test(`check (${label}): ${testCase.name}`, async () => {
      const { stderr } = await markspec(["check", "doc.md"], {
        files: { ...PROJECT, "doc.md": text },
      });
      const nested = [...stderr.matchAll(/MSL-P024\]: doc\.md:(\d+)/g)]
        .map((m) => Number(m[1]));
      assertEquals(nested, testCase.nestedLines, stderr);
      for (const code of testCase.absent ?? []) {
        assertEquals(stderr.includes(code), false, `${code}: ${stderr}`);
      }
    });

    Deno.test(`compile (${label}): ${testCase.name}`, async () => {
      const { stdout } = await markspec(
        ["compile", "doc.md", "--format", "json"],
        { files: { ...PROJECT, "doc.md": text } },
      );
      const entries = Object.values(
        JSON.parse(stdout.slice(stdout.indexOf("{"))).entries,
      ) as { displayId: string; id?: string }[];
      assertEquals(entries.length, 1, stdout);
      assertEquals(entries[0].id, testCase.parentId);
    });

    Deno.test(`fmt (${label}): ${testCase.name} stays unchanged`, async () => {
      const run = await markspecPersist(["fmt", "doc.md"], {
        files: { ...PROJECT, "doc.md": text },
      });
      try {
        assertEquals(run.code, 0, run.stderr);
        const first = await Deno.readTextFile(join(run.dir, "doc.md"));
        assertEquals(first, text);
        await markspecInDir(run.dir, ["fmt", "doc.md"]);
        assertEquals(await Deno.readTextFile(join(run.dir, "doc.md")), first);
      } finally {
        await Deno.remove(run.dir, { recursive: true });
      }
    });
  }
}

Deno.test("check: the issue input keeps the parent Id and warns once", async () => {
  const text =
    `- [REQ-001] Parent\n\n  Body.\n  Id: ${PARENT_ID}\n  - [REQ-003] Child\n\n    Child body.\n\n        Id: ${CHILD_ID}\n`;
  const { stderr } = await markspec(["check", "doc.md"], {
    files: { ...PROJECT, "doc.md": text },
  });
  assertEquals(stderr.match(/MSL-P024/g)?.length, 1, stderr);
  assertStringIncludes(stderr, "doc.md:5");
  assertEquals(stderr.includes("error["), false, stderr);
});

Deno.test("check: a parent without an Id is told to move the nested entry first", async () => {
  const { stderr } = await markspec(["check", "doc.md"], {
    files: {
      ...PROJECT,
      "doc.md": `${PARENT}${CHILD}        Id: ${CHILD_ID}\n`,
    },
  });
  assertStringIncludes(stderr, "MSL-I003");
  assertStringIncludes(stderr, "move the nested entry to the top level");
  assertEquals(stderr.includes("without Id: run fmt"), false, stderr);
});
