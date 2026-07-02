/**
 * @module tests/e2e/delivered_test
 *
 * E2E tests for profile-delivered documents (ADR-029). The differential
 * pair below is the feature's only end-to-end proof that injecting a
 * profile's delivered corpus into `check` actually resolves a project
 * `Satisfies:` target: the same fixture WITH `delivers:` resolves cleanly,
 * WITHOUT `delivers:` the identical target is unresolved (MSL-L006).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec, markspecInDir, markspecPersist } from "./helpers.ts";

// Minimal project.yaml (see tests/e2e/compile_git_properties_test.ts).
// `profile/` is excluded from project-wide discovery so the delivered
// corpus file isn't ALSO walked and parsed as an ordinary project file —
// it reaches the graph exactly once, via the corpus loader.
const PROJECT_YAML = `name: profile-delivers-e2e
version: 0.1.0
exclude:
  - profile/
`;

// A profile that declares two requirement-shaped types with a Satisfies
// rule from stakeholder-requirement to platform-component, so MSL-L006 has
// something real to fire against — without a declared trace rule, Stage 4
// traceability never inspects `Satisfies:` at all, which would make the
// differential pair vacuous.
function profileManifest(delivers: string): string {
  return `id: platform-arch
version: 1.2.0
markspec-schema: "1"
profile:
  types:
    platform-component:
      extends: Requirement
      display-id-pattern: "PLT_{n:04d}"
      traceability:
        Satisfies:
          target: [platform-component]
          cardinality: 0..1
          required: false
    stakeholder-requirement:
      extends: Requirement
      display-id-pattern: "STK_{n:04d}"
      traceability:
        Satisfies:
          target: [platform-component]
          cardinality: 0..1
          required: false
${delivers}`;
}

const WITH_DELIVERS = profileManifest(`  delivers:
    - path: reference/platform.md
      corpus: true
      description: Reference platform architecture
    - path: reference/guide.md
`);

const WITHOUT_DELIVERS = profileManifest("");

// Explicit `Type:` on every entry (matching tests/e2e/check_project_test.ts's
// convention): without it, `Satisfies` is a core-type-scoped attribute that
// the validator can't check pre-classification, which fires an unrelated
// MSL-T024 warning and would falsely block the "resolves cleanly" exit-0
// assertion below.
const CORPUS_MD = `- [PLT_0001] Platform core service

  The platform core service shall expose the vehicle state bus within 50 ms of a state change.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV
      Type: platform-component
`;

const GUIDE_MD = `# Integration guide\n`;

const PROJECT_MD = `- [STK_0001] Vehicle state access

  The system shall read the vehicle state from the platform core service within 100 ms.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FB0
      Type: stakeholder-requirement
      Satisfies: PLT_0001
`;

function fixture(profileYaml: string): Record<string, string> {
  return {
    "project.yaml": PROJECT_YAML,
    ".markspec.yaml": "profiles:\n  - ./profile\n",
    "profile/markspec.yaml": profileYaml,
    "profile/reference/platform.md": CORPUS_MD,
    "profile/reference/guide.md": GUIDE_MD,
    "docs/requirements.md": PROJECT_MD,
  };
}

// ---------------------------------------------------------------------------
// The non-droppable differential pair
// ---------------------------------------------------------------------------

Deno.test("check: Satisfies into delivered corpus resolves", async () => {
  const { code, stderr } = await markspec(["check"], fixture(WITH_DELIVERS));
  assertEquals(code, 0, stderr);
  assertEquals(stderr.includes("MSL-L006"), false, stderr);
});

Deno.test("check: without delivers the same target is unresolved", async () => {
  const { code, stderr } = await markspec(
    ["check"],
    fixture(WITHOUT_DELIVERS),
  );
  // MSL-L006 is a warning (see core/validator/traceability.ts) — a
  // warnings-only run exits 2, not 1.
  assertStringIncludes(stderr, "MSL-L006");
  assertEquals(code, 2, stderr);
});

// ---------------------------------------------------------------------------
// Collision + missing-corpus-file gates
// ---------------------------------------------------------------------------

Deno.test("check: project entry colliding with corpus ID is MSL-R014", async () => {
  const files = fixture(WITH_DELIVERS);
  files["docs/collide.md"] = `- [PLT_0001] My own platform entry

  The colliding entry shall report a distinct status within 10 ms.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FC0
      Type: platform-component
`;
  const { code, stderr } = await markspec(["check"], files);
  assertEquals(code, 1, stderr);
  assertStringIncludes(stderr, "MSL-R014");
  assertStringIncludes(stderr, "platform-arch@1.2.0");
});

Deno.test("check: missing corpus file is a PROFILE-DELIVERS-001 error", async () => {
  const files = fixture(WITH_DELIVERS);
  delete files["profile/reference/platform.md"];
  const { code, stderr } = await markspec(["check"], files);
  assertEquals(code, 1, stderr);
  assertStringIncludes(stderr, "PROFILE-DELIVERS-001");
});

// ---------------------------------------------------------------------------
// Lock gate stays corpus-blind (MSL-L212 regression)
// ---------------------------------------------------------------------------

// A corpus that itself carries a trace edge (PLT_0002 → PLT_0001).
// `markspec lock` never counts corpus edges (the corpus lives outside
// discovery scope), so if `check`'s MSL-L212 gate counted them, it would
// report a drift that `markspec lock` can never fix.
const CORPUS_WITH_EDGE_MD = `${CORPUS_MD}
- [PLT_0002] Platform diagnostics service

  The platform diagnostics service shall report the vehicle state bus health within 200 ms.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FA2
      Type: platform-component
      Satisfies: PLT_0001
`;

Deno.test("check: lockfile gate ignores corpus edges (no MSL-L212)", async () => {
  const files = fixture(WITH_DELIVERS);
  files["profile/reference/platform.md"] = CORPUS_WITH_EDGE_MD;
  // 1. Generate a lockfile — lock counts only project edges (the corpus
  //    is outside discovery scope), so it pins 1 edge.
  const run = await markspecPersist(["lock"], {
    files,
    permissions: ["--allow-net", "--allow-env", "--allow-run"],
  });
  try {
    assertEquals(run.code, 0, `lock failed: ${run.stderr}`);
    // 2. check must not count the corpus-internal PLT_0002 → PLT_0001
    //    edge against the lockfile's project-only edge hash.
    const { code, stderr } = await markspecInDir(run.dir, ["check"]);
    assertEquals(stderr.includes("MSL-L212"), false, stderr);
    assertEquals(code, 0, stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// compileProject wiring — corpus entries reach every graph-consuming command
// ---------------------------------------------------------------------------

Deno.test("show: a corpus entry is visible without naming its file", async () => {
  const run = await markspecPersist(
    ["show", "PLT_0001", "docs/requirements.md"],
    { files: fixture(WITH_DELIVERS) },
  );
  try {
    assertEquals(run.code, 0, run.stderr);
    assertStringIncludes(run.stdout, "PLT_0001");
    // The Source line renders the ADR-029 stable form — profile label +
    // manifest-relative path — never the raw on-disk absolute path.
    assertStringIncludes(
      run.stdout,
      "platform-arch@1.2.0:reference/platform.md",
    );
    assertEquals(
      run.stdout.includes(`${run.dir}/profile/reference/platform.md`),
      false,
      `raw corpus path leaked into show output:\n${run.stdout}`,
    );
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Task 6 — show Origin line, profile show delivers block, doctor health
// ---------------------------------------------------------------------------

Deno.test("show: corpus entry carries Origin line", async () => {
  const { code, stdout } = await markspec(
    ["show", "PLT_0001", "docs/requirements.md"],
    fixture(WITH_DELIVERS),
  );
  assertEquals(code, 0);
  assertStringIncludes(stdout, "Origin: platform-arch@1.2.0");
});

Deno.test("profile show: lists delivered documents", async () => {
  const { code, stdout } = await markspec(
    ["profile", "show"],
    fixture(WITH_DELIVERS),
  );
  assertEquals(code, 0);
  assertStringIncludes(stdout, "Delivered documents");
  assertStringIncludes(stdout, "reference/platform.md");
  assertStringIncludes(stdout, "corpus");
  assertStringIncludes(stdout, "reference/guide.md");
});

// ---------------------------------------------------------------------------
// Task 7 — origin in export + reports
// ---------------------------------------------------------------------------

Deno.test("export json: corpus entries carry origin", async () => {
  const { code, stdout } = await markspec(
    ["export", "json", "docs/requirements.md"],
    fixture(WITH_DELIVERS),
  );
  assertEquals(code, 0);
  assertStringIncludes(stdout, `"profileId": "platform-arch"`);
});

Deno.test("export csv: origin column distinguishes corpus from project", async () => {
  const { code, stdout } = await markspec(
    ["export", "csv", "docs/requirements.md"],
    fixture(WITH_DELIVERS),
  );
  assertEquals(code, 0);
  const lines = stdout.split("\n").filter((l) => l.length > 0);
  assertStringIncludes(lines[0], ",origin");
  const corpusRow = lines.find((l) => l.startsWith("PLT_0001"));
  const projectRow = lines.find((l) => l.startsWith("STK_0001"));
  assertEquals(corpusRow?.endsWith(",platform-arch@1.2.0"), true, corpusRow);
  assertEquals(projectRow?.endsWith(",project"), true, projectRow);
});

Deno.test("profile show: missing corpus file is surfaced, not '0 entries'", async () => {
  // `profile show` does NOT route through compileProject, so a missing
  // corpus file (PROFILE-DELIVERS-001, fatal everywhere else) is reachable
  // here — it must render as an explicit issue, never as a silently-empty
  // `corpus   0 entries` row. Exit code stays 0: profile show is
  // informational.
  const files = fixture(WITH_DELIVERS);
  delete files["profile/reference/platform.md"];
  const { code, stdout } = await markspec(["profile", "show"], files);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "MISSING (PROFILE-DELIVERS-001)");
  assertEquals(
    stdout.includes("0 entries"),
    false,
    `missing corpus file silently rendered as 0 entries:\n${stdout}`,
  );
});
