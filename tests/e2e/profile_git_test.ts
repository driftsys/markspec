/**
 * @module tests/e2e/profile_git_test
 *
 * E2E tests for `git+file://…#<tag>` profile specifiers, using real `git`.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";
import { setupGitFixture } from "./helpers_git.ts";

const PROJECT_YAML = `name: phase4-e2e\nversion: 0.1.0\n`;

const REQ_MD =
  `# Example\n\n- [REQ-0001] A requirement\n\n  Body text.\n\n      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n`;

const BASE_PROFILE_YAML = `id: "@acme/phase4-base"
version: 1.0.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`;

// The CLI subprocess needs --allow-run=git (to invoke git) and --allow-env
// (git reads HOME / GIT_CONFIG_*).
const PERMISSIONS = ["--allow-run=git", "--allow-env"];

Deno.test("profile git e2e: top-level git specifier clones and validates cleanly", async () => {
  const gitTempDir = await Deno.makeTempDir();
  try {
    const fixture = await setupGitFixture({
      workspaceDir: gitTempDir,
      name: "base",
      files: { "markspec.yaml": BASE_PROFILE_YAML },
      tag: "v1.0.0",
    });

    const { code, stderr } = await markspec(["validate", "req.md"], {
      files: {
        "project.yaml": PROJECT_YAML,
        ".markspec.yaml":
          `profiles:\n  - "git+${fixture.url}#${fixture.tag}"\n`,
        "req.md": REQ_MD,
      },
      permissions: PERMISSIONS,
    });

    assertEquals(code, 0, `stderr: ${stderr}`);
    const err = stderr.split("\n").filter((l) =>
      l.includes("PROFILE-LOAD") || l.includes("PROFILE-MERGE")
    );
    assertEquals(err, []);
  } finally {
    await Deno.remove(gitTempDir, { recursive: true });
  }
});

Deno.test("profile git e2e: unreachable repo surfaces PROFILE-LOAD-001", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml":
        `profiles:\n  - "git+file:///nonexistent-bare-repo-${crypto.randomUUID()}.git#v1.0.0"\n`,
      "req.md": REQ_MD,
    },
    permissions: PERMISSIONS,
  });

  assertEquals(code, 1, `stderr: ${stderr}`);
  assertStringIncludes(stderr, "PROFILE-LOAD-001");
});

Deno.test("profile git e2e: bad tag emits PROFILE-LOAD-001", async () => {
  const gitTempDir = await Deno.makeTempDir();
  try {
    const fixture = await setupGitFixture({
      workspaceDir: gitTempDir,
      name: "base",
      files: { "markspec.yaml": BASE_PROFILE_YAML },
      tag: "v1.0.0",
    });

    const { code, stderr } = await markspec(["validate", "req.md"], {
      files: {
        "project.yaml": PROJECT_YAML,
        ".markspec.yaml": `profiles:\n  - "git+${fixture.url}#v99.0.0"\n`,
        "req.md": REQ_MD,
      },
      permissions: PERMISSIONS,
    });

    assertEquals(code, 1, `stderr: ${stderr}`);
    assertStringIncludes(stderr, "PROFILE-LOAD-001");
  } finally {
    await Deno.remove(gitTempDir, { recursive: true });
  }
});
