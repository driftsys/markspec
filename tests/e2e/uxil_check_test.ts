/**
 * E2E acceptance tests for the UXIL-0xx diagnostics family (S9, #727).
 * Blackbox: drives `markspec check` only. See the design spec
 * docs/wip/2026-07-05-uxil-diagnostics-s9-design.md.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: uxil-e2e\nversion: 0.1.0\n`;
const MARKSPEC_YAML = `profiles:\n  - ./profiles/acme\n`;

const PROFILE_YAML = `id: "@acme/uxil-e2e"
version: 0.1.0
markspec-schema: "1"
profile:
  types:
    ux-contract:
      extends: Contract
      display-id-pattern: "UXI_{n:4d}"
      declares: ux-surface
    requirement:
      extends: Requirement
      display-id-pattern: "REQ_{n:4d}"
`;

const PROFILE_YAML_NO_DECLARES = `id: "@acme/uxil-e2e"
version: 0.1.0
markspec-schema: "1"
profile:
  types:
    ux-contract:
      extends: Contract
      display-id-pattern: "UXI_{n:4d}"
    requirement:
      extends: Requirement
      display-id-pattern: "REQ_{n:4d}"
`;

const CONTRACT = `- [UXI_0001] Media home contract

  \`ux:media.home : screen @ loading, ready\` offers:

  - \`/play : activate\` — starts playback.

      Id: 01HZZZ0000000000000000010A
`;

Deno.test("uxil: clean designated corpus passes check", async () => {
  const { code, stderr } = await markspec(["check", "contract.md"], {
    "project.yaml": PROJECT_YAML,
    ".markspec.yaml": MARKSPEC_YAML,
    "profiles/acme/markspec.yaml": PROFILE_YAML,
    "contract.md": CONTRACT,
  });
  assertEquals(code, 0, stderr);
});

Deno.test("uxil: unknown verb in a contract entry is UXIL-010", async () => {
  const bad = `- [UXI_0001] Media home contract

  \`ux:media.home : screen\` offers:

  - \`/play : frobnicate\` — an unknown verb.

      Id: 01HZZZ0000000000000000010A
`;
  const { code, stderr } = await markspec(["check", "contract.md"], {
    "project.yaml": PROJECT_YAML,
    ".markspec.yaml": MARKSPEC_YAML,
    "profiles/acme/markspec.yaml": PROFILE_YAML,
    "contract.md": bad,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "UXIL-010");
});

Deno.test("uxil: root declaration in a requirement entry is UXIL-023", async () => {
  const rogue = `- [REQ_0001] Not a contract

  \`ux:rogue.surface : screen\` — declared in the wrong entry type.

      Id: 01HZZZ0000000000000000020A
`;
  const { code, stderr } = await markspec(
    ["check", "contract.md", "req.md"],
    {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": MARKSPEC_YAML,
      "profiles/acme/markspec.yaml": PROFILE_YAML,
      "contract.md": CONTRACT,
      "req.md": rogue,
    },
  );
  assertEquals(code, 1);
  assertStringIncludes(stderr, "UXIL-023");
});

Deno.test("uxil: cross-entry citation codes are suppressed on file-local check", async () => {
  const citing = `- [REQ_0001] Journey step

  Tap \`ux:media.ghost/play!activate\` to start playback.

      Id: 01HZZZ0000000000000000020A
`;
  const { code, stderr } = await markspec(
    ["check", "contract.md", "req.md"],
    {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": MARKSPEC_YAML,
      "profiles/acme/markspec.yaml": PROFILE_YAML,
      "contract.md": CONTRACT,
      "req.md": citing,
    },
  );
  assertEquals(code, 0, stderr);
  assertEquals(stderr.includes("UXIL-018"), false);
});

Deno.test("uxil: bare check reports a dangling citation as UXIL-018", async () => {
  const citing = `- [REQ_0001] Journey step

  Tap \`ux:media.ghost/play!activate\` to start playback.

      Id: 01HZZZ0000000000000000020A
`;
  const { code, stderr } = await markspec(["check"], {
    "project.yaml": PROJECT_YAML,
    ".markspec.yaml": MARKSPEC_YAML,
    "profiles/acme/markspec.yaml": PROFILE_YAML,
    "contract.md": CONTRACT,
    "req.md": citing,
  });
  assertEquals(code, 1, stderr);
  assertStringIncludes(stderr, "UXIL-018");
});

Deno.test("uxil: compile surfaces UXIL codes for a designated corpus", async () => {
  const bad = `- [UXI_0001] Media home contract

  \`ux:media.home : screen\` offers:

  - \`/play : frobnicate\` — an unknown verb.

      Id: 01HZZZ0000000000000000010A
`;
  const { code, stdout, stderr } = await markspec(
    ["compile", "contract.md"],
    {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": MARKSPEC_YAML,
      "profiles/acme/markspec.yaml": PROFILE_YAML,
      "contract.md": bad,
    },
  );
  // `compile` never fails the process on validation-error diagnostics —
  // only a corpus-load error or `--frozen` lockfile drift does (see
  // cli/helpers.ts's compileProject and cli/commands/compile.ts). It
  // still parses and reports the graph on stdout and surfaces every
  // diagnostic, uxil included, on stderr — this is the behavior #727
  // finding 1 was about restoring: compile-backed surfaces must not
  // silently pass a corpus that `check` flags.
  assertEquals(code, 0, stderr);
  assertStringIncludes(stdout, "1 entries");
  assertStringIncludes(stderr, "UXIL-010");
});

Deno.test("uxil: without a declares designation the family is inert", async () => {
  const prose = `- [REQ_0001] Ordinary prose

  Config files live in bullets:

  - \`.gitignore\` — repository excludes.

      Id: 01HZZZ0000000000000000020A
`;
  const { code, stderr } = await markspec(
    ["check", "contract.md", "req.md"],
    {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": MARKSPEC_YAML,
      "profiles/acme/markspec.yaml": PROFILE_YAML_NO_DECLARES,
      "contract.md": CONTRACT,
      "req.md": prose,
    },
  );
  assertEquals(code, 0, stderr);
  assertEquals(stderr.includes("UXIL"), false);
});
