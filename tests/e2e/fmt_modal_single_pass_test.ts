/**
 * @module tests/e2e/fmt_modal_single_pass_test
 *
 * E2E (#1031): one `fmt` pass gives the final modal keyword casing. A second
 * `fmt --check` passes and bare `check` reports no MSL-F010, for a keyword on
 * an indented lazy continuation line, a keyword and `not` split across lines
 * in a nested blockquote, and a keyword in underscore emphasis.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

function project(casing: string | undefined): Record<string, string> {
  const conventions = casing === undefined
    ? ""
    : `  conventions:\n    modal-keywords:\n      casing: ${casing}\n`;
  return {
    "project.yaml": "name: single-pass-e2e\nversion: 0.1.0\n",
    ".markspec.yaml": "profiles:\n  - ./profiles/p\n",
    "profiles/p/markspec.yaml": `markspec-schema: "1"
id: "@acme/single-pass"
version: 0.1.0
profile:
${conventions}  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`,
  };
}

function doc(body: string): string {
  return `- [REQ-0001] Wording

${body}

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
`;
}

const CASES: { name: string; casing?: string; body: string; want: string }[] = [
  {
    name: "lazy continuation line, default casing",
    body: "  The system\n      MUST not fail.",
    want: "must not fail.",
  },
  {
    name: "lazy continuation line, rfc8174",
    casing: "rfc8174",
    body: "  The system\n      must not fail.",
    want: "MUST NOT fail.",
  },
  {
    name: "nested blockquote split keyword, rfc8174",
    casing: "rfc8174",
    body: "  > > The system must\n  > > not fail.",
    want: "MUST NOT fail.",
  },
  {
    name: "underscore emphasis, default casing",
    body: "  The system __SHALL__ act.",
    want: "**shall**",
  },
];

for (const c of CASES) {
  Deno.test(`e2e: fmt reaches the final modal casing in one pass (${c.name})`, async () => {
    const { dir, code, stderr } = await markspecPersist(["fmt", "req.md"], {
      ...project(c.casing),
      "req.md": doc(c.body),
    });
    try {
      assertEquals(code, 0, stderr);
      const once = await Deno.readTextFile(join(dir, "req.md"));
      assert(once.includes(c.want), once);

      const fmtCheck = await markspecInDir(dir, ["fmt", "--check", "req.md"]);
      assertEquals(fmtCheck.code, 0, fmtCheck.stderr);

      const check = await markspecInDir(dir, ["check"]);
      assert(!check.stderr.includes("MSL-F010"), check.stderr);
      assert(!check.stderr.includes("MSL-F900"), check.stderr);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
}
