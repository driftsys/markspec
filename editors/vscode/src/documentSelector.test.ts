import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  MARKSPEC_DOCUMENT_SELECTOR,
  WATCHED_FILE_GLOB,
} from "./documentSelector";

const LANGUAGES = [
  "markdown",
  "rust",
  "kotlin",
  "java",
  "c",
  "cpp",
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
  "csharp",
];

test("selector selects .feature files by file pattern, not by language id", () => {
  assert.deepEqual(
    MARKSPEC_DOCUMENT_SELECTOR.filter((entry) => "pattern" in entry),
    [{ scheme: "file", pattern: "**/*.feature" }],
  );
});

test("selector keeps every existing language entry", () => {
  for (const language of LANGUAGES) {
    assert.ok(
      MARKSPEC_DOCUMENT_SELECTOR.some((entry) =>
        "language" in entry && entry.language === language &&
        entry.scheme === "file"
      ),
      `missing language ${language}`,
    );
  }
});

test("watched file glob covers Markdown and feature files", () => {
  assert.equal(WATCHED_FILE_GLOB, "**/*.{md,feature}");
});
