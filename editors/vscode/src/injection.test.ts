import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Scope names of the Cucumber extensions, verified 2026-11-14 from their
 * published package.json files:
 *
 * - "Cucumber (Gherkin) Full Support" (alexkrechik.cucumberautocomplete),
 *   https://github.com/alexkrechik/VSCucumberAutoComplete/blob/7722cc935f42416453aa403cfee9eacd9b960dc5/package.json
 *   language id `feature`, grammar scope `text.gherkin.feature`; its
 *   `#` lines get `comment.line.number-sign`.
 * - "Cucumber" (CucumberOpen.cucumber-official),
 *   https://github.com/cucumber/vscode/blob/5c48d7e54382621fc1570a4e3db4f4098f8ee3c6/package.json
 *   language id `cucumber`, contributes NO TextMate grammar (it uses
 *   semantic tokens from its language server), so there is no scope to
 *   inject into.
 */
const CUCUMBER_SCOPES = ["text.gherkin.feature"];

const ROOT = join(__dirname, "..");
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const main = read("syntaxes/feature.tmLanguage.json");
const injection = read("syntaxes/feature-injection.tmLanguage.json");
const manifest = read("package.json") as {
  contributes: {
    grammars: {
      scopeName: string;
      path: string;
      language?: string;
      injectTo?: string[];
    }[];
  };
};

test("injection grammar is contributed with injectTo the Cucumber scopes", () => {
  const entry = manifest.contributes.grammars.find((g) =>
    g.path === "./syntaxes/feature-injection.tmLanguage.json"
  );
  assert.ok(entry, "grammar entry missing");
  assert.equal(entry.scopeName, injection.scopeName);
  assert.equal(entry.language, undefined, "the injection never claims a file");
  assert.deepEqual(entry.injectTo, CUCUMBER_SCOPES);
});

test("injectionSelector targets the Cucumber scopes outside comments and strings", () => {
  assert.equal(
    injection.injectionSelector,
    CUCUMBER_SCOPES.map((s) => `L:${s} -comment -string`).join(", "),
  );
});

test("injection reuses the header, trailer and comment rules of the main grammar", () => {
  assert.deepEqual(injection.patterns, [{ include: "#header" }]);
  for (const key of ["header", "trailer", "comment"]) {
    assert.deepEqual(injection.repository[key], main.repository[key], key);
  }
});

test("main grammar names the header region", () => {
  assert.equal(main.repository.header.name, "meta.header.markspec");
});
