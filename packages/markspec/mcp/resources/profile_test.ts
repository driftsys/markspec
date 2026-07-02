/**
 * @module mcp/resources/profile_test
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildProfileView,
  renderProfile,
  renderProfileDetail,
} from "./profile.ts";
import { buildProfileIntrospection } from "../../core/mod.ts";
import { parseManifest } from "../../core/profile/manifest.ts";
import { mergeChain } from "../../core/profile/merge.ts";
import type { DeliveredDocument, ProfileChain } from "../../core/mod.ts";
import type { LoadedProfile } from "../../core/model/mod.ts";
import { deliveredUri } from "../uri.ts";

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

Deno.test("renderProfile: no chain → no profile configured", () => {
  const text = renderProfile(buildProfileIntrospection(null));
  assertStringIncludes(text, "No profile configured");
});

Deno.test("renderProfile: overview renders element refs with summary and detail URI", () => {
  const chain = makeChain(`
id: "@test/p"
version: 1.0.0
markspec-schema: "1"
profile:
  types:
    software-requirement:
      extends: Requirement
      description: A SW req
`);
  const text = renderProfile(buildProfileIntrospection(chain));
  assertStringIncludes(text, "software-requirement");
  assertStringIncludes(text, "A SW req");
  assertStringIncludes(text, "markspec://profile/type/software-requirement");
});

Deno.test("renderProfileDetail: type detail renders description and provenance", () => {
  const chain = makeChain(`
id: "@test/p"
version: 1.0.0
markspec-schema: "1"
profile:
  types:
    software-requirement:
      extends: Requirement
      description: A software requirement
`);
  const intro = buildProfileIntrospection(chain);
  const detail = intro.describe("type", "software-requirement")!;
  const text = renderProfileDetail(detail);
  assertStringIncludes(text, "software-requirement");
  assertStringIncludes(text, "A software requirement");
  assertStringIncludes(text, "@test/p");
});

Deno.test("renderProfileDetail: label concern shows kind and values", () => {
  const chain = makeChain(`
id: "@test/p"
version: 1.0.0
markspec-schema: "1"
profile:
  labels:
    asil:
      kind: enum
      description: Safety level
      values:
        ASIL-A: Lowest ASIL
        QM: Quality managed
`);
  const intro = buildProfileIntrospection(chain);
  const detail = intro.describe("label-concern", "asil")!;
  const text = renderProfileDetail(detail);
  assertStringIncludes(text, "asil");
  assertStringIncludes(text, "enum");
  assertStringIncludes(text, "ASIL-A");
  assertStringIncludes(text, "Lowest ASIL");
});

Deno.test("renderProfile: two-tier chain shows leaf as Active and root under Inherits", () => {
  // Build root tier (the bundled default)
  const rootResult = parseManifest(
    `id: "@markspec/profile-default"\nversion: 1.0.0\nmarkspec-schema: "1"\nprofile:\n  types: {}\n`,
    "<root>",
  );
  if (!rootResult.manifest) throw new Error("root parse failed");
  const rootTier: LoadedProfile = {
    id: rootResult.manifest.id,
    version: rootResult.manifest.version,
    specifier: { kind: "local", path: "./root" },
    manifest: rootResult.manifest,
    sourcePath: "<root>",
    baseDir: "/tmp",
  };

  // Build leaf tier (the user's own profile)
  const leafResult = parseManifest(
    `id: "@acme/leaf"\nversion: 0.1.0\nmarkspec-schema: "1"\nprofile:\n  types: {}\n`,
    "<leaf>",
  );
  if (!leafResult.manifest) throw new Error("leaf parse failed");
  const leafTier: LoadedProfile = {
    id: leafResult.manifest.id,
    version: leafResult.manifest.version,
    specifier: { kind: "local", path: "./leaf" },
    manifest: leafResult.manifest,
    sourcePath: "<leaf>",
    baseDir: "/tmp",
  };

  const twoTierChain: ProfileChain = {
    tiers: [rootTier, leafTier],
    // deno-lint-ignore no-explicit-any
    effective: null as any,
  };
  const merge = mergeChain(twoTierChain);
  const chain: ProfileChain = {
    tiers: [rootTier, leafTier],
    effective: merge.effective!,
  };

  const text = renderProfile(buildProfileIntrospection(chain));
  assertStringIncludes(text, "**Active**: @acme/leaf@0.1.0");
  assertStringIncludes(text, "**Inherits**: @markspec/profile-default@1.0.0");
});

Deno.test("renderProfile: no delivers → no Delivered documents section", () => {
  const chain = makeChain(`
id: "@test/p"
version: 1.0.0
markspec-schema: "1"
profile:
  types:
    requirement:
      extends: Requirement
`);
  const text = renderProfile(buildProfileIntrospection(chain));
  assertEquals(text.includes("## Delivered documents"), false);
});

Deno.test("renderProfile: delivers → Delivered documents section with links", () => {
  const chain = makeChain(`
id: "@test/p"
version: 1.0.0
markspec-schema: "1"
profile:
  types:
    requirement:
      extends: Requirement
`);
  const delivers: DeliveredDocument[] = [
    {
      profileId: "platform-arch",
      profileVersion: "1.2.0",
      path: "reference/platform.md",
      absPath: "/profiles/platform-arch/reference/platform.md",
      corpus: true,
      description: "Reference platform architecture",
    },
    {
      profileId: "platform-arch",
      profileVersion: "1.2.0",
      path: "reference/guide.md",
      absPath: "/profiles/platform-arch/reference/guide.md",
      corpus: false,
    },
  ];
  const text = renderProfile(buildProfileIntrospection(chain), delivers);
  assertStringIncludes(text, "## Delivered documents");
  assertStringIncludes(
    text,
    `- [reference/platform.md](${
      deliveredUri("platform-arch", "reference/platform.md")
    }) — corpus (entries in graph) — Reference platform architecture`,
  );
  assertStringIncludes(
    text,
    `- [reference/guide.md](${
      deliveredUri("platform-arch", "reference/guide.md")
    }) — documentation`,
  );
});

// Verify buildProfileView is a thin wrapper re-exporting buildProfileIntrospection.
Deno.test("buildProfileView: wraps buildProfileIntrospection", () => {
  const chain = makeChain(`
id: "@test/p"
version: 1.0.0
markspec-schema: "1"
profile:
  types:
    requirement:
      extends: Requirement
`);
  const view = buildProfileView(chain);
  assertStringIncludes(view.overview().tiers[0].id, "@test/p");
});
