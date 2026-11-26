/**
 * @module tests/e2e/fmt_rfc8174_casing_test
 *
 * E2E: under `modal-keywords.casing: rfc8174`, `fmt` uppercases `shall` and
 * `must` (and a following `not`) in entry bodies and keeps `may`, `should`,
 * `will` and EARS keywords as written. `fmt --check` then passes and bare
 * `check` reports no MSL-F010.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT = {
  "project.yaml": "name: rfc8174-e2e\nversion: 0.1.0\n",
  ".markspec.yaml": "profiles:\n  - ./profiles/p\n",
  "profiles/p/markspec.yaml": `markspec-schema: "1"
id: "@acme/rfc8174"
version: 0.1.0
profile:
  conventions:
    modal-keywords:
      casing: rfc8174
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`,
};

const DOC = `- [REQ-0001] Wording

  The system shall act When requested and may retry. It must not fail. Use
  \`shall\` and [a link](https://example.com/shall) here.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
`;

const DOC_FORMATTED = `- [REQ-0001] Wording

  The system SHALL act When requested and may retry. It MUST NOT fail. Use
  \`shall\` and [a link](https://example.com/shall) here.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
`;

Deno.test("e2e: fmt uppercases shall and must under rfc8174 and check reports no MSL-F010", async () => {
  const { dir, code, stderr } = await markspecPersist(["fmt", "req.md"], {
    ...PROJECT,
    "req.md": DOC,
  });
  try {
    assertEquals(code, 0, stderr);
    assertEquals(
      await Deno.readTextFile(join(dir, "req.md")),
      DOC_FORMATTED,
    );

    const fmtCheck = await markspecInDir(dir, ["fmt", "--check", "req.md"]);
    assertEquals(fmtCheck.code, 0, fmtCheck.stderr);

    const check = await markspecInDir(dir, ["check"]);
    // Exit code 2 means warnings only (advisory prose lint on this sample
    // text); an error would be 1. The gates ran over the project file.
    assertEquals(check.code, 2, check.stderr);
    assert(check.stderr.includes("checking 1 file(s)"), check.stderr);
    assert(!check.stderr.includes("MSL-F010"), check.stderr);
    assert(!check.stderr.includes("MSL-F900"), check.stderr);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("e2e: check reports MSL-M062 for lowercase shall and no MSL-M060 for SHALL under rfc8174", async () => {
  const doc = `- [REQ-0001] Upper

  The system SHALL act.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement

- [REQ-0002] Lower

  The system shall act.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Type: requirement
`;
  const { dir } = await markspecPersist(["--version"], {
    ...PROJECT,
    "req.md": doc,
  });
  try {
    const check = await markspecInDir(dir, ["check", "req.md"]);
    assertEquals(check.code, 0, check.stderr);
    assert(!check.stderr.includes("MSL-M060"), check.stderr);
    assert(check.stderr.includes("MSL-M062"), check.stderr);
    assert(check.stderr.includes("'shall'"), check.stderr);
    assert(!check.stderr.includes("'SHALL'"), check.stderr);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("e2e: check reports MSL-M062 for a profile Requirement subtype with a non-REQ prefix", async () => {
  const doc = `- [STK_0001] Explicit

  The system should act.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: stakeholder

- [STK_0002] By pattern

  The system should act.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG

- [DRC_0001] Not a requirement

  The team may revisit this.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEH
`;
  const { dir } = await markspecPersist(["fmt", "stk.md"], {
    "project.yaml": "name: rfc8174-stk\nversion: 0.1.0\n",
    ".markspec.yaml": "profiles:\n  - ./profiles/p\n",
    "profiles/p/markspec.yaml": `markspec-schema: "1"
id: "@acme/rfc8174-stk"
version: 0.1.0
profile:
  conventions:
    modal-keywords:
      casing: rfc8174
  types:
    stakeholder:
      extends: Requirement
      display-id-pattern: "STK_{n:04d}"
    design-record:
      extends: Record
      display-id-pattern: "DRC_{n:04d}"
`,
    "stk.md": doc,
  });
  try {
    const check = await markspecInDir(dir, ["check", "stk.md"]);
    const m062 = check.stderr.split("\n").filter((l) => l.includes("MSL-M062"));
    assertEquals(m062.length, 2, check.stderr);
    assertEquals(
      m062.filter((l) => l.includes("stk.md:3")).length,
      1,
      check.stderr,
    );
    assertEquals(
      m062.filter((l) => l.includes("stk.md:10")).length,
      1,
      check.stderr,
    );
    assert(!check.stderr.includes("MSL-M060"), check.stderr);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** A profile with the given `modal-keywords.casing` (none when `undefined`). */
function casingProfile(id: string, casing: string | undefined): string {
  const conventions = casing === undefined
    ? ""
    : `  conventions:\n    modal-keywords:\n      casing: ${casing}\n`;
  return `markspec-schema: "1"
id: "@acme/${id}"
version: 0.1.0
profile:
${conventions}  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`;
}

/** One entry with an uppercase and a lowercase `shall`, and a `may`. */
const MIXED_DOC = `- [REQ-0001] Wording

  The system SHALL act and may retry. The system shall log.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
`;

Deno.test("e2e: one bare fmt and check apply each nested project's own modal-keywords casing", async () => {
  const files: Record<string, string> = {
    // The outer root has a config of its own and no profile; the three nested
    // projects below it each load their own.
    ".markspec.yaml": "exclude:\n  - unused/\n",
  };
  for (
    const [name, casing] of [["def", undefined], ["pre", "preserve"], [
      "rfc",
      "rfc8174",
    ]] as const
  ) {
    files[`${name}/.markspec.yaml`] = "profiles:\n  - ./prof\n";
    files[`${name}/prof/markspec.yaml`] = casingProfile(name, casing);
    files[`${name}/req.md`] = MIXED_DOC;
  }
  const { dir, code, stderr } = await markspecPersist(["fmt"], files);
  try {
    assertEquals(code, 0, stderr);
    const read = (name: string) => Deno.readTextFile(join(dir, name, "req.md"));
    // Default: both keywords lowercased.
    const def = await read("def");
    assert(
      def.includes("The system shall act and may retry. The system shall log."),
      def,
    );
    // preserve: nothing changes.
    assertEquals(await read("pre"), MIXED_DOC);
    // rfc8174: shall uppercased, may kept.
    const rfc = await read("rfc");
    assert(
      rfc.includes("The system SHALL act and may retry. The system SHALL log."),
      rfc,
    );

    const check = await markspecInDir(dir, ["check"]);
    assert(!check.stderr.includes("MSL-F010"), check.stderr);
    const m060 = check.stderr.split("\n").filter((l) => l.includes("MSL-M060"));
    assertEquals(m060.length, 0, check.stderr);
    // Warnings only (advisory prose lint), no error.
    assertEquals(check.code, 2, check.stderr);
    assert(
      check.stderr.includes("checking 3 file(s) under"),
      check.stderr,
    );
    assert(check.stderr.includes("(4 projects)"), check.stderr);
    // Only the rfc8174 project reports MSL-M062: its lowercase `may` on
    // line 3 (`may` is not rewritten under rfc8174).
    const m062 = check.stderr.split("\n").filter((l) => l.includes("MSL-M062"));
    assertEquals(m062.length, 1, check.stderr);
    // The path separator is `\` on Windows.
    assert(/rfc[\\/]req\.md:3/.test(m062[0]), check.stderr);
    assert(m062[0].includes("'may'"), check.stderr);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("e2e: fmt is idempotent for `must` at a line end under rfc8174 and fmt --check passes", async () => {
  const doc = `- [REQ-0001] Wording

  The system must
  not fail and shall
  Not hang.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
`;
  const { dir, code, stderr } = await markspecPersist(["fmt", "req.md"], {
    ...PROJECT,
    "req.md": doc,
  });
  try {
    assertEquals(code, 0, stderr);
    const first = await Deno.readTextFile(join(dir, "req.md"));
    assert(first.includes("MUST NOT fail and SHALL NOT hang."), first);
    const check = await markspecInDir(dir, ["fmt", "--check", "req.md"]);
    assertEquals(check.code, 0, check.stderr);
    const second = await markspecInDir(dir, ["fmt", "req.md"]);
    assertEquals(second.code, 0, second.stderr);
    assertEquals(await Deno.readTextFile(join(dir, "req.md")), first);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("e2e: fmt under rfc8174 leaves free prose outside entries unchanged", async () => {
  const prose =
    "# Notes\n\nThe team shall meet and must not skip. MAY stays.\n\n";
  const doc = prose + `- [REQ-0001] Wording

  The system shall act.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
`;
  const { dir, code, stderr } = await markspecPersist(["fmt", "req.md"], {
    ...PROJECT,
    "req.md": doc,
  });
  try {
    assertEquals(code, 0, stderr);
    assertEquals(
      await Deno.readTextFile(join(dir, "req.md")),
      doc.replace("The system shall act.", "The system SHALL act."),
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
