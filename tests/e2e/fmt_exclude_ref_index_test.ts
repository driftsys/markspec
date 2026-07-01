/**
 * @module tests/e2e/fmt_exclude_ref_index_test
 *
 * E2E: bare `markspec fmt` must build its ADR-026 canonicalisation index
 * from the same corpus `check` (MSL-L006) and `lock` use — i.e. honoring
 * project.yaml `exclude:`. An entry in an excluded path must NOT resolve a
 * trace reference during formatting.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspecPersist } from "./helpers.ts";

const PROJECT_YAML = `name: fmt-exclude-e2e
version: 0.1.0
exclude:
  - skills/
`;

// An excluded entry (skills/ is out of scope). Its Id is pre-stamped
// because bare fmt never formats an excluded file.
const SKILL_ENTRY = `# Skills

- [SKILL-0001] A skill requirement

  The skill shall complete initialization within 100 ms.

      Id: 01SKY000000000000000000009
`;

// A tracked doc whose Satisfies value is the excluded entry's ULID.
// canonicalizeRefs rewrites a ULID → its display ID ONLY when that entry
// is in fmt's ref index — so this is the observable exclude signal.
const REQ_ENTRY = `# Requirements

- [REQ-0001] Response time

  The system shall respond within 200 ms.

      Id: 01REQ000000000000000000001
      Satisfies: 01SKY000000000000000000009
`;

Deno.test("fmt: excluded entry does not resolve trace refs (ref index honors exclude)", async () => {
  const run = await markspecPersist(["fmt"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "docs/req.md": REQ_ENTRY,
      "skills/x.md": SKILL_ENTRY,
    },
  });
  try {
    assertEquals(run.code, 0, `stderr: ${run.stderr}`);

    // The excluded skills entry is outside fmt's ref corpus, so the ULID
    // must NOT be canonicalised to the excluded entry's display ID.
    const formatted = await Deno.readTextFile(`${run.dir}/docs/req.md`);
    assertEquals(
      formatted.includes("SKILL-0001"),
      false,
      `fmt resolved a trace ref against an excluded entry:\n${formatted}`,
    );
    assertStringIncludes(formatted, "01SKY000000000000000000009");

    // The excluded file itself is never formatted.
    const skill = await Deno.readTextFile(`${run.dir}/skills/x.md`);
    assertEquals(skill, SKILL_ENTRY);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});
