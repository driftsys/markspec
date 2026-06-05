/**
 * @module tests/e2e/named_authoring_test
 *
 * E2E for #598 — the mint/scaffold CLI paths are named-aware. A named
 * (counter-less) type like `sw-component: "SWC_{name}"` is not mintable, but
 * `next-id` / `create` / `insert` must offer a placeholder-name scaffold and a
 * clear "author the identifier yourself" note instead of the misleading
 * "does not contain a recognised number placeholder" error.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

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
};

Deno.test("#598 e2e: next-id on a named type prints a placeholder template, not an error", async () => {
  const { code, stdout, stderr } = await markspec(
    ["next-id", "sw-component", "components.md"],
    { files: FILES },
  );
  // Before #598: exit 1 with "does not contain a recognised number placeholder".
  assertEquals(code, 0, stderr);
  assertStringIncludes(stdout, "SWC_<name>");
  assertStringIncludes(stderr.toLowerCase(), "named");
});

Deno.test("#598 e2e: create on a named type scaffolds a placeholder-name block", async () => {
  const { code, stdout, stderr } = await markspec(
    ["create", "sw-component", "components.md"],
    { files: FILES },
  );
  assertEquals(code, 0, stderr);
  assertStringIncludes(stdout, "[SWC_<name>]");
  assertStringIncludes(stdout, "Type: sw-component");
});
