/**
 * @module tests/e2e/lint_q500_keywords_test
 *
 * E2E: MSL-Q500 never reports a modal or EARS keyword as an undefined term,
 * whether `fmt` left it lowercase or uppercased it under `rfc8174`. A real
 * undefined term in the same text is still reported. A glossary term that
 * contains a keyword ("May Day Protocol", "NOT READY STATE") is not split at
 * the keyword (#1028).
 */

import { assert, assertEquals } from "@std/assert";
import { markspec, markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT = {
  "project.yaml": "name: q500-e2e\nversion: 0.1.0\n",
  ".markspec.yaml": "profiles:\n  - ./profiles/p\n",
  "profiles/p/markspec.yaml": `markspec-schema: "1"
id: "@acme/q500"
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

  The BrakeController shall apply pressure. It must not stall.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
`;

Deno.test("e2e: lint skips uppercased modal keywords under rfc8174 but reports a real undefined term", async () => {
  const { dir, code, stderr } = await markspecPersist(["fmt", "req.md"], {
    ...PROJECT,
    "req.md": DOC,
  });
  try {
    assertEquals(code, 0, stderr);
    assert((await Deno.readTextFile(`${dir}/req.md`)).includes("SHALL"));
    const lint = await markspecInDir(dir, ["lint", "req.md"]);
    const output = lint.stdout + lint.stderr;
    assert(output.includes("MSL-Q500"), output);
    assert(output.includes("'BrakeController'"), output);
    assert(!output.includes("'BrakeController SHALL'"), output);
    assert(!output.includes("'SHALL'"), output);
    assert(!output.includes("'MUST NOT'"), output);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

const TERMS_DOC = `- [REQ-0001] Recovery

  May Day Protocol
  : the recovery sequence

  Not Ready State
  : the state before calibration

  The pump shall use the May Day Protocol in the NOT READY STATE. The
  XyzUnit MAY retry the MAY DAY PROTOCOL in the Not Ready State.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Requirement
`;

Deno.test("e2e: lint keeps a glossary term that contains a keyword whole (#1028)", async () => {
  const { stdout } = await markspec(["lint", "--format", "json", "req.md"], {
    files: {
      "project.yaml": "name: q500-e2e\nversion: 0.1.0\n",
      "req.md": TERMS_DOC,
    },
  });
  const parsed = JSON.parse(stdout) as {
    diagnostics: Array<{ code: string; message: string }>;
  };
  const phrases = parsed.diagnostics
    .filter((d) => d.code === "MSL-Q500")
    .map((d) => /'([^']+)'/.exec(d.message)?.[1]);
  assertEquals(phrases, ["XyzUnit"]);
});
