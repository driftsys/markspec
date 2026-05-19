/**
 * @module tests/e2e/profile_doctor_test
 *
 * E2E tests for `markspec profile show` and `markspec doctor` subcommands.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: test-project\nversion: 0.1.0\n`;
const MINIMAL_PROFILE = `id: "@acme/test"\nversion: 0.2.0\n`;
const MARKSPEC_YAML = `profiles:\n  - ./profiles/test\n`;

// ── profile show ─────────────────────────────────────────────────────

Deno.test("profile show: prints chain info", async () => {
  const { code, stdout } = await markspec(["profile", "show"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": MARKSPEC_YAML,
      "profiles/test/markspec.yaml": MINIMAL_PROFILE,
    },
  });
  assertEquals(code, 0);
  assertStringIncludes(stdout, "@acme/test");
  assertStringIncludes(stdout, "0.2.0");
  assertStringIncludes(stdout, "Active profile:");
});

Deno.test("profile show: --format json outputs structured data", async () => {
  const { code, stdout } = await markspec(
    ["profile", "show", "--format", "json"],
    {
      files: {
        "project.yaml": PROJECT_YAML,
        ".markspec.yaml": MARKSPEC_YAML,
        "profiles/test/markspec.yaml": MINIMAL_PROFILE,
      },
    },
  );
  assertEquals(code, 0);
  const data = JSON.parse(stdout);
  assertEquals(Array.isArray(data.tiers), true);
  assertEquals(data.tiers.length, 2);
  assertEquals(data.tiers[data.tiers.length - 1].id, "@acme/test");
  assertEquals(data.tiers[data.tiers.length - 1].version, "0.2.0");
});

Deno.test("profile show: opted-out project prints no-profile message", async () => {
  const { code, stderr } = await markspec(["profile", "show"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": "default-profile: false\n",
    },
  });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "no profile");
});

Deno.test("profile show: bundled default shown when no .markspec.yaml", async () => {
  const { code, stdout } = await markspec(["profile", "show"], {
    files: {
      "project.yaml": PROJECT_YAML,
    },
  });
  assertEquals(code, 0);
  assertStringIncludes(stdout, "@markspec/profile-default");
});

// ── doctor ───────────────────────────────────────────────────────────

Deno.test("doctor: clean project exits 0", async () => {
  const { code, stderr } = await markspec(["doctor"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": MARKSPEC_YAML,
      "profiles/test/markspec.yaml": MINIMAL_PROFILE,
    },
  });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "test-project");
  assertStringIncludes(stderr, "@acme/test");
});

Deno.test("doctor: --format json outputs structured data", async () => {
  const { code, stdout } = await markspec(["doctor", "--format", "json"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": MARKSPEC_YAML,
      "profiles/test/markspec.yaml": MINIMAL_PROFILE,
    },
  });
  assertEquals(code, 0);
  const data = JSON.parse(stdout);
  assertEquals(data.project.name, "test-project");
  assertEquals(data.project.version, "0.1.0");
  assertEquals(data.profile.id, "@acme/test");
  assertEquals(data.profile.version, "0.2.0");
  assertEquals(data.profile.tiers, 2);
  assertEquals(Array.isArray(data.diagnostics), true);
});

Deno.test("doctor: no project.yaml exits 1", async () => {
  const { code, stderr } = await markspec(["doctor"], {
    files: {},
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "project.yaml");
});

Deno.test("doctor: bad .markspec.yaml exits 1", async () => {
  const { code, stderr } = await markspec(["doctor"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles: [\n  unclosed`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MARKSPEC-YAML");
});

Deno.test("doctor: opted-out project still exits 0 with no-profile message", async () => {
  const { code, stderr } = await markspec(["doctor"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": "default-profile: false\n",
    },
  });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "no profile");
});

Deno.test("doctor: bundled default shown when no .markspec.yaml", async () => {
  const { code, stderr } = await markspec(["doctor"], {
    files: {
      "project.yaml": PROJECT_YAML,
    },
  });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "@markspec/profile-default");
});
