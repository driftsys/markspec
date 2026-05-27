/**
 * @module mcp/tools/profile_describe_test
 */
import { assertStringIncludes } from "@std/assert";
import { buildProfileIntrospection } from "../../core/mod.ts";
import { mergeChain, parseManifest } from "../../core/mod.ts";
import type { ProfileChain } from "../../core/mod.ts";
import type { LoadedProfile } from "../../core/model/mod.ts";
import { dispatchProfileDescribe } from "./profile_describe.ts";

function makeChain(yaml: string): ProfileChain {
  const result = parseManifest(yaml, "<test>");
  if (!result.manifest) throw new Error("parse failed");
  const tier: LoadedProfile = {
    id: result.manifest.id,
    version: result.manifest.version,
    specifier: { kind: "local", path: "./test" },
    manifest: result.manifest,
    sourcePath: "<test>",
    baseDir: "/tmp",
  };
  // deno-lint-ignore no-explicit-any
  const merge = mergeChain({ tiers: [tier], effective: null as any });
  return { tiers: [tier], effective: merge.effective! };
}

// Chain with software-requirement type, Verifies attribute, and test-case type.
const TEST_YAML = `
id: "@test/p"
version: 1.0.0
markspec-schema: "1"
profile:
  types:
    software-requirement:
      extends: Requirement
      description: A software requirement
    test-case:
      extends: Test
      description: A test case for verification
  attributes:
    - name: Verifies
      type: id-list
      description: Links to the verified requirement
`;

Deno.test(
  "dispatchProfileDescribe: exact match by kind+name returns full detail",
  () => {
    const chain = makeChain(TEST_YAML);
    const intro = buildProfileIntrospection(chain);
    const result = dispatchProfileDescribe(intro, {
      kind: "type",
      name: "software-requirement",
    });
    assertStringIncludes(result, "# type · software-requirement");
    assertStringIncludes(result, "A software requirement");
  },
);

Deno.test(
  "dispatchProfileDescribe: fuzzy single match resolves to full detail",
  () => {
    // "software" only appears in software-requirement type name and description.
    // test-case does not contain "software".
    const chain = makeChain(TEST_YAML);
    const intro = buildProfileIntrospection(chain);
    const result = dispatchProfileDescribe(intro, { name: "software" });
    assertStringIncludes(result, "# type · software-requirement");
  },
);

Deno.test(
  "dispatchProfileDescribe: kind filter on fuzzy matches attribute",
  () => {
    // "erifies" is a substring of "Verifies" (the attribute name/summary).
    const chain = makeChain(TEST_YAML);
    const intro = buildProfileIntrospection(chain);
    const result = dispatchProfileDescribe(intro, {
      kind: "attribute",
      name: "Verifies",
    });
    assertStringIncludes(result, "# attribute · Verifies");
  },
);

Deno.test(
  "dispatchProfileDescribe: disambiguation when multiple elements match",
  () => {
    // Both "software-requirement" and "test-case" contain the word "requirement"
    // or "test" — use a query that matches both types.
    // "requirement" appears in: type·software-requirement name AND description.
    // "test" appears in: type·test-case name.
    // Use a short token that hits both types via their kind prefix "type".
    const chain = makeChain(TEST_YAML);
    const intro = buildProfileIntrospection(chain);
    // "type" matches kind="type" for both software-requirement and test-case.
    // resolve() searches kind+name+summary, so "type" matches both type entries.
    const result = dispatchProfileDescribe(intro, { name: "type" });
    assertStringIncludes(result, "Multiple profile elements match 'type'");
    assertStringIncludes(result, "Provide a `kind` to narrow the search.");
  },
);

Deno.test(
  "dispatchProfileDescribe: no match returns not-found message",
  () => {
    const chain = makeChain(TEST_YAML);
    const intro = buildProfileIntrospection(chain);
    const result = dispatchProfileDescribe(intro, {
      name: "nonexistent-xyz-zzz",
    });
    assertStringIncludes(
      result,
      "no profile element found for 'nonexistent-xyz-zzz'",
    );
  },
);

import { PROFILE_DESCRIBE_DESCRIPTOR } from "./profile_describe.ts";

Deno.test(
  "PROFILE_DESCRIBE_DESCRIPTOR.description: has TRIGGER and PREFER blocks",
  () => {
    const desc = PROFILE_DESCRIBE_DESCRIPTOR.description;
    assertStringIncludes(desc, "TRIGGER when:");
    assertStringIncludes(desc, "PREFER over:");
  },
);

Deno.test(
  "PROFILE_DESCRIBE_DESCRIPTOR.description: names profile-vocabulary intent phrases",
  () => {
    const desc = PROFILE_DESCRIBE_DESCRIPTOR.description;
    assertStringIncludes(desc, "what does");
    assertStringIncludes(desc, "EARS convention");
  },
);
