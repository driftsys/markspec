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

test("language configuration uses # line comments and pairs", () => {
  const config = JSON.parse(
    readFileSync(join(ROOT, "language-configuration.json"), "utf8"),
  ) as {
    comments: { lineComment: string };
    autoClosingPairs: Array<{ open: string; close: string }>;
  };
  assert.equal(config.comments.lineComment, "#");
  const opens = config.autoClosingPairs.map((p) => p.open);
  for (const open of ['"', "'", "<", "("]) {
    assert.ok(opens.includes(open), `autoClosingPairs has ${open}`);
  }
  assert.equal(opens.includes('"""'), false);
});
