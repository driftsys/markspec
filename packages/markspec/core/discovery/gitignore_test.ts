import { assertEquals } from "@std/assert";
import { isIgnored, parseGitignore } from "./gitignore.ts";

function ignored(
  patterns: string,
  relPath: string,
  isDir = false,
  baseDir = "",
): boolean {
  return isIgnored(relPath, isDir, parseGitignore(patterns, baseDir));
}

Deno.test("gitignore: unanchored name matches at any depth", () => {
  assertEquals(ignored("*.log", "a.log"), true);
  assertEquals(ignored("*.log", "sub/dir/a.log"), true);
  assertEquals(ignored("*.log", "a.md"), false);
});

Deno.test("gitignore: leading slash anchors to the base dir", () => {
  assertEquals(ignored("/vendor", "vendor", true), true);
  assertEquals(ignored("/vendor", "a/vendor", true), false);
});

Deno.test("gitignore: pattern containing a slash is anchored", () => {
  assertEquals(ignored("docs/*.tmp", "docs/a.tmp"), true);
  assertEquals(ignored("docs/*.tmp", "docs/sub/a.tmp"), false);
  assertEquals(ignored("docs/*.tmp", "other/docs/a.tmp"), false);
});

Deno.test("gitignore: trailing slash matches directories only", () => {
  assertEquals(ignored("build/", "build", true), true);
  assertEquals(ignored("build/", "build", false), false);
});

Deno.test("gitignore: negation re-includes, last match wins", () => {
  const rules = parseGitignore("*.log\n!keep.log", "");
  assertEquals(isIgnored("debug.log", false, rules), true);
  assertEquals(isIgnored("keep.log", false, rules), false);
});

Deno.test("gitignore: comments and blank lines are skipped", () => {
  const rules = parseGitignore("# comment\n\n*.tmp\n", "");
  assertEquals(isIgnored("a.tmp", false, rules), true);
  assertEquals(rules.length, 1);
});

Deno.test("gitignore: ** crosses directory boundaries", () => {
  assertEquals(ignored("**/foo", "foo", true), true);
  assertEquals(ignored("**/foo", "a/b/foo", true), true);
  assertEquals(ignored("a/**/b", "a/b", true), true);
  assertEquals(ignored("a/**/b", "a/x/y/b", true), true);
  assertEquals(ignored("a/**/b", "a/b/c", true), false);
});

Deno.test("gitignore: ? matches a single non-slash char", () => {
  assertEquals(ignored("a?.md", "ab.md"), true);
  assertEquals(ignored("a?.md", "a/b.md"), false);
});

Deno.test("gitignore: character classes", () => {
  assertEquals(ignored("[Dd]ebug", "Debug", true), true);
  assertEquals(ignored("[Dd]ebug", "debug", true), true);
  assertEquals(ignored("[Dd]ebug", "rebug", true), false);
});

Deno.test("gitignore: baseDir scopes nested gitignore patterns", () => {
  assertEquals(ignored("*.md", "sub/x.md", false, "sub"), true);
  assertEquals(ignored("*.md", "x.md", false, "sub"), false);
  assertEquals(ignored("/draft.md", "sub/draft.md", false, "sub"), true);
  assertEquals(ignored("/draft.md", "sub/deep/draft.md", false, "sub"), false);
});

Deno.test("gitignore: trailing spaces are stripped", () => {
  assertEquals(ignored("*.tmp   ", "a.tmp"), true);
});
