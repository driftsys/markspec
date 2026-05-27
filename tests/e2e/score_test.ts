/**
 * @module tests/e2e/score_test
 *
 * Blackbox E2E tests for `markspec score`. Invokes the CLI via the
 * shared markspec() helper.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

Deno.test("score --text --format json: prints structured result", async () => {
  const { code, stdout, stderr } = await markspec([
    "score",
    "--text",
    "The system SHALL stop within 200 ms.",
    "--format",
    "json",
  ]);
  assertEquals(code, 0, `stderr: ${stderr}`);
  const parsed = JSON.parse(stdout);
  assertEquals(parsed.id, "EXT_0001");
  assertEquals(typeof parsed.score, "number");
  assertEquals(typeof parsed.warningCount, "number");
  assertEquals(typeof parsed.infoCount, "number");
  assertEquals(Array.isArray(parsed.contributions), true);
  assertEquals(Array.isArray(parsed.diagnostics), true);
});

Deno.test("score --text: caller-supplied id is echoed", async () => {
  const { code, stdout } = await markspec([
    "score",
    "--text",
    "The system shall be fast.",
    "--id",
    "DOORS-001",
    "--format",
    "json",
  ]);
  assertEquals(code, 0);
  const parsed = JSON.parse(stdout);
  assertEquals(parsed.id, "DOORS-001");
});

// Wrapper to pipe a stdin string into `markspec score`. The shared
// helper does not expose stdin, so we use Deno.Command directly for
// these tests with the same arg layout the helper would build.
async function markspecStdin(
  args: string[],
  stdin: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const CLI_ENTRY = new URL(
    "../../packages/markspec/main.ts",
    import.meta.url,
  ).pathname;
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", CLI_ENTRY, ...args],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = cmd.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(stdin));
  await writer.close();
  const out = await child.output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

Deno.test("score: JSONL batch mode emits one JSON per line in order", async () => {
  const stdin = [
    JSON.stringify({ id: "A", text: "The system shall stop." }),
    JSON.stringify({ id: "B", text: "It should be fast." }),
    JSON.stringify({ id: "C", text: "Errors handled appropriately." }),
  ].join("\n") + "\n";

  const { code, stdout } = await markspecStdin(
    ["score", "--format", "json"],
    stdin,
  );
  assertEquals(code, 0);
  const lines = stdout.trim().split("\n");
  assertEquals(lines.length, 3);
  const ids = lines.map((l) => JSON.parse(l).id);
  assertEquals(ids, ["A", "B", "C"]);
});

Deno.test("score: JSONL batch synthesises EXT_<n> when id absent", async () => {
  const stdin = [
    JSON.stringify({ text: "The system shall stop." }),
    JSON.stringify({ text: "It should be fast." }),
  ].join("\n") + "\n";
  const { code, stdout } = await markspecStdin(
    ["score", "--format", "json"],
    stdin,
  );
  assertEquals(code, 0);
  const ids = stdout.trim().split("\n").map((l) => JSON.parse(l).id);
  assertEquals(ids, ["EXT_1", "EXT_2"]);
});

Deno.test("score: malformed JSONL line → exit 2, stderr cites line", async () => {
  const stdin = [
    JSON.stringify({ text: "First." }),
    "{not json",
    JSON.stringify({ text: "Third." }),
  ].join("\n") + "\n";
  const { code, stdout, stderr } = await markspecStdin(
    ["score", "--format", "json"],
    stdin,
  );
  assertEquals(code, 2);
  const lines = stdout.trim().split("\n").filter((l) => l.length > 0);
  assertEquals(lines.length, 2);
  assertStringIncludes(stderr, "line 2");
});

Deno.test("score: all malformed → exit 1", async () => {
  const stdin = "not json\n{also not\n";
  const { code, stdout } = await markspecStdin(
    ["score", "--format", "json"],
    stdin,
  );
  assertEquals(code, 1);
  assertEquals(stdout.trim(), "");
});

Deno.test("score: missing 'text' field → skipped with stderr message", async () => {
  const stdin = [
    JSON.stringify({ text: "First." }),
    JSON.stringify({ id: "noText" }),
  ].join("\n") + "\n";
  const { code, stdout, stderr } = await markspecStdin(
    ["score", "--format", "json"],
    stdin,
  );
  assertEquals(code, 2);
  assertEquals(stdout.trim().split("\n").length, 1);
  assertStringIncludes(stderr, "text");
});
