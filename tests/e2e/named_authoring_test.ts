/**
 * @module tests/e2e/named_authoring_test
 *
 * E2E for #598 — the mint/scaffold CLI paths are named-aware. A named
 * (counter-less) type like `sw-component: "SWC_{name}"` is not mintable, but
 * `next-id` / `create` / `insert` must offer a placeholder-name scaffold and a
 * clear "author the identifier yourself" note instead of the misleading
 * "does not contain a recognised number placeholder" error.
 *
 * The scaffolded placeholder MUST be slug-valid (`SWC_NAME`, not `SWC_<name>`):
 * an angle-bracket token is parsed as inline HTML, so the block yields zero
 * entries and fails `markspec check` (#613). The `insert → fmt → check` test
 * below pins that the canonical agent write loop survives.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspec, markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT_YAML = `name: named-authoring-e2e\nversion: 0.1.0\n`;
const MARKSPEC_YAML = `profiles:\n  - ./profiles/acme\n`;
const PROFILE_YAML = `id: "@acme/named"
markspec-schema: "1"
version: 0.1.0
profile:
  types:
    sw-component:
      extends: SoftwareComponent
      display-id-pattern: "SWC_{name}"
      display-id-pattern-enforcement: off
`;

const FILES = {
  "project.yaml": PROJECT_YAML,
  ".markspec.yaml": MARKSPEC_YAML,
  "profiles/acme/markspec.yaml": PROFILE_YAML,
  "components.md": `# Components\n`,
  // A non-listing filename for the write-loop test, so the §6.3
  // component-listing rule (orthogonal to the scaffold) does not interfere.
  "parts.md": `# Parts\n`,
};

Deno.test("#598 e2e: next-id on a named type prints a placeholder template, not an error", async () => {
  const { code, stdout, stderr } = await markspec(
    ["next-id", "sw-component", "components.md"],
    { files: FILES },
  );
  // Before #598: exit 1 with "does not contain a recognised number placeholder".
  assertEquals(code, 0, stderr);
  assertStringIncludes(stdout, "SWC_NAME");
  assertStringIncludes(stderr.toLowerCase(), "named");
});

Deno.test("#598 e2e: create on a named type scaffolds a placeholder-name block", async () => {
  const { code, stdout, stderr } = await markspec(
    ["create", "sw-component", "components.md"],
    { files: FILES },
  );
  assertEquals(code, 0, stderr);
  assertStringIncludes(stdout, "[SWC_NAME]");
  assertEquals(stdout.includes("[SWC_<name>]"), false);
  assertStringIncludes(stdout, "Type: sw-component");
});

Deno.test("#613 e2e: next-id --format json flags a named type with a template field", async () => {
  const { code, stdout } = await markspec(
    ["next-id", "sw-component", "components.md", "--format", "json"],
    { files: FILES },
  );
  assertEquals(code, 0);
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  // Structured consumers get an explicit discriminator, not a placeholder in
  // the `displayId` slot.
  assertEquals(parsed.named, true);
  assertEquals(parsed.template, "SWC_NAME");
  assertEquals("displayId" in parsed, false);
});

Deno.test("#613 e2e: insert → fmt → check on a named type produces a checkable block", async () => {
  const run = await markspecPersist(
    ["insert", "sw-component", "parts.md"],
    { files: FILES, permissions: ["--allow-env", "--allow-run"] },
  );
  try {
    assertEquals(run.code, 0, run.stderr);
    const inserted = await Deno.readTextFile(join(run.dir, "parts.md"));
    assertStringIncludes(inserted, "[SWC_NAME]");
    assertEquals(inserted.includes("[SWC_<name>]"), false);

    const fmt = await markspecInDir(
      run.dir,
      ["fmt", "parts.md"],
      ["--allow-env", "--allow-run"],
    );
    assertEquals(fmt.code, 0, fmt.stderr);

    // The canonical write loop must end clean — angle-bracket scaffolds failed
    // here with MSL-P003 (#613).
    const check = await markspecInDir(
      run.dir,
      ["check", "parts.md"],
      ["--allow-env", "--allow-run"],
    );
    assertEquals(check.code, 0, check.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});
