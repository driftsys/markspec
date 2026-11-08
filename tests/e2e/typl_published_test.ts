/**
 * E2E acceptance tests for the typl published/namespaced tier (S5, #723).
 * Blackbox: drives `markspec check` only. See the design spec
 * docs/wip/2026-07-04-typl-published-tier-design.md.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = "name: typl-e2e\nversion: 0.1.0\n";

const DECLARING_ENTRY = `- [REQ_0001] Brake signals contract

  The brake namespace (\`$powertrain.brake : namespace\`) declares:

  - \`$.pedal_position : signal float[0..100]\` — pedal travel percent.
  - \`$.line_pressure : signal float[0..250]\` — hydraulic pressure bar.

  Latency budgets apply to \`$.pedal_position\`.

      Id: 01HZZZ0000000000000000001A
`;

Deno.test("published: declared-once + relative-under-base is clean", async () => {
  const { code, stderr } = await markspec(["check"], {
    "project.yaml": PROJECT_YAML,
    "a.md": DECLARING_ENTRY,
  });
  assertEquals(code, 0, stderr);
});

Deno.test("published: duplicate declaration across files is TYPL-009", async () => {
  const dup = `- [REQ_0002] Second declaration

  Duplicate: \`$powertrain.brake.pedal_position : signal float[0..100]\`.

      Id: 01HZZZ0000000000000000001B
`;
  const { code, stderr } = await markspec(["check"], {
    "project.yaml": PROJECT_YAML,
    "a.md": DECLARING_ENTRY,
    "b.md": dup,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "TYPL-009");
});

Deno.test("published: absolute citation from another entry is clean", async () => {
  const citing = `- [REQ_0003] Pedal latency

  The system shall sample \`$powertrain.brake.pedal_position\` within 5 ms.

      Id: 01HZZZ0000000000000000002A
`;
  const { code, stderr } = await markspec(["check"], {
    "project.yaml": PROJECT_YAML,
    "a.md": DECLARING_ENTRY,
    "b.md": citing,
  });
  assertEquals(code, 0, stderr);
});

Deno.test("published: citation of undeclared symbol is TYPL-011", async () => {
  const citing = `- [REQ_0004] Ghost citation

  The system shall read \`$powertrain.brake.rotor_temp\` each cycle.

      Id: 01HZZZ0000000000000000002B
`;
  const { code, stderr } = await markspec(["check"], {
    "project.yaml": PROJECT_YAML,
    "a.md": DECLARING_ENTRY,
    "b.md": citing,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "TYPL-011");
});

Deno.test("published: checking only the citing file succeeds when the declaration is unchecked", async () => {
  const { code, stderr } = await markspec(["check", "citing.md"], {
    "project.yaml": PROJECT_YAML,
    "declaring.md": DECLARING_ENTRY,
    "citing.md": `- [REQ_0003] Pedal latency

  The system shall sample \`$powertrain.brake.pedal_position\` within 5 ms.

      Id: 01HZZZ0000000000000000002A
`,
  });
  assertEquals(code, 0, stderr);
  assertEquals(stderr.includes("TYPL-011"), false, stderr);
});

Deno.test("published: file-local check suppresses a dangling citation", async () => {
  const { code, stderr } = await markspec(["check", "citing.md"], {
    "project.yaml": PROJECT_YAML,
    "citing.md": `- [REQ_0004] Ghost citation

  The system shall read \`$powertrain.brake.rotor_temp\` each cycle.

      Id: 01HZZZ0000000000000000002B
`,
  });
  assertEquals(code, 0, stderr);
  assertEquals(stderr.includes("TYPL-011"), false, stderr);
});

Deno.test("published: compile still reports TYPL-009/010/011", async () => {
  const { code, stderr } = await markspec(["compile", "citing.md"], {
    "project.yaml": PROJECT_YAML,
    "citing.md": `${DECLARING_ENTRY}
- [REQ_0004] Duplicate declaration and unresolved citations

  Declares \`$powertrain.brake.pedal_position : signal float[0..100]\` again.
  The system shall read \`$powertrain.brake.rotor_temp\` and \`$.pedal_position\`.

      Id: 01HZZZ0000000000000000002B
`,
  });
  assertEquals(code, 0, stderr);
  assertStringIncludes(stderr, "TYPL-009");
  assertStringIncludes(stderr, "TYPL-010");
  assertStringIncludes(stderr, "TYPL-011");
});

Deno.test("published: relative ref with no base is TYPL-010", async () => {
  const orphan = `- [REQ_0005] Orphan relative

  Declares \`$.pedal_position : signal float[0..100]\` with no namespace.

      Id: 01HZZZ0000000000000000003A
`;
  const { code, stderr } = await markspec(["check", "a.md"], {
    "a.md": orphan,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "TYPL-010");
});

Deno.test("published: two root namespaces is TYPL-012", async () => {
  const twoRoots = `- [REQ_0006] Two roots

  First (\`$powertrain.brake : namespace\`) and second
  (\`$cabin.hvac : namespace\`) roots.

      Id: 01HZZZ0000000000000000004A
`;
  const { code, stderr } = await markspec(["check", "a.md"], {
    "a.md": twoRoots,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "TYPL-012");
});

Deno.test("published: namespace with a shape is TYPL-006", async () => {
  const badNs = `- [REQ_0007] Malformed namespace

  Declares \`$powertrain.brake : namespace float\`.

      Id: 01HZZZ0000000000000000005A
`;
  const { code, stderr } = await markspec(["check", "a.md"], {
    "a.md": badNs,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "TYPL-006");
});

Deno.test("compat: entry-local same-name different-shape no longer errors", async () => {
  // Under the retired flat-global model this was TYPL-003. Two entries,
  // two unrelated entry-local symbols (D7 relaxation).
  const a = `- [REQ_0008] Local A

  Declares \`$speed : signal float[0..300]\`.

      Id: 01HZZZ0000000000000000006A
`;
  const b = `- [REQ_0009] Local B

  Declares \`$speed : state\`.

      Id: 01HZZZ0000000000000000006B
`;
  const { code, stderr } = await markspec(["check"], {
    "project.yaml": PROJECT_YAML,
    "a.md": a,
    "b.md": b,
  });
  assertEquals(code, 0, stderr);
  assertEquals(stderr.includes("TYPL-002"), false);
  assertEquals(stderr.includes("TYPL-003"), false);
});

Deno.test("compat: free-prose $foo.bar stays opaque", async () => {
  const prose = `- [REQ_0010] Prose mention

  The system shall preserve these shell variable names outside code spans:

  $HOME.backup

  $foo.bar

      Id: 01HZZZ0000000000000000007A
`;
  const { code, stderr } = await markspec(["check"], {
    "project.yaml": PROJECT_YAML,
    "a.md": prose,
  });
  assertEquals(code, 0, stderr);
  assertEquals(stderr.includes("TYPL-"), false);
});
