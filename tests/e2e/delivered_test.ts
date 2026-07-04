/**
 * @module tests/e2e/delivered_test
 *
 * E2E tests for profile-delivered documents (ADR-030). The differential
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

  The system shall read the vehicle state within 100 ms.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FB0
      Type: stakeholder-requirement
      Satisfies: PLT_0001
`;

function fixture(profileYaml: string): Record<string, string> {
  return {
    "project.yaml": PROJECT_YAML,
    ".markspec.yaml": "profiles:\n  - ./profile\nexclude:\n  - profile/\n",
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
    // The Source line renders the ADR-030 stable form — profile label +
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

// ---------------------------------------------------------------------------
// Prose lint is corpus-blind (review fix 1) + --strict stays corpus-blind
// (review fix 2)
// ---------------------------------------------------------------------------

// A declared `requirement` type with a `REQ_` pattern gives entries that BOTH
// classify cleanly (no MSL-T003) AND are prose-scoped: `REQ_`-prefixed IDs
// resolve to Requirement via step-4 prefix inference, independent of the
// profile (the #675 fix additionally scopes profile-only-typed entries — see
// the "profile-typed entry" test). "shall be exposed" trips MSL-Q300 (passive).
const WITH_DELIVERS_AND_REQ_TYPE = profileManifest(`    requirement:
      extends: Requirement
      display-id-pattern: "REQ_{n:04d}"
  delivers:
    - path: reference/platform.md
      corpus: true
      description: Reference platform architecture
    - path: reference/guide.md
`);

// Extra corpus entry with a passive normative sentence. Advisory prose lint
// must never run on delivered corpus — a consumer cannot fix an upstream
// profile's prose.
const PASSIVE_CORPUS_MD = `${CORPUS_MD}
- [REQ_0900] Bus exposure statement

  The bus shall be exposed by the service.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FA9
`;

// Project entry tripping the identical rule, proving prose lint still runs
// on project entries — this isn't a blanket disable of MSL-Q300.
const PASSIVE_PROJECT_MD = `- [REQ_0901] Diagnostics access

  The fault log shall be exposed by the service.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FD0
`;

Deno.test("check: prose lint runs on project entries but never on delivered corpus", async () => {
  const files = fixture(WITH_DELIVERS_AND_REQ_TYPE);
  files["profile/reference/platform.md"] = PASSIVE_CORPUS_MD;
  files["docs/passive.md"] = PASSIVE_PROJECT_MD;
  const { code, stderr } = await markspec(["check"], files);
  const proseLines = stderr.split("\n").filter((l) => l.includes("MSL-Q"));
  // Project-side passive sentence still fires — prose lint isn't disabled
  // outright, only filtered by origin.
  assertEquals(
    proseLines.some((l) => l.includes("passive.md") && l.includes("MSL-Q300")),
    true,
    `project-side MSL-Q300 missing:\n${stderr}`,
  );
  // The corpus file's identical passive sentence must never surface.
  assertEquals(
    proseLines.filter((l) => l.includes("platform.md")),
    [],
    `corpus-located prose finding leaked into check output:\n${stderr}`,
  );
  assertEquals(code, 2, stderr); // advisory only — warnings, no errors
});

Deno.test("check --strict: corpus-attributed warning is not promoted to error", async () => {
  const files = fixture(WITH_DELIVERS);
  // A corpus-internal unresolved trace target (MSL-L006, warning severity)
  // — same fixture pattern as the lock-gate test above, but the target
  // doesn't exist anywhere, so it can never resolve.
  files["profile/reference/platform.md"] = `${CORPUS_MD}
- [PLT_0002] Platform diagnostics service

  The platform diagnostics service shall report the vehicle state bus health within 200 ms.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FA2
      Type: platform-component
      Satisfies: PLT_9999
`;
  const { code, stderr } = await markspec(["check", "--strict"], files);
  assertStringIncludes(stderr, "MSL-L006");
  // --strict must not promote the attributed warning to an error the
  // consumer has no way to fix.
  assertEquals(code, 2, stderr);
});

// ---------------------------------------------------------------------------
// Determinism (spec §10, review fix 5)
// ---------------------------------------------------------------------------

Deno.test("export json: delivered corpus output is deterministic across runs", async () => {
  // Two runs against the SAME directory — file observed-facts (mtime)
  // are then identical, so any stdout difference is real nondeterminism
  // in corpus injection order or graph serialization.
  const run1 = await markspecPersist(
    ["export", "json", "docs/requirements.md"],
    { files: fixture(WITH_DELIVERS) },
  );
  try {
    assertEquals(run1.code, 0, run1.stderr);
    const run2 = await markspecInDir(run1.dir, [
      "export",
      "json",
      "docs/requirements.md",
    ]);
    assertEquals(run2.code, 0, run2.stderr);
    assertEquals(run1.stdout, run2.stdout);
  } finally {
    await Deno.remove(run1.dir, { recursive: true });
  }
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

// ---------------------------------------------------------------------------
// #675 — prose lint reaches profile-typed entries (isProseScope threads profile)
// ---------------------------------------------------------------------------

// A project entry classified purely by a profile type: `platform-component`
// extends Requirement but its `PLT_` prefix is NOT a core-recognizable one, so
// only the profile's `extends:` chain can resolve it to a Specification
// descendant. Before the fix `isProseScope` called `resolvedCoreType` WITHOUT
// the profile, so this entry never entered prose scope and its passive sentence
// was silently skipped by both `check`'s advisory gate and `markspec lint`.
const PROFILE_TYPED_PASSIVE_MD = `- [PLT_0500] State bus exposure

  The state bus shall be exposed by the service.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5F50
      Type: platform-component
`;

Deno.test("check: prose lint reaches a profile-typed entry (#675)", async () => {
  // No corpus needed — this is a pure classification bug. WITHOUT_DELIVERS
  // keeps the profile (so `platform-component` is declared) without injecting
  // any corpus, and we drop the base fixture's requirements.md so PLT_0500 is
  // the only project entry under scrutiny.
  const files = fixture(WITHOUT_DELIVERS);
  delete files["docs/requirements.md"];
  files["docs/prose675.md"] = PROFILE_TYPED_PASSIVE_MD;
  const { code, stderr } = await markspec(["check"], files);
  assertStringIncludes(stderr, "MSL-Q300");
  assertStringIncludes(stderr, "prose675.md");
  assertEquals(code, 2, stderr); // advisory prose warning only
});

// ---------------------------------------------------------------------------
// #674 finding 1 — a $Identifier defined only in the corpus still silences
// Q500 in project prose (the Q500 additive-index contract survives corpus
// origin-filtering)
// ---------------------------------------------------------------------------

// Corpus entry defines `$Framebus`; the project entry's prose mentions the bare
// capitalized word "Framebus". Pre-filtering corpus entries out of `runLint`'s
// input dropped `$Framebus` from `buildIdentifierIndex`, so the project mention
// tripped a spurious `xref-glossary-undefined` (MSL-Q500) warning.
const CORPUS_DEFINES_IDENTIFIER_MD = `- [PLT_0001] Platform core service

  The platform core service exposes $Framebus for vehicle state distribution.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV
      Type: platform-component
`;

const PROJECT_USES_IDENTIFIER_MD = `- [REQ_0500] Gateway publication

  The gateway shall publish to the Framebus within 10 ms.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5F51
`;

Deno.test("check: a corpus $Identifier silences Q500 in project prose (#674 f1)", async () => {
  const files = fixture(WITH_DELIVERS_AND_REQ_TYPE);
  files["profile/reference/platform.md"] = CORPUS_DEFINES_IDENTIFIER_MD;
  files["docs/uses.md"] = PROJECT_USES_IDENTIFIER_MD;
  const { code, stderr } = await markspec(["check"], files);
  // "Framebus" resolves via the corpus-defined $Framebus → no MSL-Q500 against
  // the project entry that mentions it.
  const q500Lines = stderr.split("\n").filter((l) => l.includes("MSL-Q500"));
  assertEquals(
    q500Lines.filter((l) => l.includes("uses.md")),
    [],
    `corpus $Identifier failed to silence Q500 in project prose:\n${stderr}`,
  );
  // Belt-and-braces: the Q500 message quotes the offending phrase, so
  // "'Framebus'" must appear nowhere in the output.
  assertEquals(
    stderr.includes("'Framebus'"),
    false,
    `Framebus tripped an xref warning despite the corpus $Identifier:\n${stderr}`,
  );
  // The project prose carries an unrelated EARS advisory (MSL-Q101), so the
  // run is warnings-only (exit 2), never an error — the corpus filter did not
  // turn an upstream identifier into a project error.
  assertEquals(code, 2, stderr);
});

// ---------------------------------------------------------------------------
// #674 finding 2 — standalone `markspec lint` never runs prose analysis on
// delivered-corpus entries (ADR-030 §D4)
// ---------------------------------------------------------------------------

Deno.test("lint: prose runs on project entries but never on corpus (#674 f2)", async () => {
  const files = fixture(WITH_DELIVERS_AND_REQ_TYPE);
  files["profile/reference/platform.md"] = PASSIVE_CORPUS_MD;
  files["docs/passive.md"] = PASSIVE_PROJECT_MD;
  const { code, stderr } = await markspec(["lint"], files);
  const proseLines = stderr.split("\n").filter((l) => l.includes("MSL-Q"));
  // Project-side passive sentence still fires — lint isn't disabled outright.
  assertEquals(
    proseLines.some((l) => l.includes("passive.md") && l.includes("MSL-Q300")),
    true,
    `project-side MSL-Q300 missing from lint:\n${stderr}`,
  );
  // The corpus file's passive sentence must never surface.
  assertEquals(
    proseLines.filter((l) => l.includes("platform.md")),
    [],
    `corpus prose finding leaked into lint output:\n${stderr}`,
  );
  assertEquals(code, 2, stderr); // advisory warnings only
});

// ---------------------------------------------------------------------------
// #674 finding 4 — export/compile --format json surface corpus-load warnings
// in the serialized diagnostics (machine consumers parse json, not stderr)
// ---------------------------------------------------------------------------

Deno.test("export json: corpus-load warning reaches serialized diagnostics (#674 f4)", async () => {
  const files = fixture(WITH_DELIVERS);
  // Drop the docs-only guide.md → PROFILE-DELIVERS-002 (warning severity, not
  // fatal, so compile still runs and export exits 0).
  delete files["profile/reference/guide.md"];
  const { code, stdout, stderr } = await markspec(
    ["export", "json", "docs/requirements.md"],
    files,
  );
  assertEquals(code, 0, stderr);
  assertStringIncludes(stdout, "PROFILE-DELIVERS-002");
});

// ---------------------------------------------------------------------------
// #700: delivered documents are read-only. A write command (`fmt`, `insert`)
// given an explicit path that resolves to a profile-delivered document must
// refuse rather than overwrite the profile package's file.
// ---------------------------------------------------------------------------

Deno.test("fmt: refuses to overwrite an explicitly-named delivered corpus file (#700)", async () => {
  const { code, stderr } = await markspec(
    ["fmt", "profile/reference/platform.md"],
    fixture(WITH_DELIVERS),
  );
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "read-only");
});

Deno.test("insert: refuses to append to an explicitly-named delivered corpus file (#700)", async () => {
  const { code, stderr } = await markspec(
    ["insert", "stakeholder-requirement", "profile/reference/platform.md"],
    fixture(WITH_DELIVERS),
  );
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "read-only");
});
