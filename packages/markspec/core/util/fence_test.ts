/**
 * @module core/util/fence_test
 *
 * Unit tests for {@linkcode walkProseLines} — the prose-line walker
 * that skips lines inside fenced code blocks. These cover the
 * boundary conditions the prior copy-pasted code couldn't easily
 * exercise.
 */

import { assertEquals } from "@std/assert";
import { walkProseLines } from "./fence.ts";

Deno.test("walkProseLines: yields every line when there are no fences", () => {
  const body = "alpha\nbeta\ngamma";
  const yielded: string[] = [];
  walkProseLines(body, (line) => yielded.push(line));
  assertEquals(yielded, ["alpha", "beta", "gamma"]);
});

Deno.test("walkProseLines: skips lines inside backtick fenced code", () => {
  const body = [
    "before",
    "```ts",
    "const x = 1;",
    "```",
    "after",
  ].join("\n");
  const yielded: string[] = [];
  walkProseLines(body, (line) => yielded.push(line));
  assertEquals(yielded, ["before", "after"]);
});

Deno.test("walkProseLines: skips lines inside tilde fenced code", () => {
  const body = ["pre", "~~~", "verbatim", "~~~", "post"].join("\n");
  const yielded: string[] = [];
  walkProseLines(body, (line) => yielded.push(line));
  assertEquals(yielded, ["pre", "post"]);
});

Deno.test("walkProseLines: index argument is the original 0-based line index", () => {
  const body = ["a", "```", "code", "```", "b"].join("\n");
  const indices: number[] = [];
  walkProseLines(body, (_line, i) => indices.push(i));
  assertEquals(indices, [0, 4]);
});

Deno.test("walkProseLines: nested-looking fences toggle on every marker", () => {
  // Mixed `~~~` opener and ``` closer — real Markdown would reject,
  // but the walker treats any fence marker as toggle.
  const body = ["a", "~~~", "x", "```", "b"].join("\n");
  const yielded: string[] = [];
  walkProseLines(body, (line) => yielded.push(line));
  assertEquals(yielded, ["a", "b"]);
});

Deno.test("walkProseLines: leading whitespace on fence marker is ignored", () => {
  const body = ["a", "   ```", "x", "   ```", "b"].join("\n");
  const yielded: string[] = [];
  walkProseLines(body, (line) => yielded.push(line));
  assertEquals(yielded, ["a", "b"]);
});

Deno.test("walkProseLines: empty body yields nothing", () => {
  let calls = 0;
  walkProseLines("", () => calls++);
  // `"".split("\n")` is `[""]`, so one empty line still goes to cb.
  assertEquals(calls, 1);
});
