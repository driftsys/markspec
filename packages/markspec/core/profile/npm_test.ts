import { assertEquals, assertExists } from "@std/assert";
import { resolveNpmSpecifier } from "./npm.ts";
import type { Diagnostic, ProfileSpecifier } from "../model/mod.ts";

const npmSpec: Extract<ProfileSpecifier, { kind: "npm" }> = {
  kind: "npm",
  scope: "@markspec",
  name: "profile-default",
  range: "^1.0",
};

const fakeTmpOpts = {
  makeTempDir: () => Promise.resolve("/tmp/fake-markspec-npm"),
  removeTempDir: (_p: string) => Promise.resolve(),
};

Deno.test("resolveNpmSpecifier: npm not found emits PROFILE-ADD-004", async () => {
  const diagnostics: Diagnostic[] = [];
  const failNpm = () =>
    Promise.resolve({
      code: 127,
      stdout: "",
      stderr: "npm: command not found",
    });
  const result = await resolveNpmSpecifier(
    npmSpec,
    diagnostics,
    {
      runNpm: failNpm,
      cacheRoot: "/tmp/test-cache",
      readFile: () => Promise.resolve(undefined),
      ...fakeTmpOpts,
    },
  );
  assertEquals(result, null);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "PROFILE-ADD-004");
});

Deno.test("resolveNpmSpecifier: package not found emits PROFILE-LOAD-001", async () => {
  const diagnostics: Diagnostic[] = [];
  const failPack = () =>
    Promise.resolve({
      code: 1,
      stdout: "",
      stderr: "npm ERR! 404 Not Found",
    });
  const result = await resolveNpmSpecifier(
    npmSpec,
    diagnostics,
    {
      runNpm: failPack,
      cacheRoot: "/tmp/test-cache",
      readFile: () => Promise.resolve(undefined),
      ...fakeTmpOpts,
    },
  );
  assertEquals(result, null);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "PROFILE-LOAD-001");
});

Deno.test("resolveNpmSpecifier: cache hit skips npm pack", async () => {
  const diagnostics: Diagnostic[] = [];
  let npmCalled = false;
  const spyNpm = () => {
    npmCalled = true;
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };
  const manifestContent =
    `id: "@markspec/profile-default"\nversion: 1.0.0\nprofile:\n  types: {}\n`;

  const result = await resolveNpmSpecifier(
    npmSpec,
    diagnostics,
    {
      runNpm: spyNpm,
      cacheRoot: "/tmp/test-cache",
      readFile: (path: string) => {
        if (path.includes("@markspec") && path.endsWith("markspec.yaml")) {
          return Promise.resolve(manifestContent);
        }
        return Promise.resolve(undefined);
      },
      resolvedVersion: "1.0.0",
    },
  );
  assertEquals(npmCalled, false, "npm should not be called on cache hit");
  assertExists(result);
  assertEquals(result.rawYaml, manifestContent);
  assertEquals(diagnostics.length, 0);
});
