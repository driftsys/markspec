import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

interface LanguageContribution {
  id: string;
  extensions?: string[];
  aliases?: string[];
  configuration?: string;
}

const manifest = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
) as { contributes: { languages?: LanguageContribution[] } };

const languages = manifest.contributes.languages ?? [];
const feature = languages.find((l) => l.id === "feature");

test("contributes a feature language for .feature files", () => {
  assert.ok(feature, "languages has an entry with id feature");
  assert.deepEqual(feature.extensions, [".feature"]);
  assert.ok(feature.aliases?.includes("Gherkin"));
  assert.equal(feature.configuration, "./language-configuration.json");
});

test("does not contribute the cucumber language id", () => {
  assert.equal(languages.some((l) => l.id === "cucumber"), false);
});

test("language configuration only sets the # line comment", () => {
  const config = JSON.parse(
    readFileSync(join(ROOT, "language-configuration.json"), "utf8"),
  ) as Record<string, unknown>;
  // Pairs and brackets are left to the other extensions that register the
  // same language id, so this file cannot override them.
  assert.deepEqual(config, { comments: { lineComment: "#" } });
});

test("untrusted workspaces get limited support with restricted settings", () => {
  const caps =
    (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      capabilities: {
        untrustedWorkspaces: {
          supported: unknown;
          restrictedConfigurations?: string[];
        };
      };
    }).capabilities.untrustedWorkspaces;
  assert.equal(caps.supported, "limited");
  assert.deepEqual([...(caps.restrictedConfigurations ?? [])].sort(), [
    "markspec.mcp.args",
    "markspec.server.args",
    "markspec.server.path",
    "markspec.trace.logPath",
  ]);
});
