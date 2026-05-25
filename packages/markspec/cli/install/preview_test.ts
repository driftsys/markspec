/**
 * @module cli/install/preview_test
 *
 * Unit tests for the preview module (diff render + TTY confirm).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { confirm, renderDiff } from "./preview.ts";

Deno.test("renderDiff: empty current vs new content — emits + lines for added", () => {
  const d = renderDiff("", "alpha\nbeta\n", "/tmp/x.lua");
  assertStringIncludes(d, "--- /tmp/x.lua");
  assertStringIncludes(d, "+++ /tmp/x.lua (new)");
  assertStringIncludes(d, "+alpha");
  assertStringIncludes(d, "+beta");
});

Deno.test("renderDiff: same content → empty diff body", () => {
  const d = renderDiff("alpha\n", "alpha\n", "/tmp/x.lua");
  // Header still present, no - or + lines.
  assertStringIncludes(d, "--- /tmp/x.lua");
  assertEquals(d.includes("+alpha"), false);
  assertEquals(d.includes("-alpha"), false);
});

Deno.test("renderDiff: line replacement shows both - and +", () => {
  const d = renderDiff("alpha\n", "beta\n", "/tmp/x.lua");
  assertStringIncludes(d, "-alpha");
  assertStringIncludes(d, "+beta");
});

Deno.test("confirm: yes/y/Y returns true", async () => {
  assertEquals(await confirm("Apply?", makeStdinStub("y\n"), false), true);
  assertEquals(await confirm("Apply?", makeStdinStub("Y\n"), false), true);
  assertEquals(await confirm("Apply?", makeStdinStub("yes\n"), false), true);
});

Deno.test("confirm: no/n/empty returns false", async () => {
  assertEquals(await confirm("Apply?", makeStdinStub("n\n"), false), false);
  assertEquals(await confirm("Apply?", makeStdinStub("\n"), false), false);
  assertEquals(await confirm("Apply?", makeStdinStub("no\n"), false), false);
});

Deno.test("confirm: non-TTY → throws containing 'non-interactive'", async () => {
  let threw = false;
  let msg = "";
  try {
    await confirm("Apply?", makeStdinStub("y\n"), true);
  } catch (err) {
    threw = true;
    msg = (err as Error).message;
  }
  assertEquals(threw, true);
  assertStringIncludes(msg, "non-interactive");
});

function makeStdinStub(answer: string): { readLine(): Promise<string | null> } {
  let consumed = false;
  return {
    readLine: () => {
      if (consumed) return Promise.resolve(null);
      consumed = true;
      return Promise.resolve(answer.replace(/\n$/, ""));
    },
  };
}
