/**
 * @module tests/e2e/feature_file_test
 *
 * Blackbox tests for `.feature` files as entry sources (epic #915, Case B):
 * discovery, `check`, `compile`, `lock` and `lint`. Parity for headerless
 * `.feature` files lives in `feature_file_parity_test.ts`.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspec, markspecInDir, markspecPersist } from "./helpers.ts";

const LOCK_PERMISSIONS = ["--allow-net", "--allow-env", "--allow-run"];

const STK = `# Stakeholder requirements

- [STK_BRK_0001] Stop the vehicle

  The vehicle shall stop when the driver brakes.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

/** The worked example of the design: a headed Feature and a headed Scenario. */
const BRAKE_FEATURE = `# language: en
# [REQ_BRK_0011] Emergency braking for close obstacles
#
# The braking controller shall start braking when the radar detects an
# obstacle closer than 40 m.
#
# Satisfies: STK_BRK_0001
# Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
Feature: Emergency braking

  Background:
    Given the vehicle speed is 60 km/h

  Scenario: Brake at 20 m
    When an obstacle appears at 20 m
    Then braking starts within 200 ms

  # [TST_BRK_0013] Brake command timing on the test bench
  #
  # Verifies: REQ_BRK_0011 [Brake at 20 m]
  # Id: 01HGW2Q8MNP3RSTVWXYZABCDEH
  Scenario: Brake command timing
    When the target is placed at 20 m
    Then the brake command is sent within 200 ms
`;

// Trace attributes must be declared by a profile, or every entry that uses
// one gets an MSL-A005 warning.
const PROFILE_YAML = `id: "@acme/brk"
version: 0.1.0
markspec-schema: "1"
profile:
  types:
    stakeholder-requirement:
      extends: Requirement
      display-id-pattern: "STK_BRK_{n:04d}"
    requirement:
      extends: Requirement
      display-id-pattern: "REQ_BRK_{n:04d}"
      traceability:
        Satisfies:
          target: [stakeholder-requirement]
          cardinality: 0..3
          required: false
    test:
      extends: Test
      display-id-pattern: "TST_BRK_{n:04d}"
      traceability:
        Verifies:
          target: [requirement]
          cardinality: 0..3
          required: false
`;

const BASE: Record<string, string> = {
  "project.yaml": "name: brk\nversion: 0.1.0\n",
  ".markspec.yaml": "profiles:\n  - ./profiles/brk\n",
  "profiles/brk/markspec.yaml": PROFILE_YAML,
  "docs/stk.md": STK,
};

const withFeature = (
  extra: Record<string, string> = {},
): Record<string, string> => ({
  ...BASE,
  "features/brake.feature": BRAKE_FEATURE,
  ...extra,
});

Deno.test("check: bare run finds a .feature entry", async () => {
  const { code, stderr } = await markspec(["check"], {
    files: withFeature(),
  });
  assertEquals(code, 0, stderr);
  // docs/stk.md plus features/brake.feature.
  assertStringIncludes(stderr, "2 file(s) under");
});

Deno.test("check: an unresolved Satisfies in a .feature header is reported", async () => {
  const { code, stderr } = await markspec(["check"], {
    files: withFeature({
      "features/brake.feature": BRAKE_FEATURE.replace(
        "Satisfies: STK_BRK_0001",
        "Satisfies: STK_BRK_9999",
      ),
    }),
  });
  assertEquals(code !== 0, true, stderr);
  assertStringIncludes(stderr, "STK_BRK_9999");
  assertStringIncludes(stderr, "brake.feature");
});

Deno.test("check: explicit .feature path", async () => {
  const { code, stderr } = await markspec(
    ["check", "features/brake.feature"],
    { files: withFeature() },
  );
  assertEquals(code, 0, stderr);
});

Deno.test("check: directory argument expands to .feature files", async () => {
  const { code, stderr } = await markspec(["check", "features"], {
    files: withFeature({
      "features/bad.feature": BRAKE_FEATURE
        .replace("REQ_BRK_0011", "REQ_BRK_0012")
        .replace("Satisfies: STK_BRK_0001", "Satisfies: STK_BRK_9999")
        .replace(/# \[TST_BRK_0013\][^\n]*\n(#[^\n]*\n)+/, ""),
    }),
  });
  assertEquals(code !== 0, true, stderr);
  assertStringIncludes(stderr, "bad.feature");
});

Deno.test("check: .gitignore and exclude: are honoured for .feature files", async () => {
  const broken = BRAKE_FEATURE
    .replace("REQ_BRK_0011", "REQ_BRK_0020")
    .replace("Satisfies: STK_BRK_0001", "Satisfies: STK_BRK_9999")
    .replace(/# \[TST_BRK_0013\][^\n]*\n(#[^\n]*\n)+/, "");
  const { code, stderr } = await markspec(["check"], {
    files: withFeature({
      ".gitignore": "ignored/\n",
      ".markspec.yaml":
        "profiles:\n  - ./profiles/brk\nexclude:\n  - legacy/\n",
      "ignored/x.feature": broken,
      "legacy/y.feature": broken,
    }),
  });
  assertEquals(code, 0, stderr);
  assertEquals(stderr.includes("STK_BRK_9999"), false, stderr);
  assertStringIncludes(stderr, "2 file(s) under");
});

Deno.test("check: MSL-B063 on a headed Test scenario with an action and no Then", async () => {
  const { code, stderr } = await markspec(["check"], {
    files: withFeature({
      "features/brake.feature": BRAKE_FEATURE.replace(
        "    Then the brake command is sent within 200 ms\n",
        "    Then the brake command is sent within 200 ms\n" +
          "    When the target is removed\n",
      ),
    }),
  });
  assertEquals(code, 2, stderr);
  assertStringIncludes(stderr, "MSL-B063");
  // The last action is line 25 of the file.
  assertStringIncludes(stderr, "brake.feature:25");
});

Deno.test("check: Verifies locator to an unheaded scenario resolves (no MSL-L007)", async () => {
  const { code, stderr } = await markspec(["check"], { files: withFeature() });
  assertEquals(code, 0, stderr);
  assertEquals(stderr.includes("MSL-L007"), false, stderr);
});

Deno.test("check: a .feature entry gets no late-stage type inference warning", async () => {
  const { stderr } = await markspec(["check"], { files: withFeature() });
  assertEquals(stderr.includes("MSL-T021"), false, stderr);
});

Deno.test("compile: entries from .feature carry source.kind feature-file", async () => {
  const { code, stdout, stderr } = await markspec(
    [
      "compile",
      "--format",
      "json",
      "docs/stk.md",
      "features/brake.feature",
    ],
    { files: withFeature() },
  );
  assertEquals(code, 0, stderr);
  const compiled = JSON.parse(stdout) as {
    entries: Record<string, { source: { kind: string; node?: string } }>;
  };
  assertEquals(Object.keys(compiled.entries).sort(), [
    "REQ_BRK_0011",
    "STK_BRK_0001",
    "TST_BRK_0013",
  ]);
  assertEquals(compiled.entries.REQ_BRK_0011.source, {
    kind: "feature-file",
    node: "feature",
  });
  assertEquals(compiled.entries.TST_BRK_0013.source, {
    kind: "feature-file",
    node: "scenario",
  });
});

Deno.test("lock then check: adding a .feature entry drifts the edges hash until relocked", async () => {
  const run = await markspecPersist(["lock"], {
    files: BASE,
    permissions: LOCK_PERMISSIONS,
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    const before = await markspecInDir(run.dir, ["check"], LOCK_PERMISSIONS);
    assertEquals(before.stderr.includes("MSL-L212"), false, before.stderr);

    await Deno.mkdir(join(run.dir, "features"));
    await Deno.writeTextFile(
      join(run.dir, "features", "brake.feature"),
      BRAKE_FEATURE,
    );
    const drift = await markspecInDir(run.dir, ["check"], LOCK_PERMISSIONS);
    assertEquals(drift.code, 1, drift.stderr);
    assertStringIncludes(drift.stderr, "MSL-L212");

    const relock = await markspecInDir(run.dir, ["lock"], LOCK_PERMISSIONS);
    assertEquals(relock.code, 0, relock.stderr);
    const lock = await Deno.readTextFile(join(run.dir, "markspec.lock"));
    // The Satisfies edge of the Feature entry (ULID ...EG).
    assertStringIncludes(
      lock,
      'source-ulid     = "01HGW2Q8MNP3RSTVWXYZABCDEG"',
    );
    assertStringIncludes(lock, "edges-count = 1");
    const after = await markspecInDir(run.dir, ["check"], LOCK_PERMISSIONS);
    assertEquals(after.stderr.includes("MSL-L212"), false, after.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("lint: runs on .feature entries without crashing", async () => {
  const { code, stderr } = await markspec(["lint"], { files: withFeature() });
  assertEquals(code === 0 || code === 2, true, stderr);
  assertEquals(stderr.includes("error:"), false, stderr);
  assertEquals(stderr.includes("TypeError"), false, stderr);
});

/** The worked example without its Id lines (`fmt` has not stamped it). */
const UNSTAMPED_FEATURE = BRAKE_FEATURE.replace(/^\s*# Id: .*\n/gm, "");

Deno.test("check: a headed .feature entry without an Id reports MSL-F010 only", async () => {
  const { code, stderr } = await markspec(["check"], {
    files: withFeature({ "features/brake.feature": UNSTAMPED_FEATURE }),
  });
  assertEquals(code, 1, stderr);
  assertStringIncludes(stderr, "MSL-F010");
  assertStringIncludes(stderr, "brake.feature");
  // The Id-related and other diagnostics are not the F010 finding's business.
  assertEquals(stderr.includes("MSL-F011"), false, stderr);
});

Deno.test("fmt --check: exits 1 for a .feature entry without an Id and does not write", async () => {
  const run = await markspecPersist([
    "fmt",
    "--check",
    "features/brake.feature",
  ], {
    files: withFeature({ "features/brake.feature": UNSTAMPED_FEATURE }),
  });
  try {
    assertEquals(run.code, 1, run.stderr);
    assertEquals(
      await Deno.readTextFile(join(run.dir, "features", "brake.feature")),
      UNSTAMPED_FEATURE,
    );
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("fmt --check: exits 0 for a stamped .feature file", async () => {
  const { code, stderr } = await markspec(
    ["fmt", "--check", "features/brake.feature"],
    { files: withFeature() },
  );
  assertEquals(code, 0, stderr);
});

Deno.test("fmt then check: stamps Ids in a .feature file, only Id lines change, second run is idempotent", async () => {
  const run = await markspecPersist(["fmt", "features/brake.feature"], {
    files: withFeature({ "features/brake.feature": UNSTAMPED_FEATURE }),
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    const path = join(run.dir, "features", "brake.feature");
    const stamped = await Deno.readTextFile(path);
    const before = UNSTAMPED_FEATURE.split("\n");
    const added = stamped.split("\n").filter((l) => !before.includes(l));
    assertEquals(added.length, 2);
    for (const line of added) {
      assertEquals(/# Id: [0-9A-Z]{26}$/.test(line), true);
    }
    assertEquals(stamped.split("\n").length, before.length + 2);

    const again = await markspecInDir(run.dir, [
      "fmt",
      "features/brake.feature",
    ]);
    assertEquals(again.code, 0, again.stderr);
    assertEquals(await Deno.readTextFile(path), stamped);

    const check = await markspecInDir(run.dir, ["check"]);
    assertEquals(check.code, 0, check.stderr);
    assertEquals(check.stderr.includes("MSL-F010"), false, check.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("fmt: bare project scope stamps a .feature file", async () => {
  const run = await markspecPersist(["fmt"], {
    files: withFeature({ "features/brake.feature": UNSTAMPED_FEATURE }),
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    const stamped = await Deno.readTextFile(
      join(run.dir, "features", "brake.feature"),
    );
    assertEquals(/# Id: [0-9A-Z]{26}/.test(stamped), true);
    const check = await markspecInDir(run.dir, ["check"]);
    assertEquals(check.code, 0, check.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("fmt: a .feature file that does not parse is left byte-identical", async () => {
  const broken = UNSTAMPED_FEATURE + "Feature: Again\n";
  const run = await markspecPersist(["fmt", "features/brake.feature"], {
    files: withFeature({ "features/brake.feature": broken }),
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    assertEquals(
      await Deno.readTextFile(join(run.dir, "features", "brake.feature")),
      broken,
    );
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("fmt: a headerless .feature file is left byte-identical", async () => {
  const plain =
    "Feature: Plain\n\n  # a comment\n  Scenario: S\n    Given a\n    Then b\n";
  const run = await markspecPersist(["fmt"], {
    files: withFeature({ "features/plain.feature": plain }),
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    assertEquals(
      await Deno.readTextFile(join(run.dir, "features", "plain.feature")),
      plain,
    );
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});
