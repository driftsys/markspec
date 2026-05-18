/**
 * @module mcp/resources/profile_test
 */
import { assertStringIncludes } from "@std/assert";
import {
  buildProfileView,
  renderProfile,
  renderProfileDetail,
} from "./profile.ts";
import { buildProfileIntrospection } from "../../core/mod.ts";
import { parseManifest } from "../../core/profile/manifest.ts";
import { mergeChain } from "../../core/profile/merge.ts";
import type { ProfileChain } from "../../core/mod.ts";
import type { LoadedProfile } from "../../core/model/mod.ts";

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
