/**
 * @module tests/e2e/fmt_profile_typed_value_unicode_space_test
 *
 * E2E: a profile-declared attribute whose type is not `text` is trimmed of
 * all whitespace, like a typed core attribute (#990). `fmt` removes a
 * U+FEFF or a non-breaking space (U+00A0) at either end of its value, and
 * keeps them around the value of a profile `text` attribute and of an
 * undeclared key. A second `fmt` changes nothing, bare `check` reports
 * MSL-F010 for an untrimmed value, and `compile --format json` outputs the trimmed value.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

const NBSP = String.fromCharCode(0xa0);
const BOM = String.fromCharCode(0xfeff);

const PROFILE_YAML = `id: "@acme/unicode"
version: 0.1.0
markspec-schema: "1"
profile:
  attributes:
    - name: Hazard
      type: id
    - name: Count
      type: integer
    - name: Note
      type: text
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`;

const FILES = {
  "project.yaml": "name: profile-unicode-space-e2e\nversion: 0.1.0\n",
  ".markspec.yaml": "profiles:\n  - ./profiles/unicode\n",
  "profiles/unicode/markspec.yaml": PROFILE_YAML,
};

const DOC = `# Requirements

- [REQ-0001] Imported requirement

  The system shall keep imported values unchanged.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Hazard: HAZ-0001${NBSP}
      COUNT: ${BOM}3
      Note: ${NBSP}kept as imported
      Comment: legacy value${NBSP}
`;

/** The value of `key` in the `rawAttributes` of `REQ-0001` in `json`. */
function compiledValue(json: string, key: string): unknown {
  const found: unknown[] = [];
  JSON.parse(json, (k, v) => {
    if (
      k === "rawAttributes" && Array.isArray(v) &&
      v.some((a) => a?.key === "Id")
    ) {
      for (const a of v) if (a?.key === key) found.push(a.value);
    }
    return v;
  });
  return found[0];
}

Deno.test("e2e: fmt, check and compile trim a profile typed value and keep free text (#990)", async () => {
  const { dir, code, stderr } = await markspecPersist(["fmt", "req.md"], {
    ...FILES,
    "req.md": DOC,
  });
  try {
    assertEquals(code, 0, stderr);
    const out = await Deno.readTextFile(join(dir, "req.md"));
    assertStringIncludes(out, "      Hazard: HAZ-0001\n");
    assertStringIncludes(out, "      Count: 3\n");
    assertStringIncludes(out, `      Note: ${NBSP}kept as imported\n`);
    assertStringIncludes(out, `      Comment: legacy value${NBSP}\n`);

    const again = await markspecInDir(dir, ["fmt", "req.md"]);
    assertEquals(again.code, 0, again.stderr);
    assertEquals(await Deno.readTextFile(join(dir, "req.md")), out);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("e2e: check reports MSL-F010 for an untrimmed profile typed value (#990)", async () => {
  const { dir, code, stderr } = await markspecPersist(["check"], {
    ...FILES,
    "req.md": DOC.replace(`      COUNT: ${BOM}3\n`, "      Count: 3\n"),
  });
  try {
    assertEquals(code, 1, stderr);
    assertStringIncludes(stderr, "MSL-F010");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("e2e: compile outputs a trimmed profile typed value (#990)", async () => {
  const { dir, code, stdout, stderr } = await markspecPersist(
    ["compile", "--format", "json", "req.md"],
    { ...FILES, "req.md": DOC },
  );
  try {
    assertEquals(code, 0, stderr);
    assertEquals(compiledValue(stdout, "Hazard"), "HAZ-0001");
    assertEquals(compiledValue(stdout, "COUNT"), "3");
    assertEquals(compiledValue(stdout, "Note"), `${NBSP}kept as imported`);
    assertEquals(compiledValue(stdout, "Comment"), `legacy value${NBSP}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("e2e: fmt applies the profile of each project to its own files (#990)", async () => {
  // Only the nested project's profile declares Hazard as a typed attribute.
  const entry = (id: string) =>
    `- [REQ-0001] Imported requirement

  The system shall keep imported values unchanged.

      Id: ${id}
      Hazard: HAZ-0001${NBSP}
`;
  const { dir, code, stderr } = await markspecPersist(
    ["fmt", "a.md", "nested/b.md"],
    {
      "project.yaml": "name: outer-e2e\nversion: 0.1.0\n",
      "a.md": entry("01HGW2Q8MNP3RSTVWXYZABCDEF"),
      "nested/project.yaml": "name: nested-e2e\nversion: 0.1.0\n",
      "nested/.markspec.yaml": "profiles:\n  - ./profiles/unicode\n",
      "nested/profiles/unicode/markspec.yaml": PROFILE_YAML,
      "nested/b.md": entry("01HGW2Q8MNP3RSTVWXYZABCDEG"),
    },
  );
  try {
    assertEquals(code, 0, stderr);
    const a = await Deno.readTextFile(join(dir, "a.md"));
    const b = await Deno.readTextFile(join(dir, "nested/b.md"));
    assertStringIncludes(a, `      Hazard: HAZ-0001${NBSP}\n`);
    assertStringIncludes(b, "      Hazard: HAZ-0001\n");
    assertEquals(b.includes(NBSP), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
