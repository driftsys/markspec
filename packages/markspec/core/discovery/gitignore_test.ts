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

Deno.test("gitignore: baseDir with regex metacharacters is escaped literally", () => {
  // A directory literally named `pkg[v2]` must be matched by its exact
  // characters — the `[` `]` must not become a regex character class.
  assertEquals(ignored("*.md", "pkg[v2]/a.md", false, "pkg[v2]"), true);
  assertEquals(ignored("*.md", "pkgv/a.md", false, "pkg[v2]"), false);
  assertEquals(ignored("*.md", "pkg2/a.md", false, "pkg[v2]"), false);
});

Deno.test("gitignore: trailing spaces are stripped", () => {
  assertEquals(ignored("*.tmp   ", "a.tmp"), true);
});

Deno.test("gitignore: a long run of stars does not hang", () => {
  // Regression: consecutive `*` must collapse to a single quantifier, or
  // this backtracks catastrophically. The assertion is secondary — the
  // real check is that this returns promptly.
  const rules = parseGitignore("**********", "");
  assertEquals(isIgnored("a/b/c/d.md", false, rules), true);
});

Deno.test("gitignore: malformed character class is skipped, not thrown", () => {
  // `[z-a]` is an inverted range → invalid regex. The bad line is dropped;
  // the valid rule after it still applies.
  const rules = parseGitignore("[z-a]x\n*.md", "");
  assertEquals(rules.length, 1);
  assertEquals(isIgnored("a.md", false, rules), true);
});
