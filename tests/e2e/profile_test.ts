import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

// ── profile new ──────────────────────────────────────────────────────

Deno.test("profile new: scaffolds profile directory", async () => {
  const { code, stderr } = await markspec(["profile", "new", "my-profile"]);
  assertEquals(code, 0);
  assertStringIncludes(stderr, "my-profile");
});

Deno.test("profile new: accepts scoped id", async () => {
  const { code, stderr } = await markspec([
    "profile",
    "new",
    "@org/my-profile",
  ]);
  assertEquals(code, 0);
  assertStringIncludes(stderr, "my-profile");
});

Deno.test("profile new: rejects invalid id", async () => {
  const { code, stderr } = await markspec(["profile", "new", "INVALID_ID"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "invalid profile id");
});

// ── profile publish ──────────────────────────────────────────────────

Deno.test("profile publish: validates a well-formed profile", async () => {
  const { code } = await markspec(["profile", "publish", "--dir", "."], {
    "markspec.yaml":
      `id: "@test/my-profile"\nversion: 1.0.0\ndescription: test\nlicense: MIT\nprofile:\n  types: {}\n`,
  });
  assertEquals(code, 0);
});

Deno.test("profile publish: fails on invalid manifest", async () => {
  const { code } = await markspec(["profile", "publish", "--dir", "."], {
    "markspec.yaml": "not: valid\n",
  });
  assertEquals(code, 1);
});

Deno.test("profile publish: warns on missing description", async () => {
  const { code, stderr } = await markspec(
    ["profile", "publish", "--dir", "."],
    {
      "markspec.yaml":
        `id: "@test/my-profile"\nversion: 1.0.0\nlicense: MIT\nprofile:\n  types: {}\n`,
    },
  );
  assertEquals(code, 0);
  assertStringIncludes(stderr, "description");
});

// ── profile add ──────────────────────────────────────────────────────

Deno.test("profile add: adds local specifier to .markspec.yaml", async () => {
  const { code, stderr } = await markspec(
    ["profile", "add", "./profiles/my-profile"],
    {
      "project.yaml": "name: test\nversion: 0.1.0\n",
      "profiles/my-profile/markspec.yaml":
        `id: "my-profile"\nversion: 0.1.0\nprofile:\n  types: {}\n`,
    },
  );
  assertEquals(code, 0);
  assertStringIncludes(stderr, "added");
});

Deno.test("profile add: fails on unresolvable specifier", async () => {
  const { code } = await markspec(
    ["profile", "add", "./nonexistent"],
    {
      "project.yaml": "name: test\nversion: 0.1.0\n",
    },
  );
  assertEquals(code, 1);
});
